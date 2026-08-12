use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{fs, path::{Path, PathBuf}};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub parent_path: String,
    pub name: String,
    pub template: String,
    pub typescript: bool,
    pub css_preset: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatedProject {
    pub path: String,
    pub name: String,
    pub template: String,
    pub files_created: usize,
}

fn validate_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() || name == "." || name == ".." {
        return Err("project name is required".into());
    }
    if name.chars().any(|ch| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err("project name contains characters that are invalid on supported desktop platforms".into());
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Err("project name cannot end with a dot or space".into());
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9") {
        return Err("project name is reserved on Windows".into());
    }
    Ok(name.to_string())
}

fn package_identifier(value: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash && !output.is_empty() {
            output.push('-');
            previous_dash = true;
        }
    }
    while output.ends_with('-') { output.pop(); }
    if output.is_empty() { "webforge-app".into() } else { output }
}

fn write(root: &Path, relative: &str, content: &str, count: &mut usize) -> Result<(), String> {
    let target = root.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("unable to create {}: {error}", parent.display()))?;
    }
    fs::write(&target, content).map_err(|error| format!("unable to write {}: {error}", target.display()))?;
    *count += 1;
    Ok(())
}

fn add_latest(map: &mut Map<String, Value>, name: &str) {
    map.insert(name.into(), Value::String("latest".into()));
}

fn package_json(name: &str, framework: &str, typescript: bool, tailwind: bool) -> String {
    let mut dependencies = Map::new();
    let mut dev_dependencies = Map::new();
    add_latest(&mut dev_dependencies, "vite");

    match framework {
        "react" => {
            add_latest(&mut dependencies, "react"); add_latest(&mut dependencies, "react-dom"); add_latest(&mut dev_dependencies, "@vitejs/plugin-react");
            if typescript { add_latest(&mut dev_dependencies, "typescript"); add_latest(&mut dev_dependencies, "@types/react"); add_latest(&mut dev_dependencies, "@types/react-dom"); }
        }
        "vue" => {
            add_latest(&mut dependencies, "vue"); add_latest(&mut dev_dependencies, "@vitejs/plugin-vue");
            if typescript { add_latest(&mut dev_dependencies, "typescript"); }
        }
        "svelte" => {
            add_latest(&mut dependencies, "svelte"); add_latest(&mut dev_dependencies, "@sveltejs/vite-plugin-svelte");
            if typescript { add_latest(&mut dev_dependencies, "typescript"); }
        }
        _ => {}
    }
    if typescript { add_latest(&mut dev_dependencies, "@types/node"); }
    if tailwind { add_latest(&mut dev_dependencies, "tailwindcss"); add_latest(&mut dev_dependencies, "@tailwindcss/vite"); }

    let mut root = Map::new();
    root.insert("name".into(), Value::String(name.to_string()));
    root.insert("private".into(), Value::Bool(true));
    root.insert("version".into(), Value::String("0.0.0".into()));
    root.insert("type".into(), Value::String("module".into()));
    root.insert("scripts".into(), serde_json::json!({ "dev": "vite", "build": "vite build", "preview": "vite preview" }));
    if !dependencies.is_empty() { root.insert("dependencies".into(), Value::Object(dependencies)); }
    root.insert("devDependencies".into(), Value::Object(dev_dependencies));
    format!("{}\n", serde_json::to_string_pretty(&Value::Object(root)).expect("generated package metadata is serializable"))
}


