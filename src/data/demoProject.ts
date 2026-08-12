import type { WorkspaceEntry } from "../types/workspace";

export const demoTree: WorkspaceEntry = {
  name: "webforge-demo",
  relativePath: "",
  kind: "directory",
  children: [
    { name: "index.html", relativePath: "index.html", kind: "file" },
    {
      name: "styles",
      relativePath: "styles",
      kind: "directory",
      children: [{ name: "main.css", relativePath: "styles/main.css", kind: "file" }],
    },
    {
      name: "scripts",
      relativePath: "scripts",
      kind: "directory",
      children: [{ name: "app.js", relativePath: "scripts/app.js", kind: "file" }],
    },
  ],
};

export const demoFiles: Record<string, string> = {
  "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WebForge Preview</title>
  <link rel="stylesheet" href="styles/main.css" />
</head>
<body>
  <main class="hero">
    <span class="eyebrow">WEBFORGE / LIVE PREVIEW</span>
    <h1>Build websites without leaving your workspace.</h1>
    <p>Edit this HTML or open <strong>styles/main.css</strong>. The preview updates instantly.</p>
    <div class="actions">
      <button id="demo-button">Try interaction</button>
      <a href="#features">Explore features</a>
    </div>
  </main>
  <section class="features" id="features">
    <article><b>01</b><h2>Code</h2><p>Monaco-powered editing with project-aware tools.</p></article>
    <article><b>02</b><h2>Preview</h2><p>Desktop, tablet and mobile views in the same window.</p></article>
    <article><b>03</b><h2>Design</h2><p>Visual editing will write back to real source files.</p></article>
  </section>
  <script src="scripts/app.js"></script>
</body>
</html>`,
  "styles/main.css": `:root {
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  color: #f6f7fb;
  background: #0b0d12;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at 75% 15%, #24385e 0, #0b0d12 38%); }
.hero { min-height: 72vh; padding: 11vw 9vw 7vw; display: flex; flex-direction: column; justify-content: center; }
.eyebrow { color: #80aaff; letter-spacing: .18em; font-size: 12px; font-weight: 700; }
h1 { max-width: 850px; margin: 18px 0; font-size: clamp(42px, 7vw, 92px); line-height: .95; letter-spacing: -.055em; }
.hero p { max-width: 660px; color: #b8bfce; font-size: clamp(17px, 2vw, 21px); line-height: 1.65; }
.actions { display: flex; align-items: center; gap: 20px; margin-top: 24px; }
button { border: 0; border-radius: 10px; padding: 13px 18px; background: #f4f7ff; color: #111722; font-weight: 700; cursor: pointer; }
a { color: #c9d8ff; text-decoration: none; }
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #262c37; border-top: 1px solid #262c37; }
.features article { min-height: 250px; background: #11151d; padding: 42px; }
.features b { color: #6e91d8; font-size: 13px; }
.features h2 { margin-top: 42px; font-size: 28px; }
.features p { color: #929baa; line-height: 1.6; }

@media (max-width: 760px) {
  .hero { padding: 90px 28px 60px; }
  .features { grid-template-columns: 1fr; }
}`,
  "scripts/app.js": `document.querySelector('#demo-button')?.addEventListener('click', () => {
  const button = document.querySelector('#demo-button');
  if (button) button.textContent = 'It works ✓';
});`,
};
