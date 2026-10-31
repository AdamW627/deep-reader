import {copyFileSync, mkdirSync, readdirSync, rmSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)), root=path.resolve(here,'..');
execFileSync('npm',['run','build'],{cwd:path.join(root,'frontend'),stdio:'inherit'});
rmSync(path.join(here,'app'),{recursive:true,force:true});
function copy(source,dest,accept){
 mkdirSync(dest,{recursive:true});
 for(const item of readdirSync(source,{withFileTypes:true})){
  if(item.isSymbolicLink())throw new Error('Symlinks are not allowed in payload');
  if(item.isDirectory()){if(accept(item.name,true))copy(path.join(source,item.name),path.join(dest,item.name),accept)}
  else if(accept(item.name,false))copyFileSync(path.join(source,item.name),path.join(dest,item.name));
 }
}
copy(path.join(root,'backend'),path.join(here,'app/backend'),(n,dir)=>!dir&&n.endsWith('.py'));
copy(path.join(root,'frontend/dist'),path.join(here,'app/frontend/dist'),()=>true);
copyFileSync(path.join(root,'requirements-macos.lock'),path.join(here,'app/requirements.txt'));
for(const name of ['LICENSE','PRIVACY.md','SECURITY.md'])copyFileSync(path.join(root,name),path.join(here,name));
const requirements=readFileSync(path.join(here,'app/requirements.txt'),'utf8');
if(/file:|\/Users\/|^-e\s/m.test(requirements))throw new Error('Local dependency in requirements');
console.log('Prepared source-only npm payload; no user data or Git history included.');