const WEBFORGE_VITE_BRIDGE_PLUGIN: &str = r#"
const webforgeBridge = () => ({
  name: 'webforge-runtime-bridge',
  apply: 'serve',
  transformIndexHtml() {
    if (process.env.WEBFORGE_BRIDGE !== '1') return [];
    return [{
      tag: 'script',
      attrs: { 'data-webforge-vite-bridge': 'true' },
      children: `(() => {
        if (window.__WEBFORGE_VITE_BRIDGE__) return;
        window.__WEBFORGE_VITE_BRIDGE__ = true;
        const send = (payload) => window.parent.postMessage({ __webforge: true, ...payload }, '*');
        const stringify = (value) => {
          if (typeof value === 'string') return value;
          if (value instanceof Error) return value.name + ': ' + value.message;
          try { return JSON.stringify(value); } catch { return String(value); }
        };
        const stackLocation = (args) => {
          for (const value of args) {
            const stack = value instanceof Error ? value.stack : null;
            const match = typeof stack === 'string' ? stack.match(/((?:https?|file):\\/\\/[^\\s)]+):(\\d+):(\\d+)/) : null;
            if (match) return { source: match[1], line: Number(match[2]), column: Number(match[3]) };
          }
          return {};
        };
        for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
          const original = console[level]?.bind(console);
          if (!original) continue;
          console[level] = (...args) => { original(...args); send({ kind: 'console', level, text: args.map(stringify).join(' '), ...stackLocation(args) }); };
        }
        window.addEventListener('error', (event) => send({ kind: 'console', level: 'error', text: event.message || 'Uncaught error', source: event.filename || location.href, line: event.lineno || null, column: event.colno || null }));
        window.addEventListener('unhandledrejection', (event) => send({ kind: 'console', level: 'error', text: 'Unhandled promise rejection: ' + stringify(event.reason) }));

        const devtoolsLimit = (value, limit = 65536) => {
          const text = typeof value === 'string' ? value : value == null ? '' : stringify(value);
          return text.length > limit ? text.slice(0, limit) + '\\n…[truncated by WebForge]' : text;
        };
        const devtoolsSensitive = (name) => ['token', 'secret', 'password', 'passwd', 'authorization', 'cookie', 'session', 'api-key', 'apikey'].some((part) => String(name || '').toLowerCase().includes(part));
        const devtoolsHeaders = (headers) => {
          const result = [];
          try {
            new Headers(headers || {}).forEach((value, name) => result.push({ name, value: devtoolsSensitive(name) ? '[redacted]' : devtoolsLimit(value, 4096) }));
          } catch {}
          return result.slice(0, 80);
        };
        let devtoolsNetworkSequence = 0;
        const devtoolsNetworkId = () => 'net-' + Date.now().toString(36) + '-' + (++devtoolsNetworkSequence).toString(36);
        const devtoolsSendNetwork = (entry) => send({ kind: 'devtools-network', entry });
        const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
        if (originalFetch) window.fetch = async (input, init) => {
          const id = devtoolsNetworkId();
          const started = performance.now();
          let request;
          try { request = new Request(input, init); } catch { request = null; }
          const method = request?.method || init?.method || 'GET';
          const url = request?.url || String(input || '');
          const requestHeaders = devtoolsHeaders(request?.headers || init?.headers);
          const requestBody = init?.body == null ? null : devtoolsLimit(typeof init.body === 'string' ? init.body : '[non-text request body]', 32768);
          try {
            const response = await originalFetch(input, init);
            const durationMs = performance.now() - started;
            const responseHeaders = devtoolsHeaders(response.headers);
            const sizeHeader = response.headers.get('content-length');
            const transferSize = sizeHeader && Number.isFinite(Number(sizeHeader)) ? Number(sizeHeader) : null;
            const base = { id, method, url, status: response.status, statusText: response.statusText || '', resourceType: 'fetch', startTime: started, durationMs, requestHeaders, responseHeaders, requestBody, transferSize, error: null };
            try {
              response.clone().text().then((text) => devtoolsSendNetwork({ ...base, responseBody: devtoolsLimit(text) })).catch(() => devtoolsSendNetwork({ ...base, responseBody: null }));
            } catch { devtoolsSendNetwork({ ...base, responseBody: null }); }
            return response;
          } catch (error) {
            devtoolsSendNetwork({ id, method, url, status: null, statusText: '', resourceType: 'fetch', startTime: started, durationMs: performance.now() - started, requestHeaders, responseHeaders: [], requestBody, responseBody: null, transferSize: null, error: devtoolsLimit(error?.message || String(error), 4096) });
            throw error;
          }
        };
        if (typeof XMLHttpRequest !== 'undefined') {
          const xhrOpen = XMLHttpRequest.prototype.open;
          const xhrSend = XMLHttpRequest.prototype.send;
          const xhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
          XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this.__webforgeDevtools = { id: devtoolsNetworkId(), method: String(method || 'GET'), url: String(url || ''), headers: [], started: 0, body: null };
            return xhrOpen.call(this, method, url, ...rest);
          };
          XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            if (this.__webforgeDevtools) this.__webforgeDevtools.headers.push({ name: String(name), value: devtoolsSensitive(name) ? '[redacted]' : devtoolsLimit(String(value), 4096) });
            return xhrSetHeader.call(this, name, value);
          };
          XMLHttpRequest.prototype.send = function(body) {
            const meta = this.__webforgeDevtools || { id: devtoolsNetworkId(), method: 'GET', url: '', headers: [], started: 0, body: null };
            meta.started = performance.now();
            meta.body = body == null ? null : devtoolsLimit(typeof body === 'string' ? body : '[non-text request body]', 32768);
            this.__webforgeDevtools = meta;
            this.addEventListener('loadend', () => {
              let responseBody = null;
              try { if (!this.responseType || this.responseType === 'text') responseBody = devtoolsLimit(this.responseText || ''); } catch {}
              const responseHeaders = [];
              try {
                for (const line of String(this.getAllResponseHeaders() || '').split(String.fromCharCode(10))) {
                  const index = line.indexOf(':');
                  if (index > 0) { const name = line.slice(0, index).trim(); const value = line.slice(index + 1).trim(); responseHeaders.push({ name, value: devtoolsSensitive(name) ? '[redacted]' : devtoolsLimit(value, 4096) }); }
                }
              } catch {}
              devtoolsSendNetwork({ id: meta.id, method: meta.method, url: meta.url, status: this.status || null, statusText: this.statusText || '', resourceType: 'xhr', startTime: meta.started, durationMs: performance.now() - meta.started, requestHeaders: meta.headers.slice(0, 80), responseHeaders: responseHeaders.slice(0, 80), requestBody: meta.body, responseBody, transferSize: null, error: this.status === 0 ? 'Request failed or was blocked' : null });
            }, { once: true });
            return xhrSend.call(this, body);
          };
        }
        
        let devtoolsLcp = null;
        let devtoolsCls = 0;
        let devtoolsLongTasks = 0;
        let devtoolsLongTaskTime = 0;
        try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) devtoolsLcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
        try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) devtoolsCls += entry.value || 0; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
        try { new PerformanceObserver((list) => { for (const entry of list.getEntries()) { devtoolsLongTasks += 1; devtoolsLongTaskTime += entry.duration || 0; } }).observe({ type: 'longtask', buffered: true }); } catch {}
        
        const devtoolsStorageEntry = (key, value) => ({ key, value: devtoolsSensitive(key) ? '[redacted]' : devtoolsLimit(value, 4096), redacted: devtoolsSensitive(key) });
        const devtoolsStorageSnapshot = async () => {
          const local = [], session = [], cookies = [], indexedDb = [];
          try { for (let i = 0; i < Math.min(localStorage.length, 500); i += 1) { const key = localStorage.key(i); if (key != null) local.push(devtoolsStorageEntry(key, localStorage.getItem(key) || '')); } } catch {}
          try { for (let i = 0; i < Math.min(sessionStorage.length, 500); i += 1) { const key = sessionStorage.key(i); if (key != null) session.push(devtoolsStorageEntry(key, sessionStorage.getItem(key) || '')); } } catch {}
          try { for (const part of String(document.cookie || '').split(';').map((item) => item.trim()).filter(Boolean).slice(0, 200)) { const index = part.indexOf('='); const name = index >= 0 ? part.slice(0, index) : part; cookies.push({ name, value: '[redacted]', redacted: true }); } } catch {}
          try { if (indexedDB && typeof indexedDB.databases === 'function') { const databases = await indexedDB.databases(); for (const db of databases.slice(0, 100)) if (db.name) indexedDb.push({ name: db.name, version: Number(db.version || 0) }); } } catch {}
          send({ kind: 'devtools-storage', snapshot: { origin: location.origin, cookies, localStorage: local, sessionStorage: session, indexedDb, capturedAt: Date.now() } });
        };
        const devtoolsPerformanceSnapshot = () => {
          const navigation = performance.getEntriesByType('navigation')[0];
          const paints = performance.getEntriesByType('paint');
          const firstPaint = paints.find((entry) => entry.name === 'first-paint');
          const firstContentful = paints.find((entry) => entry.name === 'first-contentful-paint');
          const resources = performance.getEntriesByType('resource').slice(-1000);
          let transferSize = 0, encodedBodySize = 0, decodedBodySize = 0;
          for (const entry of resources) { transferSize += Number(entry.transferSize || 0); encodedBodySize += Number(entry.encodedBodySize || 0); decodedBodySize += Number(entry.decodedBodySize || 0); }
          send({ kind: 'devtools-performance', snapshot: { url: location.href, domContentLoadedMs: navigation ? navigation.domContentLoadedEventEnd : null, loadMs: navigation ? navigation.loadEventEnd || null : null, firstPaintMs: firstPaint?.startTime ?? null, firstContentfulPaintMs: firstContentful?.startTime ?? null, largestContentfulPaintMs: devtoolsLcp, cumulativeLayoutShift: devtoolsCls, longTaskCount: devtoolsLongTasks, longTaskTimeMs: devtoolsLongTaskTime, resourceCount: resources.length, transferSize, encodedBodySize, decodedBodySize, capturedAt: Date.now() } });
        };
        const devtoolsResourceSnapshot = () => {
          for (const entry of performance.getEntriesByType('resource').slice(-250)) {
            const id = 'resource-' + Math.round(entry.startTime * 1000) + '-' + String(entry.name).slice(-24);
            devtoolsSendNetwork({ id, method: 'GET', url: entry.name, status: null, statusText: '', resourceType: entry.initiatorType || 'resource', startTime: entry.startTime, durationMs: entry.duration, requestHeaders: [], responseHeaders: [], requestBody: null, responseBody: null, transferSize: Number(entry.transferSize || 0) || null, error: null });
          }
        };
        const devtoolsSelector = (element) => {
          if (!(element instanceof Element)) return '';
          if (element.id) return '#' + element.id;
          const name = element.tagName.toLowerCase();
          if (!element.parentElement) return name;
          const siblings = [...element.parentElement.children].filter((child) => child.tagName === element.tagName);
          return siblings.length > 1 ? name + ':nth-of-type(' + (siblings.indexOf(element) + 1) + ')' : name;
        };
        const devtoolsRgb = (value) => {
          const start = String(value || '').indexOf('('), end = String(value || '').indexOf(')');
          if (start < 0 || end < 0) return null;
          const numbers = String(value).slice(start + 1, end).split(',').slice(0, 3).map((part) => Number.parseFloat(part));
          return numbers.length === 3 && numbers.every(Number.isFinite) ? numbers : null;
        };
        const devtoolsLuminance = (rgb) => {
          const values = rgb.map((value) => { const channel = Math.max(0, Math.min(255, value)) / 255; return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4); });
          return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
        };
        const devtoolsContrast = (foreground, background) => {
          const fg = devtoolsRgb(foreground), bg = devtoolsRgb(background); if (!fg || !bg) return null;
          const a = devtoolsLuminance(fg), b = devtoolsLuminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const devtoolsAudit = () => {
          const findings = [], ids = new Map(); let checkedNodes = 0, seq = 0;
          const add = (rule, severity, message, element, contrastRatio = null) => { if (findings.length >= 160) return; findings.push({ id: 'a11y-' + (++seq), rule, severity, message, selector: devtoolsSelector(element), sourceId: element?.getAttribute?.('data-webforge-source-map') || element?.getAttribute?.('data-webforge-source') || null, contrastRatio }); };
          const elements = [...document.querySelectorAll('*')].slice(0, 1200);
          for (const element of elements) {
            checkedNodes += 1;
            if (element.id) { if (ids.has(element.id)) add('duplicate-id', 'error', 'Duplicate id #' + element.id, element); else ids.set(element.id, element); }
            if (element instanceof HTMLImageElement && !element.hasAttribute('alt')) add('image-alt', 'error', 'Image has no alt attribute.', element);
            if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
              const labelled = Boolean(element.labels?.length || element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') || element.getAttribute('title'));
              if (!labelled && element.getAttribute('type') !== 'hidden') add('control-name', 'error', 'Form control has no accessible label.', element);
            }
            if ((element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) && !(element.textContent || '').trim() && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby') && !element.querySelector('img[alt]')) add('interactive-name', 'error', 'Interactive element has no accessible name.', element);
            const tabindex = Number(element.getAttribute('tabindex')); if (Number.isFinite(tabindex) && tabindex > 0) add('positive-tabindex', 'warning', 'Positive tabindex can create an unexpected keyboard order.', element);
            if (element.childElementCount === 0 && (element.textContent || '').trim()) {
              const style = getComputedStyle(element); if (style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.opacity || '1') > 0) {
                let background = style.backgroundColor; let parent = element.parentElement;
                while (parent && (background === 'rgba(0, 0, 0, 0)' || background === 'transparent')) { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
                const ratio = devtoolsContrast(style.color, background); const size = Number.parseFloat(style.fontSize || '16'); const weight = Number.parseInt(style.fontWeight || '400', 10); const threshold = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
                if (ratio != null && ratio < threshold) add('color-contrast', 'warning', 'Text contrast is below ' + threshold + ':1.', element, ratio);
              }
            }
          }
          const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].slice(0, 200); let previous = 0;
          for (const heading of headings) { const level = Number(heading.tagName.slice(1)); if (previous && level > previous + 1) add('heading-order', 'warning', 'Heading level skips from h' + previous + ' to h' + level + '.', heading); previous = level; }
          send({ kind: 'devtools-accessibility', snapshot: { findings, checkedNodes, capturedAt: Date.now() } });
        };
        const devtoolsRefresh = () => { void devtoolsStorageSnapshot(); devtoolsPerformanceSnapshot(); devtoolsResourceSnapshot(); devtoolsAudit(); };
        window.addEventListener('message', (event) => {
          if (event.source !== window.parent || !event.data || event.data.__webforge !== true) return;
          const action = event.data.action;
          if (action === 'requestDevtools') { devtoolsRefresh(); return; }
          if (action === 'clearLocalStorage') { try { localStorage.clear(); } catch {} void devtoolsStorageSnapshot(); return; }
          if (action === 'clearSessionStorage') { try { sessionStorage.clear(); } catch {} void devtoolsStorageSnapshot(); return; }
          if (action === 'clearCookies') { try { for (const part of String(document.cookie || '').split(';')) { const name = part.split('=')[0].trim(); if (name) document.cookie = name + '=; Max-Age=0; path=/'; } } catch {} void devtoolsStorageSnapshot(); }
        });
        window.addEventListener('load', () => setTimeout(devtoolsRefresh, 50), { once: true });

        const cssEscape = (value) => window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
        const selectorFor = (element) => {
          if (!(element instanceof Element)) return '';
          if (element === document.documentElement) return 'html';
          if (element === document.body) return 'body';
          if (element.id) return '#' + cssEscape(element.id);
          const parts = [];
          let current = element;
          while (current && current !== document.documentElement) {
            let part = current.tagName.toLowerCase();
            const classes = [...current.classList].slice(0, 2).map(cssEscape);
            if (classes.length) part += '.' + classes.join('.');
            const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
            parts.unshift(part);
            const candidate = parts.join(' > ');
            try { if (document.querySelectorAll(candidate).length === 1) return candidate; } catch {}
            current = current.parentElement;
          }
          return parts.join(' > ');
        };
        const declarationsFor = (style) => {
          const result = {};
          if (!style) return result;
          for (const property of style) result[property] = style.getPropertyValue(property).trim();
          return result;
        };
        const sourceHint = (sourcePath, sourceLine, sourceColumn, sourceConfidence, sourceOrigin) => ({
          sourcePath, sourceLine, sourceColumn, sourceConfidence, sourceOrigin,
          sourceId: sourcePath ? 'f:' + sourcePath + ':' + sourceLine + ':' + sourceColumn : ''
        });
        const sourceFromStack = (stack, origin) => {
          const match = typeof stack === 'string' ? stack.match(/((?:https?|file):\\/\\/[^\\s)]+|\\/@fs\\/[^\\s)]+|\\/src\\/[^\\s)]+):(\\d+):(\\d+)/) : null;
          return match ? sourceHint(match[1], Number(match[2]), Number(match[3]), 'hint', origin) : null;
        };
        const sourceHintFor = (element) => {
          let current = element;
          while (current instanceof Element) {
            const authored = current.getAttribute('data-webforge-source-map');
            if (authored) {
              const match = /^(.*?):(\\d+):(\\d+)$/.exec(authored);
              if (match) return sourceHint(match[1].replace(/^\\/+/, ''), Number(match[2]), Number(match[3]), 'exact', 'webforge-source-attribute');
            }

            const fiberKey = Object.keys(current).find((key) => key.startsWith('__reactFiber$'));
            let fiber = fiberKey ? current[fiberKey] : null;
            for (let depth = 0; fiber && depth < 12; depth += 1, fiber = fiber.return) {
              const stack = fiber._debugStack?.stack || (typeof fiber._debugStack === 'string' ? fiber._debugStack : null);
              const reactHint = sourceFromStack(stack, 'react-debug-stack');
              if (reactHint) return reactHint;
            }

            const vue = current.__vueParentComponent;
            const vueFile = vue?.type?.__file || vue?.parent?.type?.__file;
            if (typeof vueFile === 'string' && vueFile) return sourceHint(vueFile, 1, 1, 'component', 'vue-component-file');

            const svelteMeta = current.__svelte_meta || current.__svelteMeta;
            const svelteFile = svelteMeta?.loc?.file || svelteMeta?.file;
            if (typeof svelteFile === 'string' && svelteFile) {
              const line = Number(svelteMeta?.loc?.line || 1);
              const column = Number(svelteMeta?.loc?.column || 1);
              return sourceHint(svelteFile, line, column, line > 1 ? 'hint' : 'component', 'svelte-dev-meta');
            }
            current = current.parentElement;
          }
          return sourceHint(null, null, null, 'runtime', null);
        };
        const pseudoForSelector = (selector) => {
          if (/:focus-visible\\b/.test(selector)) return 'focus-visible';
          if (/:hover\\b/.test(selector)) return 'hover';
          if (/:focus\\b/.test(selector)) return 'focus';
          if (/:active\\b/.test(selector)) return 'active';
          return 'normal';
        };
        const baseSelectorForState = (selector) => selector.replace(/:(?:hover|focus-visible|focus|active)\\b/g, '');
        const ruleContext = (rule) => {
          const name = rule?.constructor?.name || '';
          if (name === 'CSSMediaRule') return { name: 'media', prelude: rule.conditionText || '' };
          if (name === 'CSSSupportsRule') return { name: 'supports', prelude: rule.conditionText || '' };
          if (name === 'CSSContainerRule') return { name: 'container', prelude: rule.conditionText || rule.containerName || '' };
          if (name === 'CSSLayerBlockRule') return { name: 'layer', prelude: rule.name || '' };
          if (name === 'CSSScopeRule') return { name: 'scope', prelude: String(rule.cssText || '').split('{')[0].replace(/^@scope\\s*/i, '').trim() };
          return null;
        };
        const rulesFor = (element) => {
          const matches = [];
          let sourceOrder = 0;
          const visit = (rules, source, contexts) => {
            for (const rule of rules || []) {
              if (rule instanceof CSSStyleRule) {
                const currentOrder = ++sourceOrder;
                const importantDeclarations = [...rule.style].filter((name) => rule.style.getPropertyPriority(name) === 'important');
                for (const candidate of rule.selectorText.split(',').map((value) => value.trim()).filter(Boolean)) {
                  const pseudo = pseudoForSelector(candidate);
                  const baseSelector = baseSelectorForState(candidate);
                  try {
                    if (baseSelector && element.matches(baseSelector)) matches.push({ selector: candidate, source, contexts, pseudo, declarations: declarationsFor(rule.style), sourceOrder: currentOrder, importantDeclarations });
                  } catch {}
                }
                continue;
              }
              if (rule instanceof CSSMediaRule) { try { if (!matchMedia(rule.conditionText).matches) continue; } catch {} }
              if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) { try { if (!CSS.supports(rule.conditionText)) continue; } catch {} }
              if ('cssRules' in rule) {
                const context = ruleContext(rule);
                try { visit(rule.cssRules, source, context ? [...contexts, context] : contexts); } catch {}
              }
            }
          };
          for (const sheet of document.styleSheets) { try { visit(sheet.cssRules, sheet.href || null, []); } catch {} }
          return matches.slice(-60);
        };
        const inheritedProperties = ['color','font-family','font-size','font-weight','line-height','letter-spacing','text-align','visibility','cursor'];
        const inheritedStylesFor = (element) => { const style = getComputedStyle(element); return Object.fromEntries(inheritedProperties.map((property) => [property, style.getPropertyValue(property).trim()])); };
        const ancestorTraceFor = (element) => {
          const ancestors = []; let current = element.parentElement;
          while (current instanceof Element && ancestors.length < 8) {
            const hint = sourceHintFor(current);
            ancestors.push({ ...hint, selector: selectorFor(current), tagName: current.tagName.toLowerCase(), id: current.id || '', styles: inheritedStylesFor(current), inlineStyles: declarationsFor(current.style), cssRules: rulesFor(current) });
            current = current.parentElement;
          }
          return ancestors;
        };
        const attributesFor = (element) => Object.fromEntries([...element.attributes].filter((attr) => !attr.name.startsWith('data-webforge-')).map((attr) => [attr.name, attr.value]));
        const detailsFor = (element) => {
          const hint = sourceHintFor(element);
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            kind: 'inspect', ...hint, sourceKind: hint.sourcePath ? 'framework' : 'runtime', ancestors: ancestorTraceFor(element), editableSource: Boolean(hint.sourcePath && hint.sourceConfidence === 'exact'),
            selector: selectorFor(element), tagName: element.tagName.toLowerCase(), id: element.id || '', classes: [...element.classList], attributes: attributesFor(element),
            text: (element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 180), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            inlineStyles: declarationsFor(element.style), cssRules: rulesFor(element),
            styles: { display: style.display, position: style.position, boxSizing: style.boxSizing, width: style.width, height: style.height, minWidth: style.minWidth, maxWidth: style.maxWidth, minHeight: style.minHeight, maxHeight: style.maxHeight, margin: style.margin, marginTop: style.marginTop, marginRight: style.marginRight, marginBottom: style.marginBottom, marginLeft: style.marginLeft, padding: style.padding, paddingTop: style.paddingTop, paddingRight: style.paddingRight, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft, gap: style.gap, rowGap: style.rowGap, columnGap: style.columnGap, flexDirection: style.flexDirection, flexWrap: style.flexWrap, alignItems: style.alignItems, alignContent: style.alignContent, justifyContent: style.justifyContent, gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows, gridAutoFlow: style.gridAutoFlow, placeItems: style.placeItems, color: style.color, background: style.background, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage, fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing, textAlign: style.textAlign, textTransform: style.textTransform, textDecoration: style.textDecoration, border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow, textShadow: style.textShadow, opacity: style.opacity, transform: style.transform, transformOrigin: style.transformOrigin, zIndex: style.zIndex, overflow: style.overflow, transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration, transitionTimingFunction: style.transitionTimingFunction, transitionDelay: style.transitionDelay, animationName: style.animationName, animationDuration: style.animationDuration, animationTimingFunction: style.animationTimingFunction, animationDelay: style.animationDelay, animationIterationCount: style.animationIterationCount, animationFillMode: style.animationFillMode, containerType: style.getPropertyValue('container-type'), containerName: style.getPropertyValue('container-name') }
          };
        };
        const treeFor = () => {
          let count = 0;
          const visit = (element) => {
            if (!(element instanceof Element) || element.hasAttribute('data-webforge-overlay') || ++count > 600) return null;
            const hint = sourceHintFor(element);
            const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || '').join(' ').trim().replace(/\\s+/g, ' ').slice(0, 80);
            return { ...hint, sourceId: hint.sourceId || 'runtime:' + selectorFor(element), selector: selectorFor(element), tagName: element.tagName.toLowerCase(), id: element.id || '', classes: [...element.classList], text: directText, children: [...element.children].map(visit).filter(Boolean) };
          };
          return visit(document.body);
        };
        let inspectorEnabled = false;
        let hovered = null;
        const overlay = document.createElement('div');
        overlay.setAttribute('data-webforge-overlay', 'true');
        Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483647', border: '1px solid #a275ff', background: 'rgba(162,117,255,.12)', boxSizing: 'border-box' });
        const label = document.createElement('div');
        Object.assign(label.style, { position: 'absolute', left: '-1px', top: '-22px', height: '20px', padding: '2px 6px', background: '#6842aa', color: 'white', font: '11px/16px ui-monospace, monospace', whiteSpace: 'nowrap' });
        overlay.appendChild(label);
        const marginOverlay = document.createElement('div'); marginOverlay.setAttribute('data-webforge-overlay', 'true'); Object.assign(marginOverlay.style, { position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483645', border: '1px dashed rgba(245,158,11,.9)', background: 'rgba(245,158,11,.06)', boxSizing: 'border-box' });
        const contentOverlay = document.createElement('div'); contentOverlay.setAttribute('data-webforge-overlay', 'true'); Object.assign(contentOverlay.style, { position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483646', border: '1px dashed rgba(34,211,238,.9)', background: 'rgba(34,211,238,.04)', boxSizing: 'border-box' });
        document.documentElement.appendChild(marginOverlay); document.documentElement.appendChild(contentOverlay); document.documentElement.appendChild(overlay);
        const resizeHandles = {};
        for (const axis of ['e','s','se']) {
          const handle = document.createElement('div'); handle.setAttribute('data-webforge-overlay', 'true'); handle.dataset.axis = axis;
          Object.assign(handle.style, { position: 'absolute', width: '9px', height: '9px', border: '1px solid #6d28d9', borderRadius: '2px', background: '#ede9fe', pointerEvents: 'auto', display: 'none', boxSizing: 'border-box' });
          if (axis.includes('e')) handle.style.right = '-5px'; else handle.style.left = '50%'; if (axis.includes('s')) handle.style.bottom = '-5px'; else handle.style.top = '50%';
          if (axis === 'e') { handle.style.top = '50%'; handle.style.transform = 'translateY(-50%)'; handle.style.cursor = 'ew-resize'; }
          if (axis === 's') { handle.style.left = '50%'; handle.style.transform = 'translateX(-50%)'; handle.style.cursor = 'ns-resize'; }
          if (axis === 'se') handle.style.cursor = 'nwse-resize'; overlay.appendChild(handle); resizeHandles[axis] = handle;
        }
        const numeric = (value) => { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; };
        const canResize = (element) => { const hint = sourceHintFor(element); return element instanceof Element && !['HTML','BODY'].includes(element.tagName) && Boolean(hint.sourcePath && hint.sourceConfidence === 'exact' && hint.sourceId); };
        const paint = (element) => {
          if (!(element instanceof Element) || element === overlay || overlay.contains(element) || element.hasAttribute('data-webforge-overlay')) return;
          hovered = element; const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
          overlay.style.display = 'block'; overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px'; overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px';
          const mt = numeric(style.marginTop), mr = numeric(style.marginRight), mb = numeric(style.marginBottom), ml = numeric(style.marginLeft); marginOverlay.style.display = 'block'; marginOverlay.style.left = (rect.left - ml) + 'px'; marginOverlay.style.top = (rect.top - mt) + 'px'; marginOverlay.style.width = (rect.width + ml + mr) + 'px'; marginOverlay.style.height = (rect.height + mt + mb) + 'px';
          const bl = numeric(style.borderLeftWidth), br = numeric(style.borderRightWidth), bt = numeric(style.borderTopWidth), bb = numeric(style.borderBottomWidth), pl = numeric(style.paddingLeft), pr = numeric(style.paddingRight), pt = numeric(style.paddingTop), pb = numeric(style.paddingBottom); contentOverlay.style.display = 'block'; contentOverlay.style.left = (rect.left + bl + pl) + 'px'; contentOverlay.style.top = (rect.top + bt + pt) + 'px'; contentOverlay.style.width = Math.max(0, rect.width - bl - br - pl - pr) + 'px'; contentOverlay.style.height = Math.max(0, rect.height - bt - bb - pt - pb) + 'px';
          const hint = sourceHintFor(element); label.textContent = element.tagName.toLowerCase() + (hint.sourcePath ? ' · ' + hint.sourcePath + ':' + hint.sourceLine : ' · runtime') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height) + ' · m ' + style.margin + ' · p ' + style.padding;
          const editable = canResize(element); for (const handle of Object.values(resizeHandles)) handle.style.display = editable ? 'block' : 'none';
        };
        const beginResize = (axis, event) => {
          if (!hovered || !canResize(hovered) || !(hovered instanceof HTMLElement || hovered instanceof SVGElement)) return;
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); const element = hovered; const rect = element.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY; const declarations = {};
          const move = (next) => { if (axis.includes('e')) { const width = Math.max(1, Math.round(rect.width + next.clientX - startX)); element.style.setProperty('width', width + 'px'); declarations.width = width + 'px'; } if (axis.includes('s')) { const height = Math.max(1, Math.round(rect.height + next.clientY - startY)); element.style.setProperty('height', height + 'px'); declarations.height = height + 'px'; } paint(element); };
          const finish = () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', finish, true); const hint = sourceHintFor(element); if (hint.sourceId && Object.keys(declarations).length) send({ kind: 'designer-style-commit', sourceId: hint.sourceId, selector: selectorFor(element), declarations }); send(detailsFor(element)); paint(element); };
          window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', finish, true);
        };
        for (const [axis, handle] of Object.entries(resizeHandles)) handle.addEventListener('pointerdown', (event) => beginResize(axis, event), true);
        const find = (selector) => { try { return typeof selector === 'string' && selector ? document.querySelector(selector) : null; } catch { return null; } };
        const findSource = (sourceId) => {
          if (typeof sourceId !== 'string' || !sourceId.startsWith('f:')) return null;
          const authored = sourceId.slice(2);
          try { return document.querySelector('[data-webforge-source-map="' + cssEscape(authored) + '"]'); } catch { return null; }
        };
        document.addEventListener('mousemove', (event) => { if (inspectorEnabled) paint(event.target); }, true);
        document.addEventListener('click', (event) => {
          if (!inspectorEnabled || !(event.target instanceof Element) || event.target.hasAttribute('data-webforge-overlay') || overlay.contains(event.target)) return;
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); paint(event.target); send(detailsFor(event.target));
        }, true);

        let syncing = false;
        let scheduled = false;
        const reportScroll = () => { scheduled = false; if (syncing) return; const maxX = Math.max(0, document.documentElement.scrollWidth - innerWidth); const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight); send({ kind: 'viewport-scroll', xRatio: maxX ? scrollX / maxX : 0, yRatio: maxY ? scrollY / maxY : 0 }); };
        addEventListener('scroll', () => { if (!scheduled) { scheduled = true; requestAnimationFrame(reportScroll); } if (inspectorEnabled && hovered) paint(hovered); }, true);
        addEventListener('message', (event) => {
          if (event.source !== window.parent || !event.data || event.data.__webforge !== true) return;
          const data = event.data;
          if (data.action === 'syncScroll') { const maxX = Math.max(0, document.documentElement.scrollWidth - innerWidth); const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight); syncing = true; scrollTo(maxX * Number(data.xRatio || 0), maxY * Number(data.yRatio || 0)); setTimeout(() => { syncing = false; }, 60); return; }
          if (data.action === 'setInspector') { inspectorEnabled = Boolean(data.enabled); if (!inspectorEnabled) { overlay.style.display = 'none'; marginOverlay.style.display = 'none'; contentOverlay.style.display = 'none'; hovered = null; } return; }
          if (data.action === 'requestTree') { send({ kind: 'dom-tree', tree: treeFor() }); return; }
          if (data.action === 'applyStyle') { const element = findSource(data.sourceId) || find(data.selector); if ((element instanceof HTMLElement || element instanceof SVGElement) && typeof data.property === 'string') { element.style.setProperty(data.property, String(data.value ?? '')); send(detailsFor(element)); paint(element); } return; }
          if (data.action === 'select') { const element = findSource(data.sourceId) || find(data.selector); if (element) { paint(element); send(detailsFor(element)); } }
        });
        let treeTimer = 0;
        const scheduleTree = () => { clearTimeout(treeTimer); treeTimer = setTimeout(() => send({ kind: 'dom-tree', tree: treeFor() }), 80); };
        new MutationObserver(scheduleTree).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'id', 'data-webforge-source-map'] });
        send({ kind: 'bridge-ready', url: location.href, capabilities: ['console', 'scroll-sync', 'vite-hmr', 'framework-inspect', 'framework-source-edit', 'source-hints', 'runtime-compiler-hints', 'css-cascade', 'inheritance-trace', 'visual-designer-2', 'resize-handles', 'box-model-overlay', 'network-devtools', 'storage-devtools', 'performance-devtools', 'runtime-a11y'] });
        queueMicrotask(scheduleTree);
      })();`,
      injectTo: 'body',
    }];
  },
});
"#;

