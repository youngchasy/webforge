use crate::workspace::{clean_relative_path, workspace_root, WorkspaceState};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, RwLock,
    },
    thread,
    time::Duration,
};
use tauri::State;


const WEBFORGE_BRIDGE: &str = r#"<script data-webforge-bridge>
(() => {
  if (window.__WEBFORGE_BRIDGE__) return;
  window.__WEBFORGE_BRIDGE__ = true;
  const send = (payload) => window.parent.postMessage({ __webforge: true, ...payload }, '*');
  const stringify = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const stackLocation = (args) => {
    for (const value of args) {
      const stack = value instanceof Error ? value.stack : null;
      const match = typeof stack === 'string' ? stack.match(/((?:https?|file):\/\/[^\s)]+):(\d+):(\d+)/) : null;
      if (match) return { source: match[1], line: Number(match[2]), column: Number(match[3]) };
    }
    return {};
  };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[level]?.bind(console);
    if (!original) continue;
    console[level] = (...args) => {
      original(...args);
      send({ kind: 'console', level, text: args.map(stringify).join(' '), ...stackLocation(args) });
    };
  }
  window.addEventListener('error', (event) => {
    send({ kind: 'console', level: 'error', text: event.message || 'Uncaught error', source: event.filename || location.href, line: event.lineno || null, column: event.colno || null });
  });
  window.addEventListener('unhandledrejection', (event) => {
    send({ kind: 'console', level: 'error', text: `Unhandled promise rejection: ${stringify(event.reason)}` });
  });

  const devtoolsLimit = (value, limit = 65536) => {
    const text = typeof value === 'string' ? value : value == null ? '' : stringify(value);
    return text.length > limit ? text.slice(0, limit) + '\n…[truncated by WebForge]' : text;
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


  let inspectorEnabled = false;
  let hovered = null;
  const overlay = document.createElement('div');
  overlay.setAttribute('data-webforge-overlay', 'true');
  Object.assign(overlay.style, {
    position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483647',
    border: '1px solid #6f9dff', background: 'rgba(80, 130, 255, .12)', boxSizing: 'border-box'
  });
  const label = document.createElement('div');
  Object.assign(label.style, {
    position: 'absolute', left: '-1px', top: '-22px', height: '20px', padding: '2px 6px',
    background: '#315aaf', color: 'white', font: '11px/16px ui-monospace, monospace', whiteSpace: 'nowrap'
  });
  overlay.appendChild(label);
  const marginOverlay = document.createElement('div');
  marginOverlay.setAttribute('data-webforge-overlay', 'true');
  Object.assign(marginOverlay.style, { position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483645', border: '1px dashed rgba(245, 158, 11, .9)', background: 'rgba(245, 158, 11, .06)', boxSizing: 'border-box' });
  const contentOverlay = document.createElement('div');
  contentOverlay.setAttribute('data-webforge-overlay', 'true');
  Object.assign(contentOverlay.style, { position: 'fixed', pointerEvents: 'none', display: 'none', zIndex: '2147483646', border: '1px dashed rgba(34, 211, 238, .9)', background: 'rgba(34, 211, 238, .04)', boxSizing: 'border-box' });
  document.documentElement.appendChild(marginOverlay);
  document.documentElement.appendChild(contentOverlay);
  document.documentElement.appendChild(overlay);
  const resizeHandles = {};
  for (const axis of ['e', 's', 'se']) {
    const handle = document.createElement('div');
    handle.setAttribute('data-webforge-overlay', 'true');
    handle.dataset.axis = axis;
    Object.assign(handle.style, { position: 'absolute', width: '9px', height: '9px', border: '1px solid #1d4ed8', borderRadius: '2px', background: '#dbeafe', pointerEvents: 'auto', display: 'none', boxSizing: 'border-box' });
    if (axis.includes('e')) handle.style.right = '-5px'; else handle.style.left = '50%';
    if (axis.includes('s')) handle.style.bottom = '-5px'; else handle.style.top = '50%';
    if (axis === 'e') { handle.style.top = '50%'; handle.style.transform = 'translateY(-50%)'; handle.style.cursor = 'ew-resize'; }
    if (axis === 's') { handle.style.left = '50%'; handle.style.transform = 'translateX(-50%)'; handle.style.cursor = 'ns-resize'; }
    if (axis === 'se') handle.style.cursor = 'nwse-resize';
    overlay.appendChild(handle); resizeHandles[axis] = handle;
  }

  const cssEscape = (value) => window.CSS?.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const selectorFor = (element) => {
    if (!(element instanceof Element)) return '';
    if (element === document.documentElement) return 'html';
    if (element === document.body) return 'body';
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const classes = [...current.classList].slice(0, 2).map(cssEscape);
      if (classes.length) part += `.${classes.join('.')}`;
      const siblings = current.parentElement ? [...current.parentElement.children].filter((child) => child.tagName === current.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
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
  const pseudoForSelector = (selector) => {
    if (/:focus-visible\b/.test(selector)) return 'focus-visible';
    if (/:hover\b/.test(selector)) return 'hover';
    if (/:focus\b/.test(selector)) return 'focus';
    if (/:active\b/.test(selector)) return 'active';
    return 'normal';
  };
  const baseSelectorForState = (selector) => selector.replace(/:(?:hover|focus-visible|focus|active)\b/g, '');
  const ruleContext = (rule) => {
    const name = rule?.constructor?.name || '';
    if (name === 'CSSMediaRule') return { name: 'media', prelude: rule.conditionText || '' };
    if (name === 'CSSSupportsRule') return { name: 'supports', prelude: rule.conditionText || '' };
    if (name === 'CSSContainerRule') return { name: 'container', prelude: rule.conditionText || rule.containerName || '' };
    if (name === 'CSSLayerBlockRule') return { name: 'layer', prelude: rule.name || '' };
    if (name === 'CSSScopeRule') return { name: 'scope', prelude: String(rule.cssText || '').split('{')[0].replace(/^@scope\s*/i, '').trim() };
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
              if (baseSelector && element.matches(baseSelector)) matches.push({
                selector: candidate, source, media: contexts.slice().reverse().find((item) => item.name === 'media')?.prelude || null,
                contexts, pseudo, declarations: declarationsFor(rule.style), sourceOrder: currentOrder, importantDeclarations
              });
            } catch {}
          }
          continue;
        }
        if (rule instanceof CSSMediaRule) {
          try { if (!matchMedia(rule.conditionText).matches) continue; } catch {}
        }
        if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
          try { if (!CSS.supports(rule.conditionText)) continue; } catch {}
        }
        if ('cssRules' in rule) {
          const context = ruleContext(rule);
          try { visit(rule.cssRules, source, context ? [...contexts, context] : contexts); } catch {}
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { visit(sheet.cssRules, sheet.href || null, []); } catch {}
    }
    return matches.slice(-40);
  };
  const inheritedProperties = ['color','font-family','font-size','font-weight','line-height','letter-spacing','text-align','visibility','cursor'];
  const inheritedStylesFor = (element) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(inheritedProperties.map((property) => [property, style.getPropertyValue(property).trim()]));
  };
  const ancestorTraceFor = (element) => {
    const ancestors = [];
    let current = element.parentElement;
    while (current instanceof Element && ancestors.length < 8) {
      ancestors.push({
        selector: selectorFor(current), tagName: current.tagName.toLowerCase(), id: current.id || '',
        sourcePath: null, sourceLine: null, sourceColumn: null, sourceConfidence: 'exact',
        styles: inheritedStylesFor(current), inlineStyles: declarationsFor(current.style), cssRules: rulesFor(current)
      });
      current = current.parentElement;
    }
    return ancestors;
  };
  const attributesFor = (element) => Object.fromEntries([...element.attributes]
    .filter((attr) => !attr.name.startsWith('data-webforge-'))
    .map((attr) => [attr.name, attr.value]));
  const detailsFor = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      kind: 'inspect', sourceId: element.getAttribute('data-webforge-source') || '', selector: selectorFor(element), tagName: element.tagName.toLowerCase(), id: element.id || '',
      sourcePath: null, sourceLine: null, sourceColumn: null, sourceKind: 'static', sourceConfidence: 'exact', sourceOrigin: 'html-byte-offset', ancestors: ancestorTraceFor(element), editableSource: Boolean(element.getAttribute('data-webforge-source')),
      classes: [...element.classList], attributes: attributesFor(element),
      text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 180),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      inlineStyles: declarationsFor(element.style), cssRules: rulesFor(element),
      styles: {
        display: style.display, position: style.position, boxSizing: style.boxSizing,
        width: style.width, height: style.height, minWidth: style.minWidth, maxWidth: style.maxWidth, minHeight: style.minHeight, maxHeight: style.maxHeight,
        margin: style.margin, marginTop: style.marginTop, marginRight: style.marginRight, marginBottom: style.marginBottom, marginLeft: style.marginLeft,
        padding: style.padding, paddingTop: style.paddingTop, paddingRight: style.paddingRight, paddingBottom: style.paddingBottom, paddingLeft: style.paddingLeft,
        gap: style.gap, rowGap: style.rowGap, columnGap: style.columnGap,
        flexDirection: style.flexDirection, flexWrap: style.flexWrap, alignItems: style.alignItems, alignContent: style.alignContent, justifyContent: style.justifyContent,
        gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows, gridAutoFlow: style.gridAutoFlow, placeItems: style.placeItems,
        color: style.color, background: style.background, backgroundColor: style.backgroundColor, backgroundImage: style.backgroundImage,
        fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        textAlign: style.textAlign, textTransform: style.textTransform, textDecoration: style.textDecoration,
        border: style.border, borderRadius: style.borderRadius, boxShadow: style.boxShadow, textShadow: style.textShadow, opacity: style.opacity,
        transform: style.transform, transformOrigin: style.transformOrigin, zIndex: style.zIndex, overflow: style.overflow,
        transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration, transitionTimingFunction: style.transitionTimingFunction, transitionDelay: style.transitionDelay,
        animationName: style.animationName, animationDuration: style.animationDuration, animationTimingFunction: style.animationTimingFunction, animationDelay: style.animationDelay, animationIterationCount: style.animationIterationCount, animationFillMode: style.animationFillMode,
        containerType: style.getPropertyValue('container-type'), containerName: style.getPropertyValue('container-name')
      }
    };
  };
  const treeFor = () => {
    let count = 0;
    const visit = (element) => {
      if (!(element instanceof Element) || element.hasAttribute('data-webforge-overlay')) return null;
      if (++count > 600) return null;
      const directText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent || '').join(' ').trim().replace(/\s+/g, ' ').slice(0, 80);
      return {
        sourceId: element.getAttribute('data-webforge-source') || '', selector: selectorFor(element), tagName: element.tagName.toLowerCase(), id: element.id || '',
        classes: [...element.classList], text: directText,
        children: [...element.children].map(visit).filter(Boolean)
      };
    };
    return visit(document.body);
  };
  const sendTree = () => send({ kind: 'dom-tree', tree: treeFor() });
  const numeric = (value) => { const parsed = Number.parseFloat(value); return Number.isFinite(parsed) ? parsed : 0; };
  const canResize = (element) => element instanceof Element && !['HTML','BODY'].includes(element.tagName) && Boolean(element.getAttribute('data-webforge-source'));
  const paint = (element) => {
    if (!(element instanceof Element) || element === overlay || overlay.contains(element) || element.hasAttribute('data-webforge-overlay')) return;
    hovered = element;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    overlay.style.display = 'block'; overlay.style.left = rect.left + 'px'; overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px'; overlay.style.height = rect.height + 'px';
    const mt = numeric(style.marginTop), mr = numeric(style.marginRight), mb = numeric(style.marginBottom), ml = numeric(style.marginLeft);
    marginOverlay.style.display = 'block'; marginOverlay.style.left = (rect.left - ml) + 'px'; marginOverlay.style.top = (rect.top - mt) + 'px'; marginOverlay.style.width = (rect.width + ml + mr) + 'px'; marginOverlay.style.height = (rect.height + mt + mb) + 'px';
    const bl = numeric(style.borderLeftWidth), br = numeric(style.borderRightWidth), bt = numeric(style.borderTopWidth), bb = numeric(style.borderBottomWidth);
    const pl = numeric(style.paddingLeft), pr = numeric(style.paddingRight), pt = numeric(style.paddingTop), pb = numeric(style.paddingBottom);
    contentOverlay.style.display = 'block'; contentOverlay.style.left = (rect.left + bl + pl) + 'px'; contentOverlay.style.top = (rect.top + bt + pt) + 'px'; contentOverlay.style.width = Math.max(0, rect.width - bl - br - pl - pr) + 'px'; contentOverlay.style.height = Math.max(0, rect.height - bt - bb - pt - pb) + 'px';
    label.textContent = element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') + ' · ' + Math.round(rect.width) + '×' + Math.round(rect.height) + ' · m ' + style.margin + ' · p ' + style.padding;
    const editable = canResize(element);
    for (const handle of Object.values(resizeHandles)) handle.style.display = editable ? 'block' : 'none';
  };
  const beginResize = (axis, event) => {
    if (!hovered || !canResize(hovered) || !(hovered instanceof HTMLElement || hovered instanceof SVGElement)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const element = hovered; const rect = element.getBoundingClientRect(); const startX = event.clientX; const startY = event.clientY;
    const declarations = {};
    const move = (next) => {
      if (axis.includes('e')) { const width = Math.max(1, Math.round(rect.width + next.clientX - startX)); element.style.setProperty('width', width + 'px'); declarations.width = width + 'px'; }
      if (axis.includes('s')) { const height = Math.max(1, Math.round(rect.height + next.clientY - startY)); element.style.setProperty('height', height + 'px'); declarations.height = height + 'px'; }
      paint(element);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', finish, true);
      const sourceId = element.getAttribute('data-webforge-source') || ''; const selector = selectorFor(element);
      if (sourceId && Object.keys(declarations).length) send({ kind: 'designer-style-commit', sourceId, selector, declarations });
      send(detailsFor(element)); paint(element);
    };
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', finish, true);
  };
  for (const [axis, handle] of Object.entries(resizeHandles)) handle.addEventListener('pointerdown', (event) => beginResize(axis, event), true);
  const find = (selector) => {
    if (typeof selector !== 'string' || !selector) return null;
    try { return document.querySelector(selector); } catch { return null; }
  };
  const findSource = (sourceId) => {
    if (typeof sourceId !== 'string' || !/^b\d+$/.test(sourceId)) return null;
    try { return document.querySelector(`[data-webforge-source=\"${sourceId}\"]`); } catch { return null; }
  };

  let applyingSyncedScroll = false;
  let scrollScheduled = false;
  const sendViewportScroll = () => {
    scrollScheduled = false;
    if (applyingSyncedScroll) return;
    const maxX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
    const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    send({ kind: 'viewport-scroll', xRatio: maxX ? scrollX / maxX : 0, yRatio: maxY ? scrollY / maxY : 0 });
  };
  window.addEventListener('scroll', () => {
    if (!scrollScheduled) { scrollScheduled = true; requestAnimationFrame(sendViewportScroll); }
    if (inspectorEnabled && hovered) paint(hovered);
  }, true);

  document.addEventListener('mousemove', (event) => { if (inspectorEnabled) paint(event.target); }, true);
  document.addEventListener('click', (event) => {
    if (!inspectorEnabled || !(event.target instanceof Element) || event.target.hasAttribute('data-webforge-overlay') || overlay.contains(event.target)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    paint(event.target); send(detailsFor(event.target));
  }, true);
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.__webforge !== true) return;
    if (data.action === 'setInspector') {
      inspectorEnabled = Boolean(data.enabled);
      if (!inspectorEnabled) { overlay.style.display = 'none'; marginOverlay.style.display = 'none'; contentOverlay.style.display = 'none'; hovered = null; }
      return;
    }
    if (data.action === 'requestTree') { sendTree(); return; }
    if (data.action === 'applyStyle') {
      const element = findSource(data.sourceId) || find(data.selector);
      if ((element instanceof HTMLElement || element instanceof SVGElement) && typeof data.property === 'string') {
        element.style.setProperty(data.property, String(data.value ?? ''));
        send(detailsFor(element)); paint(element);
      }
      return;
    }
    if (data.action === 'syncScroll') {
      const maxX = Math.max(0, document.documentElement.scrollWidth - innerWidth);
      const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      applyingSyncedScroll = true;
      scrollTo(maxX * Number(data.xRatio || 0), maxY * Number(data.yRatio || 0));
      setTimeout(() => { applyingSyncedScroll = false; }, 60);
      return;
    }
    if (data.action === 'select') {
      const element = findSource(data.sourceId) || find(data.selector);
      if (element) { paint(element); send(detailsFor(element)); }
    }
  });
  send({ kind: 'bridge-ready', url: location.href, capabilities: ['console', 'dom-source', 'css-contexts', 'scroll-sync', 'inheritance-trace', 'visual-designer-2', 'resize-handles', 'box-model-overlay', 'network-devtools', 'storage-devtools', 'performance-devtools', 'runtime-a11y'] });
  queueMicrotask(sendTree);
})();
</script>"#;


