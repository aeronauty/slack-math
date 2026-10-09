// Exercise the production worker against a disposable Electron page, never a real workspace.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slack-math-electron-'));
  const status = path.join(root, 'dom.json');
  const quit = path.join(root, 'quit');
  const electron = require('electron');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({main:'fixture.cjs'}));
  fs.writeFileSync(path.join(root, 'fixture.cjs'), `
    const {app,BrowserWindow,session}=require('electron');
    const fs=require('node:fs');
    app.whenReady().then(async()=>{
      session.defaultSession.protocol.handle('https',()=>new Response(${JSON.stringify('<html><body><div class="c-message_kit__text">The energy is \\(E=mc^2\\).</div></body></html>')},{headers:{'content-type':'text/html'}}));
      const view=new BrowserWindow({show:false,webPreferences:{sandbox:true}});
      await view.loadURL('https://app.slack.com/client/math-test');
      setInterval(async()=>{
        if(fs.existsSync(${JSON.stringify(quit)})) {app.quit();return;}
        try {const value=await view.webContents.executeJavaScript('({count:document.querySelectorAll(".katex").length,source:document.body.textContent})');fs.writeFileSync(${JSON.stringify(status)},JSON.stringify(value));}catch{}
      },100);
    });
  `);
  const bootstrap = path.join(root, 'worker.cjs');
  fs.writeFileSync(bootstrap, `
    const cp=require('node:child_process');
    const spawn=cp.spawn,spawnSync=cp.spawnSync;
    cp.spawnSync=(file,args,options)=>/tasklist|pgrep/i.test(file)?{status:process.platform==='win32'?0:1,stdout:''}:spawnSync(file,args,options);
    cp.spawn=(file,args,options)=>spawn(file,[${JSON.stringify(root)},...args,${JSON.stringify('--user-data-dir='+path.join(root,'profile'))}],options);
    require(${JSON.stringify(path.join(__dirname,'../companion.cjs'))});
  `);
  const worker = fork(bootstrap,[electron],{stdio:['pipe','pipe','pipe','ipc']});
  const states=[];let buffer='',exited=false;
  worker.on('exit',()=>{exited=true});
  worker.stdout.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){try{states.push(JSON.parse(buffer.slice(0,i)))}catch{}buffer=buffer.slice(i+1)}});
  async function until(check,label) {
    const end=Date.now()+45000;
    while(Date.now()<end){if(check())return;const error=states.find(x=>x.state==='error');if(error)throw Error(error.detail);if(exited)throw Error('Worker exited: '+label);await new Promise(r=>setTimeout(r,100));}
    throw Error('Timed out: '+label);
  }
  const dom=()=>{try{return JSON.parse(fs.readFileSync(status))}catch{return {}}};
  try {
    await until(()=>states.some(x=>x.state==='enabled')&&dom().count===1,'render');
    worker.stdin.write('disable\n');
    await until(()=>states.some(x=>x.state==='disabled')&&dom().count===0,'disable');
    assert.match(dom().source,/E=mc\^2/);
    const since=states.length;worker.stdin.write('enable\n');
    await until(()=>states.slice(since).some(x=>x.state==='enabled')&&dom().count===1,'re-enable');
    fs.writeFileSync(quit,'');
    await until(()=>states.some(x=>x.state==='stopped'),'normal quit');
    console.log('Production worker passed: private pipe, render, disable, re-enable, normal quit.');
  } finally {
    fs.writeFileSync(quit,'');
    await new Promise(r=>setTimeout(r,2000));
    if(!exited)worker.kill('SIGKILL');
    fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
