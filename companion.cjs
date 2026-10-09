const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findWindowsSlack, slackRunning } = require('./slack-platform.cjs');
const { connectPipe, isSlackTarget } = require('./pipe-cdp.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
process.stdout.on('error', () => {});
function report(state, detail) { process.stdout.write(JSON.stringify({ state, detail }) + '\n'); }
async function main() {
  const binary = process.argv[2] || (process.platform === 'win32' ? findWindowsSlack() : '/Applications/Slack.app/Contents/MacOS/Slack');
  if (!binary || !fs.existsSync(binary)) throw Error('Slack was not found. Install Slack, or use Choose Slack to select its Slack.exe.');
  if (slackRunning()) throw Error('Slack is still running. Quit Slack completely (including its system tray icon on Windows) and try again.');
  const payload = fs.readFileSync(path.join(__dirname, 'desktop-payload.js'), 'utf8');
  const child = spawn(binary, ['--remote-debugging-pipe'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
  let exited = false, stopping = false, enabledByUser = true, previousState = '';
  child.on('exit', () => { exited = true; });
  child.on('error', () => { exited = true; report('error', 'Slack could not be launched.'); });
  const cdp = connectPipe(child);
  const sessions = new Map();
  async function disable() {
    enabledByUser = false;
    await Promise.allSettled([...sessions.values()].map(session => cdp.call('Runtime.evaluate', { expression: 'globalThis.__slackInlineLatexStop?.()' }, session)));
    report('disabled', 'Math is off. Slack stays open; its messages remain unchanged.');
  }
  // Keep the private pipe alive when math is disabled: EOF on this pipe closes Slack.
  process.on('SIGTERM', disable);
  process.on('SIGINT', disable);
  let commands = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    commands += chunk;
    let newline;
    while ((newline = commands.indexOf('\n')) !== -1) {
      const command = commands.slice(0, newline); commands = commands.slice(newline + 1);
      if (command === 'disable') disable();
      if (command === 'quit') cdp.call('Browser.close').catch(() => report('waiting', 'Quit Slack normally to close both apps.'));
      if (command === 'enable') { previousState = ''; enabledByUser = true; report('starting', 'Enabling math…'); }
    }
  });
  process.stdin.on('end', disable);
  report('starting', 'Opening Slack and checking its rendering interface…');
  try { await cdp.call('Browser.getVersion'); }
  catch { cdp.close(); child.unref(); throw Error('This Slack build does not support the private rendering interface. Quit Slack normally before retrying.'); }
  let failures = 0, started = Date.now();
  while (!exited && !stopping) {
    if (!enabledByUser) { await pause(250); previousState = ''; continue; }
    try {
      const { targetInfos } = await cdp.call('Target.getTargets');
      const targets = targetInfos.filter(isSlackTarget);
      const live = new Set(targets.map(target => target.targetId));
      let enabled = 0;
      for (const target of targets) {
        if (stopping) break;
        try {
          let session = sessions.get(target.targetId);
          if (!session) {
            ({ sessionId: session } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
            sessions.set(target.targetId, session);
          }
          const current = await cdp.call('Runtime.evaluate', { expression: 'Boolean(globalThis.__slackInlineLatex)', returnByValue: true }, session);
          if (current.exceptionDetails) throw Error('Renderer unavailable.');
          if (current.result?.value) enabled++;
          else {
            const result = await cdp.call('Runtime.evaluate', { expression: payload, returnByValue: true }, session);
            if (result.exceptionDetails) throw Error('Renderer rejected the payload.');
            if (result.result?.value) enabled++;
          }
        } catch {
          const stale = sessions.get(target.targetId);
          sessions.delete(target.targetId);
          if (stale) { try { await cdp.call('Target.detachFromTarget', { sessionId: stale }); } catch {} }
        }
      }
      for (const [id, session] of sessions) if (!live.has(id)) {
        sessions.delete(id);
        try { await cdp.call('Target.detachFromTarget', { sessionId: session }); } catch {}
      }
      if (!enabledByUser) { await disable(); continue; }
      const state = enabled ? 'enabled' : Date.now() - started > 20000 ? 'waiting' : 'starting';
      if (state !== previousState) {
        report(state, enabled ? 'Inline math is enabled. New messages and reloads are handled automatically.' : 'Waiting for a Slack workspace to finish loading.');
        previousState = state;
      }
      failures = 0;
    } catch {
      if (exited || stopping) break;
      if (++failures === 3) { report('error', 'Slack’s rendering interface stopped responding. Relaunch Slack Math to retry.'); break; }
    }
    await pause(1500);
  }
  if (exited) { cdp.close(); report('stopped', 'Slack is closed. Launch it here to enable math again.'); process.exit(0); }
  await disable();
  // Keep Slack alive until the user quits it normally, even after a compatibility error.
  while (!exited) await pause(1000);
  cdp.close();
  process.exit(0);
}
main().catch(error => { report('error', error.message); process.exitCode = 1; });
