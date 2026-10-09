const { test } = require('node:test');
const assert = require('node:assert/strict');
const { newestSlack, findWindowsSlack, slackRunning } = require('./slack-platform.cjs');
test('prefer actual newest Slack binary over Squirrel launcher', () => {
  const root = 'C:\\Users\\Example\\AppData\\Local\\Slack';
  const files = new Set([root + '\\Slack.exe', root + '\\app-4.9.0\\slack.exe', root + '\\app-4.10.0\\slack.exe']);
  assert.equal(newestSlack(root, p => files.has(p), () => ['app-4.9.0','app-4.10.0','app-invalid']), root + '\\app-4.10.0\\slack.exe');
});
test('MSIX discovery and absent installation', () => {
  const installed = 'C:\\Program Files\\WindowsApps\\Slack';
  assert.equal(findWindowsSlack({}, p => p === installed + '\\app\\Slack.exe', () => [], () => [installed]), installed + '\\app\\Slack.exe');
  assert.equal(findWindowsSlack({}, () => false, () => {throw Error('missing')}, () => []), undefined);
});
test('check running Slack without confusing localized no-process output or errors', () => {
  assert.equal(slackRunning('win32', () => ({status:0,stdout:'"slack.exe","123","Console","1","1 K"\r\n'})), true);
  assert.equal(slackRunning('win32', () => ({status:0,stdout:'INFO: No tasks are running which match the specified criteria.'})), false);
  assert.throws(() => slackRunning('win32', () => ({status:1,stdout:''})), /Could not check/);
  assert.equal(slackRunning('darwin', () => ({status:1})), false);
});
