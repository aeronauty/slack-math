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
// Pinned in the repo so a compromised download host cannot also serve matching checksums.
// Node: from the GPG-signed SHASUMS256.txt.asc. Zig: from index.json, minisign-checked.
const zigSums = {
  'x86_64-macos': '375b6909fc1495d16fc2c7db9538f707456bfc3373b14ee83fdd3e22b3d43f7f',
  'aarch64-macos': '3cc2bab367e185cdfb27501c4b30b1b0653c28d9f73df8dc91488e66ece5fa6b',
  'x86_64-linux': '02aa270f183da276e5b5920b1dac44a63f1a49e55050ebde3aecc9eb82f93239',
  'aarch64-linux': '958ed7d1e00d0ea76590d27666efbf7a932281b3d7ba0c6b01b0ff26498f667f',
  'x86_64-windows': '3a0ed1e8799a2f8ce2a6e6290a9ff22e6906f8227865911fb7ddedc3cc14cb0c',
  'aarch64-windows': 'b926465f8872bf983422257cd9ec248bb2b270996fbe8d57872cca13b56fc370'
};
const nodeSums = {
  x64: '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541',
  arm64: '8779b1bde1d39f8d420e3b57aa657b39891af434d3de44a919044cec06785921'
};
async function zig() {
  const version = '0.15.2';
  const cpu = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  const key = cpu + (process.platform === 'darwin' ? '-macos' : process.platform === 'win32' ? '-windows' : '-linux');
  const root = path.join(__dirname, '.tools');
  const dir = path.join(root, `zig-${key}-${version}`);
  const binary = path.join(dir, process.platform === 'win32' ? 'zig.exe' : 'zig');
  if (fs.existsSync(binary)) return binary;
  const file = `zig-${key}-${version}.${process.platform === 'win32' ? 'zip' : 'tar.xz'}`;
  const archive = path.join(root, file);
  await download(`https://ziglang.org/download/${version}/${file}`, zigSums[key], archive);
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
  const file = name + '.zip';
  const archive = path.join(root, file);
  await download(`https://nodejs.org/dist/${version}/${file}`, nodeSums[arch], archive);
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:SLACK_MATH_ARCHIVE -DestinationPath $env:SLACK_MATH_EXTRACT -Force'], {env:{...process.env,SLACK_MATH_ARCHIVE:archive,SLACK_MATH_EXTRACT:root}});
  else for (const item of ['node.exe', 'LICENSE']) fs.writeFileSync(path.join(dir, item), execFileSync('/usr/bin/unzip', ['-p', archive, `${name}/${item}`], { maxBuffer: 256 * 1024 * 1024 }));
  fs.unlinkSync(archive);
  return dir;
}
module.exports = { zig, runtime };
if (require.main === module) Promise.all([zig(),runtime('x64')]).then(result => console.log(result.join('\n'))).catch(error => { console.error(error.message); process.exitCode = 1; });
