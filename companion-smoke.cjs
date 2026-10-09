// Run the real production worker against a disposable native Slack profile.
// Only process creation and the already-running check are redirected by this test harness.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const container = path.join(os.homedir(), 'Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support');
  const profile = fs.mkdtempSync(path.join(fs.existsSync(container) ? container : os.tmpdir(), 'slack-math-worker-test-'));
  const bootstrap = path.join(profile, 'worker-test.cjs');
  fs.writeFileSync(bootstrap, `
    const cp = require('node:child_process');
    const spawn = cp.spawn, spawnSync = cp.spawnSync;
    cp.spawnSync = (file, args, options) => file === '/usr/bin/pgrep' ? {status:1} : spawnSync(file,args,options);
    cp.spawn = (file,args,options) => {
      const child = spawn(file,[...args,${JSON.stringify('--user-data-dir=' + profile)}],options);
      process.send({slackPid:child.pid});
      return child;
    };
    require(${JSON.stringify(path.join(__dirname, 'companion.cjs'))});
  `);
  const node = process.argv[2] || process.execPath;
  const worker = fork(bootstrap, ['/Applications/Slack.app/Contents/MacOS/Slack'], { execPath: node, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
  const states = [];
  let slackPid, buffer = '', exited = false;
  worker.on('message', message => { slackPid = message.slackPid; });
  worker.on('exit', () => { exited = true; });
  worker.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      try { const state = JSON.parse(line); states.push(state); console.log(state.state + ': ' + state.detail); } catch {}
    }
  });
  async function wait(state, since = 0) {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (states.slice(since).some(item => item.state === state)) return;
      const error = states.slice(since).find(item => item.state === 'error');
      if (error) throw Error(error.detail);
      if (exited) throw Error('Worker exited before ' + state);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error('Timed out waiting for ' + state);
  }
  try {
    await wait('enabled');
    worker.stdin.write('disable\n');
    await wait('disabled');
    assert.ok(slackPid);
    process.kill(slackPid, 0);
    const since = states.length;
    worker.stdin.write('enable\n');
    await wait('enabled', since);
    process.kill(slackPid, 'SIGTERM');
    await wait('stopped');
    console.log('Production companion lifecycle passed with bundled runtime: enable → disable (Slack alive) → enable → normal Slack quit.');
  } finally {
    if (slackPid) { try { process.kill(slackPid, 'SIGTERM'); } catch {} }
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (!exited) worker.kill('SIGKILL');
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