fn find_html_tag_end(html: &str, start: usize) -> Option<usize> {
    let bytes = html.as_bytes();
    let mut quote = None;
    let mut index = start;
    while index < bytes.len() {
        let byte = bytes[index];
        if let Some(active) = quote {
            if byte == active { quote = None; }
        } else if byte == b'\'' || byte == b'"' {
            quote = Some(byte);
        } else if byte == b'>' {
            return Some(index);
        }
        index += 1;
    }
    None
}

fn annotate_source_locations(html: &str) -> String {
    let bytes = html.as_bytes();
    let lower = html.to_ascii_lowercase();
    let mut insertions: Vec<(usize, String)> = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        let Some(relative) = html[index..].find('<') else { break; };
        let start = index + relative;
        if html[start..].starts_with("<!--") {
            index = html[start + 4..].find("-->").map(|offset| start + 4 + offset + 3).unwrap_or(bytes.len());
            continue;
        }
        let next = bytes.get(start + 1).copied().unwrap_or_default();
        if next == b'!' || next == b'?' || next == b'/' {
            index = find_html_tag_end(html, start + 2).map(|value| value + 1).unwrap_or(bytes.len());
            continue;
        }
        if !next.is_ascii_alphabetic() {
            index = start + 1;
            continue;
        }

        let mut name_end = start + 1;
        while let Some(byte) = bytes.get(name_end) {
            if byte.is_ascii_alphanumeric() || matches!(*byte, b':' | b'_' | b'-') { name_end += 1; } else { break; }
        }
        let tag_name = &lower[start + 1..name_end];
        let Some(tag_end) = find_html_tag_end(html, name_end) else { break; };
        insertions.push((name_end, format!(" data-webforge-source=\"b{start}\"")));

        if matches!(tag_name, "script" | "style" | "textarea" | "title") {
            let closing = format!("</{tag_name}");
            if let Some(relative_close) = lower[tag_end + 1..].find(&closing) {
                let close_start = tag_end + 1 + relative_close;
                index = find_html_tag_end(html, close_start + closing.len()).map(|value| value + 1).unwrap_or(bytes.len());
                continue;
            }
        }
        index = tag_end + 1;
    }

    if insertions.is_empty() { return html.to_string(); }
    let added: usize = insertions.iter().map(|(_, value)| value.len()).sum();
    let mut output = String::with_capacity(html.len() + added);
    let mut cursor = 0;
    for (at, value) in insertions {
        output.push_str(&html[cursor..at]);
        output.push_str(&value);
        cursor = at;
    }
    output.push_str(&html[cursor..]);
    output
}

