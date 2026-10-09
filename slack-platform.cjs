const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const win = path.win32;
function newestSlack(root, exists = fs.existsSync, read = fs.readdirSync) {
  let versions = [];
  try { versions = read(root).filter(name => /^app-\d+(?:\.\d+)+$/.test(name)); } catch {}
  versions.sort((a, b) => {
    const left = a.slice(4).split('.').map(Number), right = b.slice(4).split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) if ((right[i] || 0) !== (left[i] || 0)) return (right[i] || 0) - (left[i] || 0);
    return 0;
  });
  // Versioned binaries avoid Squirrel's launcher losing the inherited debugging pipes.
  for (const version of versions) {
    const file = win.join(root, version, 'slack.exe');
    if (exists(file)) return file;
  }
  for (const suffix of ['app\\Slack.exe', 'Slack.exe']) {
    const file = win.join(root, suffix);
    if (exists(file)) return file;
  }
}
function systemExe(name, env = process.env) { return win.join(env.SystemRoot || 'C:\\Windows', 'System32', name); }
function msixLocations(env = process.env) {
  const shell = systemExe('WindowsPowerShell\\v1.0\\powershell.exe', env);
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "@(Get-AppxPackage -Name 'com.tinyspeck.slackdesktop' | Select-Object -ExpandProperty InstallLocation) | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (result.status !== 0) return [];
  try { const parsed = JSON.parse(result.stdout.trim()); return (Array.isArray(parsed) ? parsed : [parsed]).filter(item => typeof item === 'string' && item); } catch { return []; }
}
function findWindowsSlack(env = process.env, exists = fs.existsSync, read = fs.readdirSync, packages = msixLocations) {
  for (const base of [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
    const file = newestSlack(win.join(base, 'Slack'), exists, read);
    if (file) return file;
  }
  for (const root of packages(env)) {
    const file = newestSlack(root, exists, read);
    if (file) return file;
  }
}
function slackRunning(platform = process.platform, run = spawnSync, env = process.env) {
  if (platform === 'darwin') {
    const result = run('/usr/bin/pgrep', ['-x', 'Slack']);
    if (result.error || ![0, 1].includes(result.status)) throw Error('Could not check whether Slack is running.');
    return result.status === 0;
  }
  if (platform === 'win32') {
    const result = run(systemExe('tasklist.exe', env), ['/FI', 'IMAGENAME eq slack.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    if (result.error || result.status !== 0) throw Error('Could not check whether Slack is running.');
    return /^"slack\.exe",/im.test(result.stdout || '');
  }
  throw Error('Slack Math currently supports macOS and Windows.');
}
module.exports = { newestSlack, findWindowsSlack, slackRunning };
