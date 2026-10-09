const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const { splitMath } = require('./math.js');

function page(html) {
  const dom = new JSDOM('<!doctype html>' + html, { runScripts: 'outside-only', pretendToBeVisual: true });
  for (const file of ['node_modules/katex/dist/katex.min.js', 'math.js', 'content.js']) {
    dom.window.eval(fs.readFileSync(file, 'utf8'));
  }
  return dom;
}
const tick = () => new Promise(resolve => setTimeout(resolve, 70));

test('delimiters, escaped dollars, and currency', () => {
  assert.deepEqual(splitMath('Lift \\(L=\\frac12\\rho v^2 S\\) here').map(p => p.tex).filter(Boolean), ['L=\\frac12\\rho v^2 S']);
  assert.equal(splitMath('$$x^2$$')[0].display, true);
  assert.equal(splitMath('\\[x^2\\]')[0].display, true);
  assert.equal(splitMath('$x_i$')[0].tex, 'x_i');
  for (const text of ['It costs $5 and $10.', '\\$x\\$', '$100$', '$missing', '$ with spaces $']) {
    assert.ok(splitMath(text).every(p => p.tex === undefined), text);
  }
});

test('real typesetting, code preservation, malformed input, and excluded surfaces', () => {
  const dom = page(`<div class="p-rich_text_block">Lift \\(L=\\frac12\\rho v^2 S\\) and $x_i$.
    <code>\\(a_b\\)</code><code>const x = "$x$";</code>
    <pre>\\(x\\)</pre><a href="#">$z$</a> \\(\\badcommand{x}\\)
    <span contenteditable="true">$draft$</span></div>
    <div contenteditable="true"><div class="p-rich_text_block">$draft$</div></div>`);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('.slack-inline-math').length, 3);
  assert.equal(doc.querySelectorAll('.katex math').length, 3);
  assert.match(doc.querySelector('pre').textContent, /\\\(x/);
  assert.equal(doc.querySelectorAll('code')[1].textContent, 'const x = "$x$";');
  assert.equal(doc.querySelector('a').textContent, '$z$');
  assert.equal(doc.querySelector('[contenteditable]').textContent, '$draft$');
  assert.match(doc.body.textContent, /\\badcommand/);
  assert.equal(doc.querySelector('.slack-inline-math').title, '\\(L=\\frac12\\rho v^2 S\\)');
  dom.window.close();
});

test('new messages, edits, node recycling, and idempotence', async () => {
  const dom = page('<div id="feed"></div>');
  const doc = dom.window.document;
  const message = doc.createElement('div');
  message.className = 'c-message_kit__text';
  message.textContent = '$x$';
  doc.getElementById('feed').append(message);
  await tick();
  assert.equal(message.querySelectorAll('.slack-inline-math').length, 1);
  message.append(doc.createTextNode(' then $y$'));
  await tick();
  assert.equal(message.querySelectorAll('.slack-inline-math').length, 2);
  message.textContent = 'edited $z$';
  await tick();
  assert.equal(message.querySelector('.slack-inline-math').dataset.latexSource, '$z$');
  message.textContent = 'plain';
  message.firstChild.data = '$q$';
  await tick();
  assert.equal(message.querySelector('.slack-inline-math').dataset.latexSource, '$q$');
  await tick();
  assert.equal(message.querySelectorAll('.slack-inline-math').length, 1);
  dom.window.close();
});

test('copy returns TeX source and trust-sensitive commands cannot inject links', () => {
  const dom = page('<div class="p-rich_text_block">Value $x^2$ now. \\(\\href{https://evil.example}{x}\\)</div>');
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('a').length, 0);
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector('.p-rich_text_block'));
  dom.window.getSelection().addRange(range);
  const event = new dom.window.Event('copy', { bubbles: true, cancelable: true });
  let copied;
  event.clipboardData = { setData(type, text) { assert.equal(type, 'text/plain'); copied = text; } };
  doc.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.match(copied, /^Value \$x\^2\$ now/);
  assert.ok(!copied.includes('katex'));
  dom.window.close();
});

test('oversized and expanding input stays bounded', () => {
  assert.ok(splitMath('\\(' + 'x'.repeat(8001) + '\\)').every(p => p.tex === undefined));
  const dom = page('<div class="p-rich_text_block">\\(\\def\\a{\\a}\\a\\)</div>');
  assert.equal(dom.window.document.querySelectorAll('.slack-inline-math').length, 0);
  dom.window.close();
});

test('turning math off restores source and stops rendering', async () => {
  const dom = page('<div class="p-rich_text_block">Value <code>\\(x_i\\)</code></div>');
  const doc = dom.window.document;
  dom.window.__slackInlineLatexStop();
  assert.equal(doc.querySelectorAll('.slack-inline-math').length, 0);
  assert.equal(doc.querySelector('code').textContent, '\\(x_i\\)');
  assert.equal(doc.querySelector('code').classList.contains('slack-math-code'), false);
  const message = doc.querySelector('.p-rich_text_block');
  message.append(doc.createTextNode(' $y$'));
  await tick();
  assert.equal(doc.querySelectorAll('.slack-inline-math').length, 0);
  assert.equal(dom.window.__slackInlineLatex, undefined);
  dom.window.close();
});