fn inject_bridge(html: &str) -> String {
    if html.contains("data-webforge-bridge") {
        return html.to_string();
    }
    let annotated = annotate_source_locations(html);
    let html = annotated.as_str();
    if let Some(index) = html.to_ascii_lowercase().rfind("</body>") {
        let mut output = String::with_capacity(html.len() + WEBFORGE_BRIDGE.len());
        output.push_str(&html[..index]);
        output.push_str(WEBFORGE_BRIDGE);
        output.push_str(&html[index..]);
        output
    } else {
        format!("{html}{WEBFORGE_BRIDGE}")
    }
}

struct RunningPreviewServer {
    stop: Arc<AtomicBool>,
}

pub struct PreviewServerState {
    root: RwLock<Option<PathBuf>>,
    overlays: Arc<RwLock<HashMap<String, String>>>,
    running: Mutex<Option<RunningPreviewServer>>,
    production_running: Mutex<Option<RunningPreviewServer>>,
}

impl PreviewServerState {
    pub fn new() -> Self {
        Self {
            root: RwLock::new(None),
            overlays: Arc::new(RwLock::new(HashMap::new())),
            running: Mutex::new(None),
            production_running: Mutex::new(None),
        }
    }

    pub fn set_root(&self, root: PathBuf) -> Result<(), String> {
        if let Ok(mut production) = self.production_running.lock() {
            if let Some(previous) = production.take() { previous.stop.store(true, Ordering::Relaxed); }
        }
        *self.root.write().map_err(|_| "preview root lock is poisoned".to_string())? = Some(root);
        self.overlays
            .write()
            .map_err(|_| "preview overlay lock is poisoned".to_string())?
            .clear();
        Ok(())
    }
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err("invalid percent encoding in preview URL".into());
            }
            let high = hex_value(bytes[index + 1]).ok_or_else(|| "invalid percent encoding".to_string())?;
            let low = hex_value(bytes[index + 2]).ok_or_else(|| "invalid percent encoding".to_string())?;
            output.push((high << 4) | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).map_err(|_| "preview URL is not valid UTF-8".to_string())
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "xml" => "application/xml; charset=utf-8",
        "txt" | "md" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8], head_only: bool) {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

fn resolve_request_path(root: &Path, raw_target: &str) -> Result<(String, PathBuf), String> {
    let without_query = raw_target.split(|value| value == '?' || value == '#').next().unwrap_or("/");
    let decoded = percent_decode(without_query)?;
    let relative_url = decoded.trim_start_matches('/');
    let relative_url = if relative_url.is_empty() { "index.html" } else { relative_url };
    let relative = clean_relative_path(relative_url)?;
    let mut candidate = root.join(&relative);

    if candidate.is_dir() {
        candidate = candidate.join("index.html");
    }

    let canonical = fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !canonical.starts_with(root) {
        return Err("preview request escaped the workspace".into());
    }
    let key = canonical
        .strip_prefix(root)
        .unwrap_or(&canonical)
        .to_string_lossy()
        .replace('\\', "/");
    Ok((key, canonical))
}

fn handle_connection(
    mut stream: TcpStream,
    root: &Path,
    overlays: &Arc<RwLock<HashMap<String, String>>>,
    bridge: bool,
) {
    let mut buffer = [0_u8; 16 * 1024];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(value) if value > 0 => value,
        _ => return,
    };
    let request = String::from_utf8_lossy(&buffer[..bytes_read]);
    let mut parts = request.lines().next().unwrap_or_default().split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or("/");
    let head_only = method == "HEAD";
    if method != "GET" && !head_only {
        response(&mut stream, "405 Method Not Allowed", "text/plain; charset=utf-8", b"Method not allowed", false);
        return;
    }

    match resolve_request_path(root, target) {
        Ok((key, path)) => {
            if let Ok(guard) = overlays.read() {
                if let Some(content) = guard.get(&key) {
                    if bridge && matches!(path.extension().and_then(|value| value.to_str()), Some("html") | Some("htm")) {
                        let bridged = inject_bridge(content);
                        response(&mut stream, "200 OK", mime_for(&path), bridged.as_bytes(), head_only);
                    } else {
                        response(&mut stream, "200 OK", mime_for(&path), content.as_bytes(), head_only);
                    }
                    return;
                }
            }
            match fs::read(&path) {
                Ok(bytes) => {
                    if bridge && matches!(path.extension().and_then(|value| value.to_str()), Some("html") | Some("htm")) {
                        let html = String::from_utf8_lossy(&bytes);
                        let bridged = inject_bridge(&html);
                        response(&mut stream, "200 OK", mime_for(&path), bridged.as_bytes(), head_only);
                    } else {
                        response(&mut stream, "200 OK", mime_for(&path), &bytes, head_only);
                    }
                }
                Err(_) => response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found", head_only),
            }
        }
        Err(_) => response(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"Not found", head_only),
    }
}

