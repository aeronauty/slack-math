// Exercise the installed native Slack in a disposable, signed-out profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { connectPipe, isSlackTarget } = require('./pipe-cdp.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const container = path.join(os.homedir(), 'Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support');
  const parent = fs.existsSync(container) ? container : os.tmpdir();
  const profile = fs.mkdtempSync(path.join(parent, 'slack-math-test-'));
  const child = spawn('/Applications/Slack.app/Contents/MacOS/Slack', ['--user-data-dir=' + profile, '--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const cdp = connectPipe(child);
  let exited = false;
  child.on('exit', () => { exited = true; });
  try {
    await cdp.call('Browser.getVersion');
    // Allow the sign-in window to finish its initial redirects before adding the fixture.
    await pause(3500);
    let session;
    for (let i = 0; i < 40; i++) {
      const { targetInfos } = await cdp.call('Target.getTargets');
      const target = targetInfos.find(isSlackTarget);
      if (target) {
        ({ sessionId: session } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        const ready = await cdp.call('Runtime.evaluate', { expression: 'Boolean(document.body) && document.readyState === "complete"', returnByValue: true }, session);
        if (ready.result?.value) break;
        await cdp.call('Target.detachFromTarget', { sessionId: session });
        session = undefined;
      }
      await pause(500);
    }
    assert.ok(session, 'Slack workspace renderer opened');
    const evaluate = async expression => {
      const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      assert.ok(!result.exceptionDetails, result.exceptionDetails?.text);
      return result.result?.value;
    };
    const payload = fs.readFileSync(path.join(__dirname, 'desktop-payload.js'), 'utf8');
    assert.equal(await evaluate(payload), true);
    const source = 'The lift is \\(L=\\frac{1}{2}\\rho v^2 S C_L\\).';
    await evaluate(`(() => {
      const element = document.createElement('div'); element.className = 'p-rich_text_block';
      element.id = 'slack-math-native-fixture'; element.textContent = ${JSON.stringify(source)};
      document.body.append(element);
    })()`);
    await pause(800);
    for (let i = 0; i < 20; i++) {
      if (await evaluate('document.querySelectorAll("#slack-math-native-fixture .katex").length') === 1) break;
      await pause(250);
    }
    assert.equal(await evaluate('document.querySelectorAll("#slack-math-native-fixture .katex").length'), 1);
    assert.equal(await evaluate('document.fonts.check("16px KaTeX_Main")'), true);
    assert.equal(await evaluate(payload), false, 'duplicate injection prevented');
    await evaluate('globalThis.__slackInlineLatexStop()');
    assert.equal(await evaluate('document.getElementById("slack-math-native-fixture").textContent'), source);
    assert.equal(await evaluate('document.querySelectorAll("style[data-slack-inline-latex]").length'), 0);
    assert.equal(await evaluate(payload), true, 'renderer can be enabled again');
    assert.equal(await evaluate('document.querySelectorAll("#slack-math-native-fixture .katex").length'), 1);
    // Check the launched app itself has no listening TCP socket.
    const listeners = (() => { try { return execFileSync('/usr/sbin/lsof', ['-a', '-p', String(child.pid), '-iTCP', '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' }); } catch (error) { if (error.status === 1) return ''; throw error; } })();
    assert.equal(listeners, '', 'no listening TCP port');
    await evaluate('globalThis.__slackInlineLatexStop()');
    cdp.close();
    await pause(700);
    console.log('Private-pipe native check passed: inline math, fonts, new messages, disable/re-enable, no TCP listener.');
    console.log('Slack remains open after pipe closes:', !exited);
  } finally {
    cdp.close();
    if (!exited) child.kill('SIGTERM');
    for (let i = 0; i < 30 && !exited; i++) await pause(100);
    if (exited) fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
