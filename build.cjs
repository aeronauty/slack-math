const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, 'extension');
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
for (const file of ['manifest.json', 'content.js', 'math.js', 'style.css']) {
  fs.copyFileSync(path.join(__dirname, file), path.join(out, file));
}
for (const file of ['katex.min.js', 'katex.min.css', 'fonts']) {
  fs.cpSync(path.join(__dirname, 'node_modules/katex/dist', file), path.join(out, 'vendor', file), { recursive: true });
}
fs.copyFileSync(path.join(__dirname, 'node_modules/katex/LICENSE'), path.join(out, 'vendor/LICENSE'));
console.log('Load the extension/ folder in Chrome or Edge.');

const katexDir = path.join(__dirname, 'node_modules/katex/dist');
const css = fs.readFileSync(path.join(katexDir, 'katex.min.css'), 'utf8').replace(/url\(fonts\/([^)]+)\)/g, (_, font) => {
  const type = font.endsWith('.woff2') ? 'font/woff2' : font.endsWith('.woff') ? 'font/woff' : 'font/ttf';
  return 'url(data:' + type + ';base64,' + fs.readFileSync(path.join(katexDir, 'fonts', font)).toString('base64') + ')';
}) + '\n' + fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
// Embedded fonts also avoid extension font URL resolution differences between clients.
fs.writeFileSync(path.join(out, 'vendor/katex.min.css'), css);
const payload = `(function () {
  if (globalThis.__slackInlineLatex || !document.body) return false;
  const module = undefined, exports = undefined, define = undefined;
  ${fs.readFileSync(path.join(katexDir, 'katex.min.js'), 'utf8')}
  const style = document.createElement('style');
  style.dataset.slackInlineLatex = 'true';
  style.textContent = ${JSON.stringify(css)};
  document.head.append(style);
  ${fs.readFileSync(path.join(__dirname, 'math.js'), 'utf8')}
  ${fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')}
  return Boolean(globalThis.__slackInlineLatex);
}).call(globalThis)`;
fs.writeFileSync(path.join(__dirname, 'desktop-payload.js'), payload);
console.log('Built desktop-payload.js with embedded fonts.');