const WEBFORGE_SOURCE_HINT_PLUGIN: &str = r#"
const WEBFORGE_HTML_TAGS = new Set('a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr svg path circle ellipse g line polygon polyline rect text defs linearGradient radialGradient stop use symbol clipPath mask foreignObject'.split(' '));
const webforgeSourceHints = () => ({
  name: 'webforge-framework-source-hints',
  apply: 'serve',
  enforce: 'pre',
  transform(code, id) {
    if (process.env.WEBFORGE_BRIDGE !== '1') return null;
    const cleanId = String(id || '').split('?', 1)[0].replace(/\\\\/g, '/');
    const match = /\.(jsx|tsx|vue|svelte)$/.exec(cleanId);
    if (!match) return null;
    const kind = match[1] === 'jsx' || match[1] === 'tsx' ? 'react' : match[1];
    let regionStart = 0;
    let regionEnd = code.length;
    if (kind === 'vue') {
      const opening = /<template(?:\s[^>]*)?>/i.exec(code);
      if (!opening || opening.index == null) return null;
      regionStart = opening.index + opening[0].length;
      const closing = code.toLowerCase().indexOf('</template', regionStart);
      regionEnd = closing >= 0 ? closing : code.length;
    }
    const root = process.cwd().replace(/\\\\/g, '/').replace(/\/$/, '');
    let sourcePath = cleanId;
    if (sourcePath.toLowerCase().startsWith(root.toLowerCase() + '/')) sourcePath = sourcePath.slice(root.length + 1);
    sourcePath = sourcePath.replace(/^\/+/, '');
    if (!sourcePath || sourcePath.includes('node_modules/')) return null;
    const sourceAttributePath = sourcePath.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    const insertions = [];
    let i = regionStart;
    let rawTag = null;
    const location = (index) => {
      const prefix = code.slice(0, index);
      const line = prefix.split('\n').length;
      const last = prefix.lastIndexOf('\n');
      return { line, column: index - last };
    };
    const tagEnd = (start) => {
      let quote = '';
      let braces = 0;
      for (let cursor = start; cursor < regionEnd; cursor += 1) {
        const char = code[cursor];
        if (quote) {
          if (char === '\\\\') { cursor += 1; continue; }
          if (char === quote) quote = '';
          continue;
        }
        if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
        if (char === '{') { braces += 1; continue; }
        if (char === '}' && braces > 0) { braces -= 1; continue; }
        if (char === '>' && braces === 0) return cursor;
      }
      return regionEnd - 1;
    };
    while (i < regionEnd) {
      const lt = code.indexOf('<', i);
      if (lt < 0 || lt >= regionEnd) break;
      if (code.startsWith('<!--', lt)) { const end = code.indexOf('-->', lt + 4); i = end < 0 ? regionEnd : end + 3; continue; }
      let cursor = lt + 1;
      const closing = code[cursor] === '/';
      if (closing) cursor += 1;
      if (!/[A-Za-z]/.test(code[cursor] || '')) { i = lt + 1; continue; }
      const nameStart = cursor;
      while (/[A-Za-z0-9:_-]/.test(code[cursor] || '')) cursor += 1;
      const tagName = code.slice(nameStart, cursor);
      const end = tagEnd(cursor);
      if (closing) {
        if (rawTag && tagName.toLowerCase() === rawTag) rawTag = null;
        i = end + 1;
        continue;
      }
      if (rawTag) { i = end + 1; continue; }
      const lower = tagName.toLowerCase();
      const nativeTag = kind === 'react' ? WEBFORGE_HTML_TAGS.has(tagName) || WEBFORGE_HTML_TAGS.has(lower) : /^[a-z][A-Za-z0-9:_-]*$/.test(tagName);
      if (!nativeTag) { i = end + 1; continue; }
      if ((kind === 'vue' || kind === 'svelte') && (lower === 'script' || lower === 'style')) { rawTag = lower; i = end + 1; continue; }
      const openingText = code.slice(lt, end + 1);
      if (!/\bdata-webforge-source-map\s*=/.test(openingText)) {
        const pos = location(lt);
        insertions.push({ index: cursor, text: ` data-webforge-source-map="${sourceAttributePath}:${pos.line}:${pos.column}"` });
      }
      i = end + 1;
    }
    if (!insertions.length) return null;
    let next = code;
    for (let index = insertions.length - 1; index >= 0; index -= 1) {
      const entry = insertions[index];
      next = next.slice(0, entry.index) + entry.text + next.slice(entry.index);
    }
    const lineCount = code.split('\n').length;
    const mappings = Array.from({ length: lineCount }, (_, line) => line === 0 ? 'AAAA' : 'AACA').join(';');
    return { code: next, map: { version: 3, names: [], sources: [cleanId], sourcesContent: [code], mappings } };
  },
});
"#;

