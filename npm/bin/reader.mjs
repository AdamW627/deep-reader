#!/usr/bin/env node
import {mkdir, readFile, writeFile, access, chmod, rm, open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {homedir, release} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';

const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const home=path.resolve(process.env.DEEPSEEK_READER_HOME||path.join(homedir(),'Library/Application Support/deepseek-paper-reader'));
const uvVersion='0.11.8';
const hashes={arm64:'f0d402e182ab581e934c159cc9edf25ec6e08d32f29aa797980e949afefc87cd',x64:'d414fc3795b6f56fb6b1fa359537930924fdfe857750a144d2aedf3077be3f1d'};
const wheelTags={arm64:'macosx_11_0_arm64',x64:'macosx_10_12_x86_64'};
const run=(cmd,args,options={})=>new Promise((resolve,reject)=>{const child=spawn(cmd,args,{stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${path.basename(cmd)} exited ${code}`)))});
const exists=async p=>access(p).then(()=>true,()=>false);
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const lockfile=path.join(home,'setup.lock');
async function setup(){
 const requirements=path.join(pkg,'app/requirements.txt');
 const digest=hash(await readFile(requirements));
 const envDir=path.join(home,`runtime-${digest.slice(0,16)}`), python=path.join(envDir,'bin/python');
 if(await exists(path.join(envDir,'.ready')))return python;
 let lock;
 try{lock=await open(lockfile,'wx',0o600)}catch{throw new Error(`Another setup is running. If it was interrupted, remove ${lockfile} and retry.`)}
 try{
  const uv=path.join(home,`uv-${uvVersion}`);
  if(!await exists(uv)){
   console.log('Fetching verified uv runtime manager (PyPI)…');
   const meta=await fetch(`https://pypi.org/pypi/uv/${uvVersion}/json`,{signal:AbortSignal.timeout(60000)});
   if(!meta.ok)throw new Error(`uv metadata failed: HTTP ${meta.status}`);
   const file=(await meta.json()).urls.find(item=>item.filename===`uv-${uvVersion}-py3-none-${wheelTags[process.arch]}.whl`);
   if(!file)throw new Error('uv wheel not available for this Mac');
   const response=await fetch(file.url,{signal:AbortSignal.timeout(180000)});
   if(!response.ok)throw new Error(`uv download failed: HTTP ${response.status}`);
   const raw=Buffer.from(await response.arrayBuffer());
   if(hash(raw)!==hashes[process.arch])throw new Error('uv checksum mismatch');
   const wheel=path.join(home,'uv.whl'), staging=path.join(home,'uv-extract');
   await writeFile(wheel,raw,{mode:0o600});await mkdir(staging,{recursive:true,mode:0o700});
   await run('/usr/bin/unzip',['-q',wheel,'-d',staging]);
   const binDir=path.join(staging,'uv');
   await rm(uv,{force:true});
   await run('/bin/cp',[path.join(binDir,'uv'),uv]);await chmod(uv,0o700);
   await rm(staging,{recursive:true,force:true});await rm(wheel,{force:true});
  }
  const env={...process.env,UV_PYTHON_INSTALL_DIR:path.join(home,'python'),UV_CACHE_DIR:path.join(home,'cache'),MACOSX_DEPLOYMENT_TARGET:'14.0'};
  console.log('Preparing isolated Python 3.12 environment (first launch requires network)…');
  await run(uv,['venv','--python','3.12','--managed-python',envDir],{env});
  await run(uv,['pip','sync','--python',python,'--only-binary',':all:',requirements],{env});
  await run(python,['-c','import fastapi, fitz, uvicorn, deepseek_harness']);
  await writeFile(path.join(envDir,'.ready'),digest,{mode:0o600});
  return python;
 }finally{await lock.close();await rm(lockfile,{force:true})}
}
const statefile=path.join(home,'server.json');
async function running(){
 try{
  const state=JSON.parse(await readFile(statefile,'utf8'));
  process.kill(state.pid,0);
  const cmd=execFileSync('/bin/ps',['-p',String(state.pid),'-o','command='],{encoding:'utf8'});
  if(!cmd.includes('uvicorn backend.app:app')||!cmd.includes(home))return null;
  return state;
 }catch{return null}
}
async function main(){
 const cmd=process.argv[2]||'start';
 if(['--help','help','-h'].includes(cmd)){console.log('deepseek-reader [start|setup|status|stop] [--no-open]\nmacOS 14+, Node.js 20+. First launch downloads Python and dependencies.');return}
 if(process.platform!=='darwin'||!hashes[process.arch]||Number(release().split('.')[0])<23)throw new Error('Requires macOS 14+ on Apple Silicon or Intel.');
 if(!['start','setup','status','stop'].includes(cmd))throw new Error(`Unknown command: ${cmd}`);
 await mkdir(home,{recursive:true,mode:0o700});await chmod(home,0o700);
 let state=await running();
 if(cmd==='status'){console.log(state?`Running: ${state.url}`:'Not running');return}
 if(cmd==='stop'){if(state){process.kill(state.pid,'SIGTERM');console.log('Stop requested.')}else console.log('Not running');return}
 const python=await setup();if(cmd==='setup'){console.log('Environment ready.');return}
 if(!state){
  const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
  const log=await open(path.join(home,'server.log'),'a',0o600);
  const child=spawn(python,['-m','uvicorn','backend.app:app','--host','127.0.0.1','--port',String(port)],{cwd:path.join(pkg,'app'),detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PDF_READER_DATA_DIR:path.join(home,'data'),PDF_READER_SETTINGS_PATH:path.join(home,'settings.json')}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();await log.close();
  state={pid:child.pid,url:`http://127.0.0.1:${port}`};
  let ready=false;
  for(let i=0;i<120;i++){
   try{if((await fetch(`${state.url}/api/health`,{signal:AbortSignal.timeout(1000)})).ok){ready=true;break}}catch{}
   try{process.kill(child.pid,0)}catch{break}
   await new Promise(r=>setTimeout(r,500));
  }
  if(!ready){try{process.kill(child.pid,'SIGTERM')}catch{}throw new Error(`Server failed to start. See ${path.join(home,'server.log')}`)}
  await writeFile(statefile,JSON.stringify(state),{mode:0o600});
 }
 console.log(state.url);
 if(!process.argv.includes('--no-open'))await run('/usr/bin/open',[state.url]);
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