#[tauri::command]
pub fn sync_preview_root(
    workspace: State<'_, WorkspaceState>,
    state: State<'_, PreviewServerState>,
) -> Result<(), String> {
    state.set_root(workspace_root(&workspace)?)
}

fn start_server(
    root: PathBuf,
    overlays: Arc<RwLock<HashMap<String, String>>>,
    bridge: bool,
    slot: &Mutex<Option<RunningPreviewServer>>,
) -> Result<String, String> {
    let canonical_root = fs::canonicalize(&root).map_err(|error| format!("unable to open preview root {}: {error}", root.display()))?;
    if !canonical_root.is_dir() { return Err("preview root is not a directory".into()); }
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let local = listener.local_addr().map_err(|error| error.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);

    thread::spawn(move || {
        while !thread_stop.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle_connection(stream, &canonical_root, &overlays, bridge),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(20)),
                Err(_) => break,
            }
        }
    });

    let mut running = slot.lock().map_err(|_| "preview server lock is poisoned".to_string())?;
    if let Some(previous) = running.take() { previous.stop.store(true, Ordering::Relaxed); }
    *running = Some(RunningPreviewServer { stop });
    Ok(format!("http://{local}"))
}

#[tauri::command]
pub fn start_preview_server(state: State<'_, PreviewServerState>) -> Result<String, String> {
    let active_root = state
        .root
        .read()
        .map_err(|_| "preview root lock is poisoned".to_string())?
        .clone()
        .ok_or_else(|| "no workspace is open for preview".to_string())?;
    start_server(active_root, Arc::clone(&state.overlays), true, &state.running)
}