const WEBFORGE_SOURCE_HINT_STRIP_PLUGIN: &str = r#"
const webforgeStripSourceHints = () => ({
  name: 'webforge-strip-source-hints',
  apply: 'build',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.(?:jsx|tsx|vue|svelte)$/.test(id)) return null;
    const next = code.replace(/\s+data-webforge-source-map=(?:"[^"]*"|'[^']*')/g, '');
    return next === code ? null : { code: next, map: null };
  },
});
"#;

pub(crate) fn runtime_vite_config(original_config: Option<&str>) -> String {
    let original_config = original_config.filter(|path| !path.trim().is_empty());
    let import = original_config
        .map(|path| {
            let specifier = format!("../../{}", path.replace('\\', "/"));
            let encoded = serde_json::to_string(&specifier).unwrap_or_else(|_| "\"../../vite.config.js\"".to_string());
            format!("import webforgeUserConfig from {encoded};\n")
        })
        .unwrap_or_default();
    let base = if original_config.is_some() {
        "  const base = typeof webforgeUserConfig === 'function' ? await webforgeUserConfig(env) : await webforgeUserConfig;\n"
    } else {
        "  const base = {};\n"
    };
    format!(
        "import {{ defineConfig }} from 'vite';\n{import}{bridge}\n{source}\nexport default defineConfig(async (env) => {{\n{base}  const resolved = base && typeof base === 'object' ? base : {{}};\n  const plugins = Array.isArray(resolved.plugins) ? resolved.plugins : resolved.plugins ? [resolved.plugins] : [];\n  return {{ ...resolved, plugins: [webforgeBridge(), webforgeSourceHints(), ...plugins] }};\n}});\n",
        bridge = WEBFORGE_VITE_BRIDGE_PLUGIN,
        source = WEBFORGE_SOURCE_HINT_PLUGIN,
    )
}

