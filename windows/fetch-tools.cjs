const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
async function download(url, expected, output) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Download failed (${response.status}): ${new URL(url).hostname}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(data).digest('hex') !== expected) throw Error('Download checksum mismatch.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, data);
}
async function zig() {
  const version = '0.15.2';
  const cpu = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const key = cpu + (process.platform === 'darwin' ? '-macos' : process.platform === 'win32' ? '-windows' : '-linux');
  const root = path.join(__dirname, '.tools');
  const dir = path.join(root, `zig-${key}-${version}`);
  const binary = path.join(dir, process.platform === 'win32' ? 'zig.exe' : 'zig');
  if (fs.existsSync(binary)) return binary;
  const index = await (await fetch('https://ziglang.org/download/index.json')).json();
  const asset = index[version][key];
  const archive = path.join(root, path.basename(asset.tarball));
  await download(asset.tarball, asset.shasum, archive);
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SLACK_MATH_ARCHIVE -DestinationPath $env:SLACK_MATH_EXTRACT -Force'], {env:{...process.env,SLACK_MATH_ARCHIVE:archive,SLACK_MATH_EXTRACT:root}});
  else execFileSync('/usr/bin/tar', ['-xf', archive, '-C', root]);
  fs.unlinkSync(archive);
  return binary;
}
async function runtime(arch) {
  if (!['x64', 'arm64'].includes(arch)) throw Error('Unsupported Windows architecture.');
  const version = 'v24.21.0';
  const name = `node-${version}-win-${arch}`;
  const root = path.join(__dirname, '.runtime');
  const dir = path.join(root, name);
  if (fs.existsSync(path.join(dir, 'node.exe'))) return dir;
  const base = `https://nodejs.org/dist/${version}/`;
  const sums = await (await fetch(base + 'SHASUMS256.txt')).text();
  const file = name + '.zip';
  const expected = sums.split('\n').find(line => line.endsWith('  ' + file))?.split(' ')[0];
  if (!expected) throw Error('Node checksum missing.');
  const archive = path.join(root, file);
  await download(base + file, expected, archive);
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SLACK_MATH_ARCHIVE -DestinationPath $env:SLACK_MATH_EXTRACT -Force'], {env:{...process.env,SLACK_MATH_ARCHIVE:archive,SLACK_MATH_EXTRACT:root}});
  else for (const item of ['node.exe', 'LICENSE']) fs.writeFileSync(path.join(dir, item), execFileSync('/usr/bin/unzip', ['-p', archive, `${name}/${item}`], { maxBuffer: 256 * 1024 * 1024 }));
  fs.unlinkSync(archive);
  return dir;
}
module.exports = { zig, runtime };
if (require.main === module) Promise.all([zig(),runtime('x64')]).then(result => console.log(result.join('\n'))).catch(error => { console.error(error.message); process.exitCode = 1; });
