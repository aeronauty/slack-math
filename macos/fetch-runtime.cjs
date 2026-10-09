const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const version = 'v24.21.0';
// Pinned from the GPG-signed SHASUMS256.txt.asc, so a compromised host cannot serve matching checksums.
const sums = {
  arm64: 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057',
  x64: '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097'
};
async function runtime(arch) {
  if (!['arm64', 'x64'].includes(arch)) throw Error('Unsupported architecture.');
  const root = path.join(__dirname, '.runtime');
  const name = `node-${version}-darwin-${arch}`;
  const folder = path.join(root, name);
  fs.mkdirSync(root, { recursive: true });
  if (fs.existsSync(path.join(folder, 'bin/node'))) return folder;
  const file = name + '.tar.gz';
  const base = `https://nodejs.org/dist/${version}/`;
  const expected = sums[arch];
  const response = await fetch(base + file);
  if (!response.ok) throw Error('Cannot download bundled Node runtime.');
  const archive = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(archive).digest('hex') !== expected) throw Error('Node runtime checksum mismatch.');
  const archivePath = path.join(root, file);
  fs.writeFileSync(archivePath, archive);
  execFileSync('/usr/bin/tar', ['-xzf', archivePath, '-C', root, name + '/bin/node', name + '/LICENSE']);
  fs.unlinkSync(archivePath);
  console.log(`Verified official Node ${version} (${arch}).`);
  return folder;
}
module.exports = { runtime };
if (require.main === module) runtime(process.argv[2] || 'arm64').catch(error => { console.error(error.message); process.exitCode = 1; });