fn vite_config(framework: &str, typescript: bool, tailwind: bool) -> String {
    let extension_import = match framework {
        "react" => Some(("react", "@vitejs/plugin-react")),
        "vue" => Some(("vue", "@vitejs/plugin-vue")),
        "svelte" => Some(("svelte", "@sveltejs/vite-plugin-svelte")),
        _ => None,
    };
    let mut imports = vec!["import { defineConfig } from 'vite';".to_string()];
    let mut plugins = vec!["webforgeBridge()".to_string(), "webforgeSourceHints()".to_string(), "webforgeStripSourceHints()".to_string()];
    if let Some((call, package)) = extension_import {
        imports.push(format!("import {call} from '{package}';"));
        plugins.push(format!("{call}()"));
    }
    if tailwind {
        imports.push("import tailwindcss from '@tailwindcss/vite';".into());
        plugins.push("tailwindcss()".into());
    }
    let config = if plugins.is_empty() {
        "export default defineConfig({});".to_string()
    } else {
        format!("export default defineConfig({{\n  plugins: [{}],\n}});", plugins.join(", "))
    };
    let _ = typescript;
    format!("{}\n{}\n{}\n{}\n\n{}\n", imports.join("\n"), WEBFORGE_VITE_BRIDGE_PLUGIN, WEBFORGE_SOURCE_HINT_PLUGIN, WEBFORGE_SOURCE_HINT_STRIP_PLUGIN, config)
}

