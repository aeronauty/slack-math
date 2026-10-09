const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { zig, runtime } = require('./fetch-tools.cjs');
async function build(arch) {
  const project = path.join(__dirname, '..');
  const [compiler, node] = await Promise.all([zig(), runtime(arch)]);
  const output = path.join(project,'dist','windows',arch,'Slack Math');
  const resources = path.join(output,'Resources');
  fs.mkdirSync(resources,{recursive:true});
  for (const file of ['companion.cjs','slack-platform.cjs','pipe-cdp.cjs','desktop-payload.js']) fs.copyFileSync(path.join(project,file),path.join(resources,file));
  fs.copyFileSync(path.join(node,'node.exe'),path.join(resources,'node.exe'));
  fs.copyFileSync(path.join(node,'LICENSE'),path.join(resources,'Node-LICENSE.txt'));
  fs.copyFileSync(path.join(project,'node_modules/katex/LICENSE'),path.join(resources,'KaTeX-LICENSE.txt'));
  fs.copyFileSync(path.join(project,'README.md'),path.join(output,'README.md'));
  fs.copyFileSync(path.join(project, 'LICENSE'), path.join(resources, 'LICENSE.txt'));
  const target = arch === 'arm64' ? 'aarch64-windows-gnu' : 'x86_64-windows-gnu';
  execFileSync(compiler,['cc','-target',target,'-O2','-Wall','-Wextra','-municode','-Wl,--subsystem,windows',path.join(__dirname,'SlackMath.c'),'-o',path.join(output,'Slack Math.exe'),'-luser32','-lgdi32','-lcomdlg32'],{stdio:'inherit'});
  // Debug symbols can embed the builder's local paths; ship only runtime files.
  for (const file of fs.readdirSync(output)) if (file.endsWith('.pdb')) fs.rmSync(path.join(output,file));
  const zip = path.join(project,'dist',`Slack-Math-0.3.0-windows-${arch}.zip`);
  fs.rmSync(zip,{force:true});
  if (process.platform === 'win32') {
    // Arguments are environment values, not interpolated PowerShell source.
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Compress-Archive -LiteralPath $env:SLACK_MATH_PACKAGE_FOLDER -DestinationPath $env:SLACK_MATH_PACKAGE_ZIP -Force'],{env:{...process.env,SLACK_MATH_PACKAGE_FOLDER:output,SLACK_MATH_PACKAGE_ZIP:zip}});
  } else execFileSync('/usr/bin/zip',['-q','-r',zip,'Slack Math'],{cwd:path.dirname(output)});
  console.log('Built '+zip);
}
build(process.argv[2]||'x64').catch(error=>{console.error(error.message);process.exitCode=1});
