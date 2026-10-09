const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runtime } = require('./fetch-runtime.cjs');
async function build(arch) {
  const project = path.join(__dirname, '..');
  const dist = path.join(project, 'dist', 'release', arch);
  const app = path.join(dist, 'Slack Math.app');
  const contents = path.join(app, 'Contents');
  const resources = path.join(contents, 'Resources');
  const node = await runtime(arch);
  if (!fs.existsSync(path.join(__dirname, 'SlackMath.icns'))) {
    execFileSync('/usr/bin/xcrun', ['swift', path.join(__dirname, 'Icon.swift'), path.join(__dirname, 'SlackMath.iconset')]);
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', path.join(__dirname, 'SlackMath.iconset'), '-o', path.join(__dirname, 'SlackMath.icns')]);
  }
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(resources, { recursive: true });
  for (const file of ['companion.cjs', 'pipe-cdp.cjs', 'slack-platform.cjs', 'desktop-payload.js']) fs.copyFileSync(path.join(project, file), path.join(resources, file));
  fs.copyFileSync(path.join(__dirname, 'SlackMath.icns'), path.join(resources, 'SlackMath.icns'));
  fs.copyFileSync(path.join(node, 'bin/node'), path.join(resources, 'node'));
  fs.chmodSync(path.join(resources, 'node'), 0o755);
  fs.copyFileSync(path.join(node, 'LICENSE'), path.join(resources, 'Node-LICENSE.txt'));
  fs.copyFileSync(path.join(project, 'node_modules/katex/LICENSE'), path.join(resources, 'KaTeX-LICENSE.txt'));
  fs.copyFileSync(path.join(project, 'README.md'), path.join(resources, 'README.md'));
  fs.copyFileSync(path.join(project, 'LICENSE'), path.join(resources, 'LICENSE.txt'));
  const target = arch === 'arm64' ? 'arm64-apple-macos13.5' : 'x86_64-apple-macos13.5';
  execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-target', target, path.join(__dirname, 'SlackMath.swift'), '-o', path.join(contents, 'MacOS', 'Slack Math')], { stdio: 'inherit' });
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Slack Math</string>
<key>CFBundleDisplayName</key><string>Slack Math</string>
<key>CFBundleIdentifier</key><string>local.slackmath.companion</string>
<key>CFBundleExecutable</key><string>Slack Math</string>
<key>CFBundleIconFile</key><string>SlackMath.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.3.0</string>
<key>CFBundleVersion</key><string>3</string>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>Slack Math is an unofficial companion, independent of Slack.</string>
</dict></plist>`);
  // Ad-hoc signing supports local use. Public distribution needs Developer ID and notarization.
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', path.join(resources, 'node')]);
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const disk = path.join(dist, 'disk');
  fs.mkdirSync(disk, { recursive: true });
  const diskApp = path.join(disk, 'Slack Math.app');
  fs.rmSync(diskApp, { recursive: true, force: true });
  execFileSync('/usr/bin/ditto', [app, diskApp]);
  if (!fs.existsSync(path.join(disk, 'Applications'))) fs.symlinkSync('/Applications', path.join(disk, 'Applications'));
  fs.writeFileSync(path.join(disk, 'Read Me.txt'), 'Drag Slack Math into Applications, then open it.\nClick Launch Slack with Math (or Restart Slack with Math).\nKeep the companion running while using Slack.\nThis preview is ad-hoc signed, not Developer ID signed or notarized.\nEach reader needs Slack Math. Mobile Slack is not supported.\n');
  const dmg = path.join(project, 'dist', `Slack-Math-0.3.0-${arch}.dmg`);
  fs.rmSync(dmg, { force: true });
  execFileSync('/usr/bin/hdiutil', ['create', '-volname', 'Slack Math', '-srcfolder', disk, '-format', 'UDZO', dmg], { stdio: 'inherit' });
  fs.rmSync(disk, { recursive: true, force: true });
  console.log('Built ' + dmg);
}
build(process.argv[2] || 'arm64').catch(error => { console.error(error.message); process.exitCode = 1; });