#[tauri::command]
pub fn start_build_preview_server(
    output_dir: String,
    workspace: State<'_, WorkspaceState>,
    state: State<'_, PreviewServerState>,
) -> Result<String, String> {
    let workspace_root = workspace_root(&workspace)?;
    let relative = clean_relative_path(&output_dir)?;
    if relative.as_os_str().is_empty() { return Err("build output directory is required".into()); }
    let candidate = workspace_root.join(relative);
    let canonical = fs::canonicalize(&candidate).map_err(|error| format!("build output is unavailable at {}: {error}", candidate.display()))?;
    if !canonical.starts_with(&workspace_root) { return Err("build output escaped the workspace".into()); }
    if !canonical.join("index.html").is_file() { return Err(format!("{} does not contain index.html", canonical.display())); }
    start_server(canonical, Arc::new(RwLock::new(HashMap::new())), false, &state.production_running)
}

#[tauri::command]
pub fn stop_build_preview_server(state: State<'_, PreviewServerState>) -> Result<(), String> {
    let mut running = state.production_running.lock().map_err(|_| "preview server lock is poisoned".to_string())?;
    if let Some(previous) = running.take() { previous.stop.store(true, Ordering::Relaxed); }
    Ok(())
}

#[tauri::command]
pub fn set_preview_overlays(
    files: HashMap<String, String>,
    state: State<'_, PreviewServerState>,
) -> Result<(), String> {
    let mut clean = HashMap::with_capacity(files.len());
    for (path, content) in files {
        let normalized = clean_relative_path(&path)?
            .to_string_lossy()
            .replace('\\', "/");
        if !normalized.is_empty() {
            clean.insert(normalized, content);
        }
    }
    *state
        .overlays
        .write()
        .map_err(|_| "preview overlay lock is poisoned".to_string())? = clean;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{annotate_source_locations, inject_bridge, mime_for, percent_decode};
    use std::path::Path;

    #[test]
    fn preview_url_decoding_handles_spaces() {
        assert_eq!(percent_decode("images/hero%20large.webp").unwrap(), "images/hero large.webp");
    }

    #[test]
    fn bridge_is_injected_before_body_close() {
        let html = inject_bridge("<html><body><h1>Hello</h1></body></html>");
        assert!(html.contains("data-webforge-bridge"));
        assert!(html.contains("kind: 'dom-tree'"));
        assert!(html.contains("css-contexts"));
        assert!(html.contains("viewport-scroll"));
        assert!(html.contains("syncScroll"));
        assert!(html.contains("data-webforge-source"));
        assert!(!html.contains("kind: 'document-change'"));
        assert!(html.find("data-webforge-bridge").unwrap() < html.find("</body>").unwrap());
    }

    #[test]
    fn bridge_injection_is_idempotent() {
        let once = inject_bridge("<html><body>Hello</body></html>");
        let twice = inject_bridge(&once);
        assert_eq!(once, twice);
    }

    #[test]
    fn common_web_mime_types_are_reported() {
        assert_eq!(mime_for(Path::new("styles/app.css")), "text/css; charset=utf-8");
        assert_eq!(mime_for(Path::new("scripts/app.mjs")), "text/javascript; charset=utf-8");
        assert_eq!(mime_for(Path::new("assets/logo.svg")), "image/svg+xml");
    }

    #[test]
    fn source_annotation_uses_original_utf8_offsets() {
        let html = "<!doctype html><html><body><p>Привет</p><div>ok</div></body></html>";
        let annotated = annotate_source_locations(html);
        let div_offset = html.find("<div>").unwrap();
        assert!(annotated.contains(&format!("<div data-webforge-source=\"b{div_offset}\">")));
        assert!(annotated.contains("<p data-webforge-source="));
    }

}