fn base_css(tailwind: bool) -> &'static str {
    if tailwind {
        "@import \"tailwindcss\";\n\n:root {\n  font-family: Inter, system-ui, sans-serif;\n  color: #e8ecf3;\n  background: #0d1117;\n}\nbody { margin: 0; min-width: 320px; min-height: 100vh; }\n"
    } else {
        ":root { font-family: Inter, system-ui, sans-serif; color: #e8ecf3; background: #0d1117; }\n* { box-sizing: border-box; }\nbody { margin: 0; min-width: 320px; min-height: 100vh; }\nmain { max-width: 960px; margin: 0 auto; padding: 72px 24px; }\nh1 { font-size: clamp(2.4rem, 8vw, 5.5rem); margin: 0 0 16px; }\np { color: #9da9bb; line-height: 1.7; }\n"
    }
}

fn create_static(root: &Path, name: &str, count: &mut usize) -> Result<(), String> {
    write(root, "index.html", &format!(r#"<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{name}</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <main>
    <p class="eyebrow">WEBFORGE 1.0.0</p>
    <h1>{name}</h1>
    <p>Edit HTML, CSS and JavaScript while Live Preview updates beside your code.</p>
    <button id="demo-button">Test console bridge</button>
  </main>
  <script src="scripts/main.js"></script>
</body>
</html>
"#), count)?;
    write(root, "styles/main.css", r#"* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #0b1018; color: #edf2fb; font-family: Inter, system-ui, sans-serif; }
main { width: min(900px, calc(100% - 48px)); margin: 0 auto; padding: 15vh 0; }
.eyebrow { color: #7fa9ff; font-weight: 800; letter-spacing: .14em; font-size: 12px; }
h1 { margin: 8px 0 16px; font-size: clamp(3rem, 9vw, 7rem); line-height: .92; }
p { max-width: 650px; color: #9eabbc; font-size: 18px; line-height: 1.7; }
button { margin-top: 24px; border: 1px solid #4564a3; border-radius: 9px; background: #284985; color: white; padding: 11px 16px; cursor: pointer; }
@media (max-width: 720px) {
  main { width: min(100% - 28px, 900px); padding: 10vh 0; }
  p { font-size: 16px; }
}
"#, count)?;
    write(root, "scripts/main.js", "document.querySelector('#demo-button')?.addEventListener('click', () => {\n  console.log('Hello from the WebForge preview console', { time: new Date().toISOString() });\n});\n", count)?;
    write(root, "README.md", &format!("# {name}\n\nCreated with WebForge 1.0.0.\n"), count)
}

fn create_react(root: &Path, name: &str, typescript: bool, tailwind: bool, count: &mut usize) -> Result<(), String> {
    write(root, "package.json", &package_json(&package_identifier(name), "react", typescript, tailwind), count)?;
    write(root, "index.html", "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"/><title>WebForge React</title></head><body><div id=\"root\"></div><script type=\"module\" src=\"/src/main.EXT\"></script></body></html>\n".replace("EXT", if typescript { "tsx" } else { "jsx" }).as_str(), count)?;
    let ext = if typescript { "tsx" } else { "jsx" };
    let root_target = if typescript { "document.getElementById('root')!" } else { "document.getElementById('root')" };
    write(root, &format!("src/main.{ext}"), &format!("import {{ StrictMode }} from 'react';\nimport {{ createRoot }} from 'react-dom/client';\nimport App from './App';\nimport './styles.css';\n\ncreateRoot({root_target}).render(<StrictMode><App /></StrictMode>);\n"), count)?;
    write(root, &format!("src/App.{ext}"), &format!(r#"export default function App() {{
  return (
    <main>
      <p>REACT · WEBFORGE 1.0.0</p>
      <h1>{name}</h1>
      <p>Run the Vite dev server from WebForge to enable HMR and framework inspection.</p>
    </main>
  );
}}
"#), count)?;
    write(root, "src/styles.css", base_css(tailwind), count)?;
    let config_ext = if typescript { "ts" } else { "js" };
    write(root, &format!("vite.config.{config_ext}"), &vite_config("react", typescript, tailwind), count)?;
    if typescript { write(root, "tsconfig.json", r#"{"compilerOptions":{"target":"ES2022","useDefineForClassFields":true,"lib":["ES2022","DOM","DOM.Iterable"],"allowJs":false,"skipLibCheck":true,"esModuleInterop":true,"allowSyntheticDefaultImports":true,"strict":true,"forceConsistentCasingInFileNames":true,"module":"ESNext","moduleResolution":"Bundler","resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx"},"include":["src"],"references":[]}
"#, count)?; }
    Ok(())
}

fn create_vue(root: &Path, name: &str, typescript: bool, tailwind: bool, count: &mut usize) -> Result<(), String> {
    write(root, "package.json", &package_json(&package_identifier(name), "vue", typescript, tailwind), count)?;
    write(root, "index.html", "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"/><title>WebForge Vue</title></head><body><div id=\"app\"></div><script type=\"module\" src=\"/src/main.EXT\"></script></body></html>\n".replace("EXT", if typescript { "ts" } else { "js" }).as_str(), count)?;
    let ext = if typescript { "ts" } else { "js" };
    write(root, &format!("src/main.{ext}"), "import { createApp } from 'vue';\nimport App from './App.vue';\nimport './style.css';\n\ncreateApp(App).mount('#app');\n", count)?;
    write(root, "src/App.vue", &format!(r#"<script setup{}>
const title = '{}';
</script>

<template>
  <main>
    <p>VUE · WEBFORGE 1.0.0</p>
    <h1>{{{{ title }}}}</h1>
    <p>Run Vite from WebForge to enable framework preview and source inspection.</p>
  </main>
</template>
"#, if typescript { " lang=\"ts\"" } else { "" }, name), count)?;
    write(root, "src/style.css", base_css(tailwind), count)?;
    let config_ext = if typescript { "ts" } else { "js" };
    write(root, &format!("vite.config.{config_ext}"), &vite_config("vue", typescript, tailwind), count)?;
    if typescript { write(root, "tsconfig.json", r#"{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"jsx":"preserve","skipLibCheck":true,"noEmit":true},"include":["src/**/*.ts","src/**/*.vue"]}
"#, count)?; }
    Ok(())
}

fn create_svelte(root: &Path, name: &str, typescript: bool, tailwind: bool, count: &mut usize) -> Result<(), String> {
    write(root, "package.json", &package_json(&package_identifier(name), "svelte", typescript, tailwind), count)?;
    write(root, "index.html", "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"UTF-8\"/><meta name=\"viewport\" content=\"width=device-width,initial-scale=1.0\"/><title>WebForge Svelte</title></head><body><div id=\"app\"></div><script type=\"module\" src=\"/src/main.EXT\"></script></body></html>\n".replace("EXT", if typescript { "ts" } else { "js" }).as_str(), count)?;
    let ext = if typescript { "ts" } else { "js" };
    let mount_target = if typescript { "document.getElementById('app')!" } else { "document.getElementById('app')" };
    write(root, &format!("src/main.{ext}"), &format!("import {{ mount }} from 'svelte';\nimport App from './App.svelte';\nimport './app.css';\n\nmount(App, {{ target: {mount_target} }});\n"), count)?;
    write(root, "src/App.svelte", &format!(r#"<script{}>
  let title{} = '{}';
</script>

<main>
  <p>SVELTE · WEBFORGE 1.0.0</p>
  <h1>{{title}}</h1>
  <p>Run Vite from WebForge to enable framework preview and source inspection.</p>
</main>
"#, if typescript { " lang=\"ts\"" } else { "" }, if typescript { ": string" } else { "" }, name), count)?;
    write(root, "src/app.css", base_css(tailwind), count)?;
    let config_ext = if typescript { "ts" } else { "js" };
    write(root, &format!("vite.config.{config_ext}"), &vite_config("svelte", typescript, tailwind), count)?;
    if typescript { write(root, "tsconfig.json", r#"{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":true,"allowJs":true,"checkJs":true,"isolatedModules":true,"noEmit":true},"include":["src/**/*.ts","src/**/*.svelte"]}
"#, count)?; }
    Ok(())
}

pub(crate) fn create_project_at(request: &CreateProjectRequest) -> Result<CreatedProject, String> {
    let parent = fs::canonicalize(&request.parent_path).map_err(|error| format!("unable to open project parent: {error}"))?;
    if !parent.is_dir() { return Err("project parent is not a directory".into()); }
    let name = validate_name(&request.name)?;
    let target: PathBuf = parent.join(&name);
    if target.exists() { return Err("a file or folder with this project name already exists".into()); }
    fs::create_dir(&target).map_err(|error| format!("unable to create project directory: {error}"))?;

    let tailwind = request.css_preset == "tailwind" && request.template != "static";
    let mut count = 0;
    let result = match request.template.as_str() {
        "static" => create_static(&target, &name, &mut count),
        "react" => create_react(&target, &name, request.typescript, tailwind, &mut count),
        "vue" => create_vue(&target, &name, request.typescript, tailwind, &mut count),
        "svelte" => create_svelte(&target, &name, request.typescript, tailwind, &mut count),
        _ => Err("unsupported project template".into()),
    };
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }
    if let Err(error) = write(&target, ".gitignore", "node_modules\ndist\n.DS_Store\n", &mut count) {
        let _ = fs::remove_dir_all(&target);
        return Err(error);
    }

    Ok(CreatedProject {
        path: target.to_string_lossy().to_string(),
        name,
        template: request.template.clone(),
        files_created: count,
    })
}

#[tauri::command]
pub fn create_project(request: CreateProjectRequest) -> Result<CreatedProject, String> {
    create_project_at(&request)
}

#[cfg(test)]
mod tests {
    use super::{create_project_at, package_identifier, package_json, runtime_vite_config, validate_name, vite_config, CreateProjectRequest};
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn temp_dir() -> std::path::PathBuf {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("webforge-generator-{suffix}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn npm_package_identifier_is_portable() {
        assert_eq!(package_identifier("My Site 2026!"), "my-site-2026");
    }

    #[test]
    fn generated_package_json_is_valid() {
        let package = package_json("my-app", "react", true, true);
        let value: serde_json::Value = serde_json::from_str(&package).unwrap();
        assert_eq!(value["name"], "my-app");
        assert_eq!(value["scripts"]["dev"], "vite");
        assert_eq!(value["devDependencies"]["@tailwindcss/vite"], "latest");
    }

    #[test]
    fn generated_vite_config_keeps_hmr_bridge_opt_in() {
        let config = vite_config("react", true, false);
        assert!(config.contains("transformIndexHtml"));
        assert!(config.contains("WEBFORGE_BRIDGE"));
        assert!(config.contains("webforgeBridge()"));
        assert!(config.contains("vite-hmr"));
        assert!(config.contains("framework-inspect"));
        assert!(config.contains("framework-source-edit"));
        assert!(config.contains("webforgeSourceHints()"));
        assert!(config.contains("data-webforge-source-map"));
        assert!(config.contains("webforgeStripSourceHints()"));
        assert!(config.contains("apply: 'build'"));
    }

    #[test]
    fn runtime_vite_config_preserves_user_config() {
        let config = runtime_vite_config(Some("config/vite.dev.ts"));
        assert!(config.contains("../../config/vite.dev.ts"));
        assert!(config.contains("webforgeBridge()"));
        assert!(config.contains("webforgeSourceHints()"));
        assert!(config.contains("...plugins"));
    }

    #[test]
    fn rejects_windows_reserved_project_names() {
        assert!(validate_name("CON").is_err());
        assert!(validate_name("nul.txt").is_err());
    }

    #[test]
    fn creates_static_starter() {
        let parent = temp_dir();
        let result = create_project_at(&CreateProjectRequest { parent_path: parent.to_string_lossy().into(), name: "site".into(), template: "static".into(), typescript: false, css_preset: "css".into() }).unwrap();
        assert!(std::path::Path::new(&result.path).join("index.html").exists());
        assert!(std::path::Path::new(&result.path).join("scripts/main.js").exists());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn creates_tailwind_react_template() {
        let parent = temp_dir();
        let result = create_project_at(&CreateProjectRequest { parent_path: parent.to_string_lossy().into(), name: "react-site".into(), template: "react".into(), typescript: true, css_preset: "tailwind".into() }).unwrap();
        let package = fs::read_to_string(std::path::Path::new(&result.path).join("package.json")).unwrap();
        assert!(package.contains("@tailwindcss/vite"));
        assert!(std::path::Path::new(&result.path).join("src/main.tsx").exists());
        let _ = fs::remove_dir_all(parent);
    }
}
