import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import Mark from './Mark';
import {Archive,ArchiveRestore,ArrowUp,ChevronLeft,ChevronRight,ExternalLink,FileText,FolderInput,History,Info,Link,ListTree,LoaderCircle,Maximize2,Minimize2,Monitor,Moon,PanelLeftClose,PanelLeftOpen,Pencil,Plus,RefreshCw,Search,Settings,Square,SquarePen,Sun,Trash2,WandSparkles,X} from 'lucide-react';
import AgentTrace from './AgentTrace';
import Answer from './Answer';
import PdfReader from './PdfReader';
import PdfOutline from './PdfOutline';
import PdfSearch from './PdfSearch';
import PaperCard from './PaperCard';
import SelectionPopover,{ACTIONS} from './SelectionPopover';
import DocumentDetails from './DocumentDetails';
import 'pdfjs-dist/web/pdf_viewer.css';
import 'katex/dist/katex.min.css';
import './style.css';
pdfjs.GlobalWorkerOptions.workerSrc=workerUrl;
async function api(path,options={}) {const r=await fetch('/api'+path,{cache:'no-store',...options});if(!r.ok){let e;try{e=await r.json()}catch{e={detail:r.statusText}}throw Error(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail))}return r.json()}
const json=(body,method='POST')=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const initialProject=()=>localStorage.getItem('project')||'default';
const colors=[['黄色','#f3cf5b'],['绿色','#86cf97'],['蓝色','#86bdf3'],['粉色','#f4a3c4'],['紫色','#bda0ed']];
const themes=[['system','跟随系统',Monitor],['light','浅色',Sun],['dark','深色',Moon]];
const actionLabels=Object.fromEntries(ACTIONS.map(a=>[a.id,a.label]));
function Palette({value,onChange}){return <div className="color-palette" role="group" aria-label="高亮颜色">{colors.map(([name,color])=><button type="button" key={color} aria-label={name} title={name} aria-pressed={value===color} style={{background:color}} onClick={()=>onChange(color)}/>)}</div>}
function useTheme(){
 const [theme,setTheme]=useState(()=>localStorage.getItem('theme')||'system');
 useEffect(()=>{
  localStorage.setItem('theme',theme);
  const media=matchMedia('(prefers-color-scheme: dark)');
  const apply=()=>{document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme};
  apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[theme]);
 return [theme,setTheme];
}
function Elapsed({since}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 return <span className="elapsed">{Math.max(0,Math.round((now-since)/1000))} 秒</span>;
}
function App(){
 const [projects,setProjects]=useState([{id:'default',name:'默认项目'}]),[project,setProject]=useState(initialProject),[papers,setPapers]=useState([]),[paper,setPaper]=useState(null),[doc,setDoc]=useState(null),[annotations,setAnnotations]=useState([]),[messages,setMessages]=useState([]),[selection,setSelection]=useState(null),[page,setPage]=useState(1),[navigation,setNavigation]=useState(null),[zoom,setZoom]=useState(1.5),[tab,setTab]=useState('chat'),[assistantMaximized,setAssistantMaximized]=useState(false),[question,setQuestion]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[settings,setSettings]=useState(null),[health,setHealth]=useState(null),[token,setToken]=useState(''),[filter,setFilter]=useState(''),[importing,setImporting]=useState(false),[report,setReport]=useState(null),[urlOpen,setUrlOpen]=useState(false),[url,setUrl]=useState(''),[newProject,setNewProject]=useState(false),[projectName,setProjectName]=useState(''),[testing,setTesting]=useState(false),[connection,setConnection]=useState(null),[saving,setSaving]=useState(false),[settingsDirty,setSettingsDirty]=useState(false);
 const fileRef=useRef(),folderRef=useRef(),importWrap=useRef(),chatEnd=useRef(),controller=useRef(),projectRef=useRef(project),openVersion=useRef(0),projectVersion=useRef(0),listVersion=useRef(0),pdfTask=useRef(),initialUrl=useRef(new URLSearchParams(location.search).get('url')),importLock=useRef(false),settingsForm=useRef(),composer=useRef();
 const [conversations,setConversations]=useState([]),[conversation,setConversation]=useState('default'),[conversationLoading,setConversationLoading]=useState(false),[conversationSearch,setConversationSearch]=useState(''),[renamingConversation,setRenamingConversation]=useState(null),[renameTitle,setRenameTitle]=useState(''),[color,setColor]=useState(()=>{const saved=localStorage.getItem('highlight-color');return colors.some(c=>c[1]===saved)?saved:colors[0][1]});
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [projectMemory,setProjectMemory]=useState(null),[memoryItems,setMemoryItems]=useState([]),[memoryStatus,setMemoryStatus]=useState(''),[memorySaving,setMemorySaving]=useState(false);
 const [outlineOpen,setOutlineOpen]=useState(false),outlineButton=useRef();
 const [searchOpen,setSearchOpen]=useState(false),[searchMarks,setSearchMarks]=useState([]),[flash,setFlash]=useState(null),[blocks,setBlocks]=useState(new Map());
 const [anchor,setAnchor]=useState(null),[organizerOpen,setOrganizerOpen]=useState(false),[turnStarted,setTurnStarted]=useState(null),[profile,setProfile]=useState(''),[importOpen,setImportOpen]=useState(false);
 const [theme,setTheme]=useTheme();
 useEffect(()=>{setOutlineOpen(false);setSearchOpen(false);setFlash(null)},[doc]);
 function closeOutline(){setOutlineOpen(false);outlineButton.current?.focus()}
 const [libraryHidden,setLibraryHidden]=useState(()=>localStorage.getItem('library-hidden')==='1');
 const conversationVersion=useRef(0),conversationLock=useRef(false);
 function chooseColor(value){setColor(value);localStorage.setItem('highlight-color',value)}
 function clearSelection(){setSelection(null);setAnchor(null);window.getSelection()?.removeAllRanges()}
 function resetConversation(){setMessages([]);setQuestion('');setSelection(null);setAnchor(null);setNote('');setStatus('');window.getSelection()?.removeAllRanges()}
 async function loadConversation(p,id){const version=++conversationVersion.current,opened=openVersion.current;setConversation(id);localStorage.setItem('conversation:'+p.id,id);resetConversation();setConversationLoading(true);try{const m=await api(`/papers/${p.id}/messages?conversation_id=${encodeURIComponent(id)}`);if(version===conversationVersion.current&&opened===openVersion.current)setMessages(m)}catch(e){if(version===conversationVersion.current&&opened===openVersion.current)setError(e.message)}finally{if(version===conversationVersion.current&&opened===openVersion.current)setConversationLoading(false)}}
 async function switchConversation(id){if(busy||importing||conversationLock.current||!paper)return;await loadConversation(paper,id)}
 async function createConversation(){if(busy||importing||conversationLoading||conversationLock.current||!paper)return;const p=paper,version=openVersion.current;conversationLock.current=true;setConversationLoading(true);setError('');try{const item=await api(`/papers/${p.id}/conversations`,json({}));if(version!==openVersion.current)return;setConversations(v=>[...v,item]);await loadConversation(p,item.id);setTab('chat')}catch(e){if(version===openVersion.current)setError(e.message)}finally{conversationLock.current=false;if(version===openVersion.current)setConversationLoading(false)}}
 async function updateConversation(item,patch){if(!paper||item.id==='default'||conversationLock.current)return false;const p=paper,version=openVersion.current;conversationLock.current=true;setError('');let saved=false;try{const updated=await api(`/papers/${p.id}/conversations/${encodeURIComponent(item.id)}`,json(patch,'PATCH'));if(version!==openVersion.current)return false;setConversations(v=>v.map(c=>c.id===item.id?{...c,...updated}:c));saved=true;if(patch.archived&&item.id===conversation){const next=conversations.find(c=>c.id!==item.id&&!c.archived)?.id||'default';await loadConversation(p,next)}}catch(e){if(version===openVersion.current)setError(e.message)}finally{conversationLock.current=false}return saved}
 async function suggestConversationTitle(item){if(!paper||item.id==='default'||conversationLock.current)return;const p=paper,version=openVersion.current;conversationLock.current=true;setError('');try{const result=await api(`/papers/${p.id}/conversations/${encodeURIComponent(item.id)}/suggest-title`,{method:'POST'});if(version===openVersion.current){conversationLock.current=false;await updateConversation(item,{title:result.title})}}catch(e){if(version===openVersion.current)setError(e.message)}finally{conversationLock.current=false}}
 async function submitConversationTitle(e){e.preventDefault();const item=renamingConversation;if(!item||!renameTitle.trim())return;if(await updateConversation(item,{title:renameTitle.trim()}))setRenamingConversation(null)}
 async function deleteConversation(item){if(!paper||item.id==='default'||!window.confirm(`删除对话“${item.title||'新对话'}”？此操作无法撤销。`))return;const p=paper,version=openVersion.current;conversationLock.current=true;setError('');try{await api(`/papers/${p.id}/conversations/${encodeURIComponent(item.id)}`,{method:'DELETE'});if(version!==openVersion.current)return;setConversations(v=>v.filter(c=>c.id!==item.id));if(item.id===conversation){const next=conversations.find(c=>c.id!==item.id&&!c.archived)?.id||'default';await loadConversation(p,next)}}catch(e){if(version===openVersion.current)setError(e.message)}finally{conversationLock.current=false}}
 async function refresh(id=projectRef.current){const version=++listVersion.current;const p=await api('/papers?project_id='+encodeURIComponent(id));if(id===projectRef.current&&version===listVersion.current)setPapers(p);return p}
 function clearReader(){setDetailsOpen(false);++openVersion.current;++conversationVersion.current;setConversations([]);setConversation('default');setConversationLoading(false);pdfTask.current?.destroy();pdfTask.current=null;setPaper(null);setDoc(null);setAnnotations([]);setMessages([]);setSelection(null);setAnchor(null);setBlocks(new Map());setQuestion('');setNote('');setPage(1);setNavigation(null);window.getSelection()?.removeAllRanges()}
 function loadBlocks(p,version){api(`/papers/${p.id}/blocks`).then(value=>{if(version!==openVersion.current)return;const map=new Map();for(const item of value.pages||[])for(const b of item.blocks)map.set(b.id,b);setBlocks(map)}).catch(()=>{/* Paragraph citations fall back to page jumps. */})}
 async function open(p){setDetailsOpen(false);const version=++openVersion.current;++conversationVersion.current;setConversations([]);setConversation('default');setConversationLoading(true);pdfTask.current?.destroy();pdfTask.current=null;setPaper(p);setDoc(null);setAnnotations([]);setBlocks(new Map());resetConversation();setPage(1);setNavigation(null);setError('');localStorage.setItem('paper:'+projectRef.current,p.id);loadBlocks(p,version);try{const task=pdfjs.getDocument(`/api/papers/${p.id}/pdf`);pdfTask.current=task;const [a,c,d]=await Promise.all([api(`/papers/${p.id}/annotations`),api(`/papers/${p.id}/conversations`),task.promise]);if(version!==openVersion.current)return;const list=c.some(x=>x.id==='default')?c:[{id:'default',title:'默认对话'},...c];setAnnotations(a);setConversations(list);setDoc(d);const saved=localStorage.getItem('conversation:'+p.id);await loadConversation(p,list.some(x=>x.id===saved)?saved:'default')}catch(e){if(version===openVersion.current){setError(e.message);setConversationLoading(false)}}}
 useEffect(()=>{let active=true;(async()=>{try{const [list,h]=await Promise.all([api('/projects'),api('/health')]);if(!active)return;setProjects(list);setHealth(h);let id=projectRef.current;if(!list.some(p=>p.id===id)){id=list[0]?.id||'default';projectRef.current=id;setProject(id);localStorage.setItem('project',id)}const p=await refresh(id);if(!active||projectRef.current!==id)return;if(initialUrl.current){const link=initialUrl.current;initialUrl.current=null;const query=new URL(location.href);query.searchParams.delete('url');history.replaceState(null,'',query);await importLink(link,id)}else if(p.length){const saved=localStorage.getItem('paper:'+id)||(id==='default'?localStorage.getItem('paper'):null);await open(p.find(x=>x.id===saved)||p[0])}}catch(e){if(active)setError(e.message)}})();return()=>{active=false;++openVersion.current;pdfTask.current?.destroy()}},[]);
 useEffect(()=>{chatEnd.current?.scrollIntoView({block:'nearest'})},[messages,status]);
 useEffect(()=>{
  let pending=false;
  async function syncLibrary(){
   if(document.visibilityState==='hidden'||importLock.current||pending)return;
   pending=true;
   try{await refresh()}catch{/* Background sync retries on the next focus or interval. */}finally{pending=false}
  }
  window.addEventListener('focus',syncLibrary);
  document.addEventListener('visibilitychange',syncLibrary);
  const timer=window.setInterval(syncLibrary,15000);
  return()=>{window.removeEventListener('focus',syncLibrary);document.removeEventListener('visibilitychange',syncLibrary);window.clearInterval(timer)};
 },[]);
 useEffect(()=>{localStorage.setItem('library-hidden',libraryHidden?'1':'0')},[libraryHidden]);
 useEffect(()=>{
  if(!importOpen)return;
  function outside(e){if(!importWrap.current?.contains(e.target))setImportOpen(false)}
  document.addEventListener('pointerdown',outside);
  return()=>document.removeEventListener('pointerdown',outside);
 },[importOpen]);
 useEffect(()=>{
  function shortcuts(e){
   if(e.isComposing)return;
   // Native dialogs and modal forms keep Escape for themselves.
   if(document.querySelector('dialog[open],.modal-backdrop'))return;
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='b'){e.preventDefault();setLibraryHidden(v=>!v);return}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='j'){e.preventDefault();setAssistantMaximized(v=>!v);return}
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='f'&&doc){e.preventDefault();setSearchOpen(true);document.querySelector('.pdf-search input')?.select();return}
   if(e.key==='Escape'&&importOpen){setImportOpen(false);return}
   if(e.key==='Escape'&&organizerOpen){setOrganizerOpen(false);return}
   if(e.key==='Escape'&&selection)clearSelection();
  }
  document.addEventListener('keydown',shortcuts);
  return()=>document.removeEventListener('keydown',shortcuts);
 },[selection,doc,organizerOpen,importOpen]);
 async function switchProject(id){if(busy||importLock.current)return;const version=++projectVersion.current;projectRef.current=id;setProject(id);localStorage.setItem('project',id);setFilter('');setPapers([]);setReport(null);clearReader();try{const p=await refresh(id);if(version===projectVersion.current&&projectRef.current===id&&p.length)await open(p.find(x=>x.id===localStorage.getItem('paper:'+id))||p[0])}catch(e){if(version===projectVersion.current&&projectRef.current===id)setError(e.message)}}
 async function createProject(e){e.preventDefault();if(!projectName.trim())return;try{const p=await api('/projects',json({name:projectName.trim()}));setProjects(v=>[...v,p]);setNewProject(false);setProjectName('');await switchProject(p.id)}catch(e){setError(e.message)}}
 async function uploadFiles(files){if(importLock.current||busy)return;const all=Array.from(files);if(!all.length)return;const pdfs=all.filter(f=>/\.pdf$/i.test(f.name));const id=projectRef.current;importLock.current=true;setImporting(true);setImportOpen(false);setError('');let last=null;const failures=[];let success=0;setReport(null);try{for(let i=0;i<pdfs.length;i++){const file=pdfs[i];setStatus(`正在导入 ${i+1}/${pdfs.length}：${file.webkitRelativePath||file.name}`);try{const body=new FormData();body.append('file',file);last=await api('/papers/upload?project_id='+encodeURIComponent(id),{method:'POST',body});success++}catch(e){failures.push({name:file.webkitRelativePath||file.name,error:e.message})}}await refresh(id);if(last&&id===projectRef.current)await open(last)}catch(e){setError(e.message)}finally{setReport({success,skipped:all.length-pdfs.length,failures});setStatus('');setImporting(false);importLock.current=false;if(fileRef.current)fileRef.current.value='';if(folderRef.current)folderRef.current.value=''}}
 async function importLink(link,id=projectRef.current){if(importLock.current||busy)return;importLock.current=true;setImporting(true);setError('');setStatus('正在从链接导入…');try{const p=await api('/papers/import',json({url:link.trim(),project_id:id}));await refresh(id);if(id===projectRef.current)await open(p);setUrlOpen(false);setUrl('')}catch(e){setError(e.message)}finally{setImporting(false);importLock.current=false;setStatus('')}}
 const goto=useCallback((number,y=null)=>{if(!doc)return;const target=Math.max(1,Math.min(doc.numPages,Number(number)||1));setPage(target);setNavigation({page:target,y,sequence:Date.now()})},[doc]);
 function gotoPage(number){setSelection(null);setAnchor(null);window.getSelection()?.removeAllRanges();goto(number)}
 const searchNavigate=useCallback((number,y)=>goto(number,y),[goto]);
 function cite({page:number,block}){
  const found=block?blocks.get(`p${number}#${block}`):null;
  if(!found){setFlash(null);gotoPage(number);return}
  const [x0,y0,x1,y1]=found.bbox;
  setFlash({page:number,kind:'flash',sequence:Date.now(),rects:[{x:x0-0.006,y:y0-0.004,width:x1-x0+0.012,height:y1-y0+0.008}]});
  goto(number,y0);
 }
 function citePreview({page:number,block}){const found=block?blocks.get(`p${number}#${block}`):null;return found?`第 ${number} 页：${found.text.slice(0,160)}${found.text.length>160?'…':''}`:`跳转到第 ${number} 页`}
 useEffect(()=>{if(!flash)return;const timer=setTimeout(()=>setFlash(null),2600);return()=>clearTimeout(timer)},[flash]);
 const marks=useMemo(()=>flash?[...searchMarks,flash]:searchMarks,[searchMarks,flash]);
 const hideAnchor=useCallback(()=>setAnchor(null),[]);
 function select(value,position){setSelection(value);setAnchor(position)}
 async function annotate(){if(!selection||!paper)return;const id=paper.id,version=openVersion.current;try{const a=await api(`/papers/${id}/annotations`,json({...selection,note,color}));if(version!==openVersion.current)return;setAnnotations(v=>[...v,a]);setNote('');clearSelection()}catch(e){if(version===openVersion.current)setError(e.message)}}
 async function deleteAnnotation(a){const version=openVersion.current;try{await api(`/papers/${paper.id}/annotations/${a.id}`,{method:'DELETE'});if(version===openVersion.current)setAnnotations(v=>v.filter(x=>x.id!==a.id))}catch(e){setError(e.message)}}
 async function send(e,preset){e?.preventDefault();const message=(preset?.message??question).trim(),action=preset?.action||null;if(!paper||!doc||!message||busy||importing||conversationLoading||conversationLock.current)return;const context=selection;if(!preset)setQuestion('');setBusy(true);setError('');setTab('chat');setSelection(null);setAnchor(null);window.getSelection()?.removeAllRanges();setTurnStarted(Date.now());setMessages(v=>[...v,{role:'user',content:message,selection:context,action},{role:'assistant',content:'',draft:''}]);controller.current=new AbortController();try{const r=await fetch(preset?.endpoint||`/api/papers/${paper.id}/chat`,{...json(preset?.body??{message,selection:context,page,conversation_id:conversation,action}),signal:controller.current.signal});if(!r.ok){const v=await r.json();throw Error(v.detail)}const reader=r.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});let index;while((index=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,index);buffer=buffer.slice(index+2);const line=block.split('\n').find(l=>l.startsWith('data: '));if(!line)continue;const v=JSON.parse(line.slice(6));if(v.type==='error')throw Error(v.content);if(v.type==='status')setStatus(v.content);if(v.type==='trace')setMessages(m=>m.map((x,i)=>i===m.length-1?{...x,trace:[...(x.trace||[]),v.content]}:x));if(v.type==='step')setMessages(m=>m.map((x,i)=>i===m.length-1?{...x,draft:v.content}:x));if(v.type==='delta')setMessages(m=>m.map((x,i)=>i===m.length-1?{...x,content:x.content+v.content}:x));if(v.type==='done')setStatus('')}if(done)break}const list=await api(`/papers/${paper.id}/conversations`);setConversations(list.some(x=>x.id==='default')?list:[{id:'default',title:'默认对话'},...list])}catch(e){setError(e.name==='AbortError'?'已停止接收。当前 Harness 任务可能仍在后台运行，请等待本轮结束。':e.message)}finally{setBusy(false);setStatus('');setTurnStarted(null)}}
 function runAction(id){const item=ACTIONS.find(a=>a.id===id);if(id==='translate')return send(null,{message:item.message,action:id,endpoint:`/api/papers/${paper.id}/translate`,body:{selection,conversation_id:conversation}});send(null,{message:item.message,action:id})}
 function askAboutSelection(){setAnchor(null);setTab('chat');requestAnimationFrame(()=>composer.current?.focus())}
 async function showSettings(){try{setSettings(await api('/settings'));setSettingsDirty(false);setConnection(null);setToken((await api('/capture-token')).token);setProfile((await api('/profile').catch(()=>({text:''}))).text);const saved=await api(`/projects/${projectRef.current}/memory`);setProjectMemory(saved);setMemoryItems(saved.items||[]);setMemoryStatus('')}catch(e){setError(e.message)}}
 async function saveProjectMemory(){setMemorySaving(true);setMemoryStatus('');try{const saved=await api(`/projects/${projectRef.current}/memory`,json({items:memoryItems},'PUT'));setProjectMemory(saved);setMemoryItems(saved.items||[]);setMemoryStatus('项目记忆已保存')}catch(e){setMemoryStatus(e.message)}finally{setMemorySaving(false)}}
 async function maintainProjectMemory(){setMemoryStatus('正在提交整理任务…');try{await api(`/projects/${projectRef.current}/memory/maintain`,{method:'POST'});setMemoryStatus('后台整理已启动；完成后重新打开项目记忆即可查看')}catch(e){setMemoryStatus(e.message)}}
 function updateMemoryItem(index,text){setMemoryItems(items=>items.map((item,i)=>i===index?{...item,text}:item))}
 function settingsBody(){const data=new FormData(settingsForm.current);const body={model:data.get('model'),base_url:data.get('base_url')};if(data.get('api_key'))body.api_key=data.get('api_key');return body}
 async function saveSettings(e){e.preventDefault();setSaving(true);try{const saved=await api('/settings',json(settingsBody(),'PUT'));await api('/profile',json({text:profile},'PUT'));setSettings(saved);setSettingsDirty(false);settingsForm.current.elements.api_key.value='';setConnection(null);setHealth(await api('/health'))}catch(e){setError(e.message)}finally{setSaving(false)}}
 async function testConnection(){setTesting(true);setConnection(null);try{setConnection(await api('/settings/test',{method:'POST'}))}catch(e){setConnection({ok:false,detail:e.message})}finally{setTesting(false)}}
 const locked=busy||importing,chatLocked=locked||conversationLoading,configured=Boolean(health?.harness?.configured);
 const ThemeIcon=themes.find(t=>t[0]===theme)?.[2]||Monitor;
 const visibleConversations=conversations.filter(c=>!c.archived);
 return <div className={'app'+(libraryHidden?' library-hidden':'')+(assistantMaximized?' assistant-maximized':'')}>
  <aside className="library">
   <div className="brand"><Mark/><div>DR<span>DeepSeek Reader</span></div></div>
   <div className="project-picker"><select id="project" aria-label="项目" disabled={locked} value={project} onChange={e=>switchProject(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="icon-button" disabled={locked} title="新建项目" aria-label="新建项目" onClick={()=>setNewProject(true)}><Plus size={16}/></button></div>
   <div className="import-menu" ref={importWrap}>
    <button className="primary import-toggle" aria-expanded={importOpen} aria-controls="import-panel" disabled={locked} onClick={()=>setImportOpen(v=>!v)}><Plus size={15}/>导入</button>
    {importOpen&&<div id="import-panel" className="import-panel" aria-label="导入论文">
     <button type="button" onClick={()=>fileRef.current.click()}><FileText size={16}/><span><strong>选择 PDF</strong><small>一次可选多篇，失败的会单独列出</small></span></button>
     <button type="button" onClick={()=>folderRef.current.click()}><FolderInput size={16}/><span><strong>导入文件夹</strong><small>含子文件夹；只复制 PDF，跳过其他文件</small></span></button>
     <button type="button" onClick={()=>{setImportOpen(false);setUrlOpen(true)}}><Link size={16}/><span><strong>从链接打开</strong><small>公开 PDF、arXiv 或论文网页</small></span></button>
     <p>文件会复制进当前项目。导入和打开都不会自动生成收费导读。</p>
    </div>}
    <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple hidden onChange={e=>uploadFiles(e.target.files)}/><input ref={folderRef} type="file" webkitdirectory="" directory="" multiple hidden onChange={e=>uploadFiles(e.target.files)}/>
   </div>
   {importing&&<p className="import-progress" role="status">{status}</p>}
   {report&&<div className="import-report" role="status"><button className="icon-button" aria-label="关闭导入结果" onClick={()=>setReport(null)}><X size={14}/></button>已导入 {report.success} 个 PDF，跳过 {report.skipped} 个非 PDF{report.failures.map((f,i)=><p key={i}>{f.name}：{f.error}</p>)}</div>}
   <div className="library-top"><h2>论文库 <span>{papers.length}</span></h2><button className="icon-button" disabled={locked} title="刷新论文库" aria-label="刷新论文库" onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={14}/></button><button className="icon-button" disabled={locked} title="收起论文库（⌘B / Ctrl+B）" aria-label="收起论文库" onClick={()=>setLibraryHidden(true)}><PanelLeftClose size={15}/></button></div>
   <label className="search"><Search size={14}/><input placeholder="搜索论文…" aria-label="搜索论文" value={filter} onChange={e=>setFilter(e.target.value)}/></label>
   <div className="paper-list">{papers.filter(p=>p.title.toLowerCase().includes(filter.toLowerCase())).map(p=><button disabled={locked} className={'paper-item '+(paper?.id===p.id?'active':'')} key={p.id} onClick={()=>open(p)}><FileText size={15} className="paper-icon"/><span><strong>{p.title}</strong><small>{p.page_count} 页 · {new Date(p.created_at).toLocaleDateString()}</small></span></button>)}{!papers.length&&<p className="muted empty-library">导入一篇论文，开始阅读。<br/>也可以使用 Chrome 扩展收藏。</p>}</div>
   <footer className="library-footer">
    <button className="settings-button" onClick={showSettings}><Settings size={15}/>设置与浏览器收藏</button>
    <button className="icon-button" title={'外观：'+themes.find(t=>t[0]===theme)?.[1]} aria-label="切换外观" onClick={()=>setTheme(themes[(themes.findIndex(t=>t[0]===theme)+1)%themes.length][0])}><ThemeIcon size={15}/></button>
   </footer>
   <div className="agent-health"><i className={configured?'ready':''}/>{configured?'API Key 已保存':'等待配置 DeepSeek Key'}</div>
  </aside>
  <main className="reader">
   <header className="reader-header">
    {libraryHidden&&<button className="icon-button expand-library" title="展开论文库（⌘B / Ctrl+B）" aria-label="展开论文库" onClick={()=>setLibraryHidden(false)}><PanelLeftOpen size={16}/></button>}
    <span className="reader-title" title={paper?.title}>{paper?.title||'你的论文阅读工作台'}</span>
    {doc&&<button ref={outlineButton} className="toc-toggle tool-button" aria-label="论文目录" aria-expanded={outlineOpen} aria-controls="pdf-outline" onClick={()=>setOutlineOpen(v=>!v)}><ListTree size={15}/>目录</button>}
    {doc&&<button className="tool-button" aria-label="搜索全文" title="搜索全文（⌘F / Ctrl+F）" aria-pressed={searchOpen} onClick={()=>setSearchOpen(v=>!v)}><Search size={15}/>搜索</button>}
    {paper&&<button className="details-button icon-button" aria-label="文档详情" title="文档详情" onClick={()=>setDetailsOpen(true)}><Info size={16}/></button>}
    {doc&&<div className="page-controls"><button className="icon-button" aria-label="上一页" disabled={page===1} onClick={()=>gotoPage(page-1)}><ChevronLeft size={16}/></button><input aria-label="页码" type="number" min="1" max={doc.numPages} value={page} onChange={e=>gotoPage(e.target.value)}/><span>/ {doc.numPages}</span><button className="icon-button" aria-label="下一页" disabled={page===doc.numPages} onClick={()=>gotoPage(page+1)}><ChevronRight size={16}/></button><select aria-label="缩放" value={zoom} onChange={e=>{setZoom(+e.target.value);clearSelection()}}>{[.8,1,1.08,1.25,1.5,1.75,2].map(z=><option key={z} value={z}>{Math.round(z*100)}%</option>)}</select><a className="icon-button" href={`/api/papers/${paper.id}/pdf`} target="_blank" rel="noreferrer" title="打开原始 PDF" aria-label="打开原始 PDF"><ExternalLink size={15}/></a></div>}
   </header>
   {doc?<PdfReader key={paper.id} doc={doc} zoom={zoom} annotations={annotations} marks={marks} onSelect={select} onPage={setPage} onScroll={hideAnchor} navigation={navigation}/>:<div className="document-area"><div className="welcome"><Mark size={64} className="welcome-mark"/><h1>{paper?'正在加载论文…':'读论文，和 Agent 一起。'}</h1><p>滚动阅读全文，选中段落一键解释、推导或翻译。</p><button className="primary" disabled={locked} onClick={()=>{setLibraryHidden(false);setImportOpen(true)}}>导入论文</button><small>文件、批注和阅读记录保存在本机项目中</small></div></div>}
   {doc&&searchOpen&&<PdfSearch key={paper.id} doc={doc} onMarks={setSearchMarks} onNavigate={searchNavigate} onClose={()=>setSearchOpen(false)}/>}
   {doc&&outlineOpen&&<PdfOutline key={paper.id} doc={doc} page={page} onNavigate={gotoPage} onClose={closeOutline}/>}
   {selection&&<SelectionPopover selection={selection} anchor={anchor} note={note} onNote={setNote} palette={<Palette value={color} onChange={chooseColor}/>} onAnnotate={annotate} onAction={runAction} onAsk={askAboutSelection} onClose={clearSelection} disabled={chatLocked||!doc}/>}
  </main>
  <aside className="assistant">
   <header className="assistant-header">
    <nav className="assistant-tabs" aria-label="助手面板">
     <button className={tab==='chat'?'selected':''} onClick={()=>setTab('chat')}>对话</button>
     <button className={tab==='card'?'selected':''} onClick={()=>setTab('card')}>导读</button>
     <button className={tab==='notes'?'selected':''} onClick={()=>setTab('notes')}>批注 {annotations.length||''}</button>
    </nav>
    <button type="button" className="icon-button assistant-expand" aria-label={assistantMaximized?'还原回复区':'放大回复区'} title={assistantMaximized?'还原回复区（⌘J / Ctrl+J）':'放大回复区（⌘J / Ctrl+J）'} aria-pressed={assistantMaximized} onClick={()=>setAssistantMaximized(v=>!v)}>{assistantMaximized?<Minimize2 size={15}/>:<Maximize2 size={15}/>}</button>
   </header>
   {error&&<div className="error" role="alert"><span>{error}</span><button className="icon-button" aria-label="关闭错误" onClick={()=>setError('')}><X size={14}/></button></div>}
   {tab==='chat'&&<>
    <div className="conversation-picker">
     <select aria-label="对话记录" disabled={!doc||locked||conversationLock.current} value={conversation} onChange={e=>switchConversation(e.target.value)}>{visibleConversations.map(c=><option key={c.id} value={c.id}>{c.title||'新对话'}</option>)}</select>
     <button className="icon-button" disabled={!doc||chatLocked} aria-label="新建对话" title="新建对话" onClick={createConversation}><SquarePen size={15}/></button>
     <button className="icon-button" disabled={!doc} aria-label="管理对话" title="管理对话" aria-expanded={organizerOpen} onClick={()=>setOrganizerOpen(v=>!v)}><History size={15}/></button>
    </div>
    {organizerOpen&&<section className="conversation-organizer" aria-label="对话管理"><input aria-label="搜索对话" placeholder="搜索对话标题…" value={conversationSearch} onChange={e=>setConversationSearch(e.target.value)}/>{['active','archived'].map(section=>{const items=conversations.filter(c=>Boolean(c.archived)===(section==='archived')&&(c.title||'新对话').toLowerCase().includes(conversationSearch.toLowerCase()));return <div className="conversation-group" key={section}><h3>{section==='active'?'进行中的对话':'已归档'}</h3>{items.map(item=><div className={'conversation-row '+(conversation===item.id?'current':'')} key={item.id}><button className="conversation-title" disabled={chatLocked} onClick={()=>switchConversation(item.id)} title={item.title||'新对话'}>{item.title||'新对话'}{conversation===item.id&&<small>当前</small>}</button>{item.id!=='default'&&<div className="conversation-actions"><button className="icon-button" title="重命名" aria-label={`重命名 ${item.title||'新对话'}`} disabled={chatLocked} onClick={()=>{setRenamingConversation(item);setRenameTitle(item.title||'')}}><Pencil size={13}/></button><button className="icon-button" title="自动命名" aria-label={`自动命名 ${item.title||'新对话'}`} disabled={chatLocked} onClick={()=>suggestConversationTitle(item)}><WandSparkles size={13}/></button><button className="icon-button" title={item.archived?'取消归档':'归档'} aria-label={`${item.archived?'取消归档':'归档'} ${item.title||'新对话'}`} disabled={chatLocked} onClick={()=>updateConversation(item,{archived:!item.archived})}>{item.archived?<ArchiveRestore size={13}/>:<Archive size={13}/>}</button><button className="icon-button danger" title="删除" aria-label={`删除 ${item.title||'新对话'}`} disabled={chatLocked} onClick={()=>deleteConversation(item)}><Trash2 size={13}/></button></div>}</div>)}{!items.length&&<p className="muted">{conversationSearch?'没有匹配的对话':'暂无对话'}</p>}</div>})}</section>}
    <section className="reply-panel">
     {assistantMaximized&&<header className="reply-panel-header"><span>{paper?.title||'论文对话'}</span><button type="button" className="icon-button" onClick={()=>setAssistantMaximized(false)} aria-label="收起放大面板" title="还原（⌘J / Ctrl+J）"><Minimize2 size={15}/></button></header>}
     <div className="conversation" aria-busy={conversationLoading}>
      {!messages.length&&<div className="chat-empty"><h3>从一个问题开始</h3><p>选中原文可以一键解释、推导公式、讲解图表或翻译；也可以直接问整篇论文。</p>{['这篇论文的核心想法是什么？','实验真的支撑作者的结论吗？','方法里最关键的公式怎么理解？'].map(q=><button key={q} disabled={!doc||chatLocked} onClick={()=>{setQuestion(q);composer.current?.focus()}}>{q}</button>)}</div>}
      {messages.map((m,i)=>{const live=busy&&m.role==='assistant'&&i===messages.length-1;return <article className={'message '+m.role} key={m.id||i}>
       {m.role==='user'?<>
        {(m.action||m.selection)&&<div className="message-context">{m.action&&<span className="action-badge">{actionLabels[m.action]||m.action}</span>}{m.selection&&<blockquote>第 {m.selection.page} 页 · {m.selection.text.slice(0,200)}</blockquote>}</div>}
        <p className="user-text">{m.content}</p>
       </>:<>
        <label><Mark size={20} className="assistant-mark"/>研究助手</label>
        <AgentTrace items={m.trace}/>
        {m.content?<Answer text={m.content} onCite={cite} preview={citePreview}/>:live?<div className="live">
         <div className="progress-line"><LoaderCircle className="spin" size={14}/><span>{status||(m.action==='translate'?'正在翻译…':'正在阅读与分析…')}</span>{turnStarted&&<Elapsed since={turnStarted}/>}</div>
         {m.draft&&<p className="draft">{m.draft}</p>}
        </div>:<p className="muted">本轮未产生回复</p>}
       </>}
      </article>})}
      <div ref={chatEnd}/>
     </div>
     <form className="composer" onSubmit={send}>
      {selection&&<div className="context-chip"><span>选中段落 · 第 {selection.page} 页</span><button type="button" className="icon-button" aria-label="移除选中段落" onClick={clearSelection}><X size={12}/></button></div>}
      <textarea ref={composer} aria-label="向 Agent 提问" disabled={!doc||chatLocked} placeholder={paper?'询问这篇论文…':'先导入或选择一篇论文'} value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send()}}}/>
      <footer><span>{busy?status||'正在处理…':'Enter 发送 · Shift+Enter 换行'}</span>{busy?<button type="button" className="stop-button" onClick={()=>controller.current?.abort()}><Square size={11}/>停止</button>:<button className="primary send-button" aria-label="发送" disabled={!doc||chatLocked||!question.trim()}><ArrowUp size={16}/></button>}</footer>
     </form>
    </section>
   </>}
   {tab==='card'&&(paper?<PaperCard key={paper.id} paperId={paper.id} configured={configured} onCite={cite} preview={citePreview}/>:<p className="muted pane-empty">先选择一篇论文。</p>)}
   {tab==='notes'&&<div className="notes">{!annotations.length&&<p className="muted">在 PDF 中选择文字，保存高亮与备注。</p>}{annotations.map(a=><article className="note" key={a.id} style={{'--note-color':a.color}}><button className="note-page" onClick={()=>gotoPage(a.page)}>第 {a.page} 页</button><blockquote>{a.text}</blockquote>{a.note&&<p>{a.note}</p>}<button className="ghost-button" onClick={()=>deleteAnnotation(a)}>删除</button></article>)}</div>}
  </aside>
  {detailsOpen&&paper&&<DocumentDetails key={project+':'+paper.id} paperId={paper.id} onClose={()=>setDetailsOpen(false)}/>}
  {renamingConversation&&<div className="modal-backdrop"><form className="modal" aria-label="重命名对话" onSubmit={submitConversationTitle}><h2>重命名对话</h2><label>对话名称<input aria-label="对话名称" required autoFocus maxLength="160" value={renameTitle} onChange={e=>setRenameTitle(e.target.value)}/></label><footer><button type="button" onClick={()=>setRenamingConversation(null)}>取消</button><button className="primary" disabled={!renameTitle.trim()||conversationLock.current}>保存</button></footer></form></div>}
  {urlOpen&&<div className="modal-backdrop"><form className="modal" onSubmit={e=>{e.preventDefault();importLink(url)}}><h2>从链接打开</h2><p>输入 PDF、arXiv 或论文网页链接，导入当前项目并打开。</p><label>论文链接<input aria-label="论文链接" type="url" required autoFocus value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://arxiv.org/abs/…"/></label><footer><button type="button" disabled={importing} onClick={()=>setUrlOpen(false)}>取消</button><button className="primary" disabled={locked||!url.trim()}>{importing?'正在导入…':'导入并打开'}</button></footer></form></div>}
  {newProject&&<div className="modal-backdrop"><form className="modal" onSubmit={createProject}><h2>新建项目</h2><label>项目名称<input aria-label="项目名称" required autoFocus value={projectName} onChange={e=>setProjectName(e.target.value)}/></label><footer><button type="button" onClick={()=>setNewProject(false)}>取消</button><button className="primary" disabled={!projectName.trim()}>创建项目</button></footer></form></div>}
  {settings&&<div className="modal-backdrop"><form ref={settingsForm} className="modal" onSubmit={saveSettings} onChange={()=>{setConnection(null);setSettingsDirty(true)}}><h2>连接 DeepSeek Harness</h2><p>使用官方 Harness SDK 的 Agent、文件工具和独立会话。</p><label>API Key · {settings.has_api_key?'已保存':'未保存'}<input name="api_key" type="password" autoComplete="off" placeholder={settings.has_api_key?'已保存，留空保留':'输入 DeepSeek API Key'}/></label><label>模型<input name="model" defaultValue={settings.model}/></label><label>Base URL<input name="base_url" defaultValue={settings.base_url}/></label><p className="muted">测试使用已保存的配置。修改后请先保存；页面不会读取已保存的密钥。</p>{connection&&<p role="status" className={connection.ok?'connection-ok':'error'}>{connection.ok?'已验证':'连接失败'}：{connection.detail}</p>}<button type="button" disabled={testing||saving||settingsDirty} onClick={testConnection}>{testing?'正在测试…':'测试连接'}</button>
   <h3>你的研究背景</h3><p>Agent 会据此选择讲解深浅和例子，例如研究方向、熟悉的方法、正在做的项目。</p><textarea name="profile" aria-label="研究背景" maxLength="8000" rows="4" placeholder="例如：做自动驾驶端到端规划，熟悉模仿学习与 Transformer，对数据筛选和蒸馏感兴趣。" value={profile} onChange={e=>setProfile(e.target.value)}/>
   <h3>当前项目记忆 · {projects.find(p=>p.id===project)?.name||'项目'}</h3><p>按项目隔离，仅在有具体关联时用于联系论文与项目。10 轮新对话或 24 小时后后台整理。</p>
   <div className="project-memory-list">{memoryItems.map((item,index)=><div className="project-memory-item" key={item.id||index}><textarea aria-label={`项目记忆文本 ${index+1}`} maxLength="700" rows="2" value={item.text} onChange={e=>updateMemoryItem(index,e.target.value)}/><button type="button" className="icon-button" aria-label={`删除项目记忆 ${index+1}`} onClick={()=>setMemoryItems(v=>v.filter((_,i)=>i!==index))}><Trash2 size={14}/></button></div>)}{!memoryItems.length&&<p className="muted">暂无整理后的项目记忆。记忆由近期对话自动整理，也可手动添加。</p>}</div>
   <div className="memory-actions"><button type="button" onClick={()=>setMemoryItems(v=>[...v,{text:'',kind:'project',source:'用户编辑'}])}>添加记忆</button><button type="button" onClick={maintainProjectMemory} disabled={!configured}>立即整理</button><button type="button" className="primary" onClick={saveProjectMemory} disabled={memorySaving}>{memorySaving?'保存中…':'保存项目记忆'}</button></div>{memoryStatus&&<p role="status" className="muted">{memoryStatus}</p>}
   <h3>Chrome 一键收藏</h3><p>加载项目中的 extension 文件夹，把下面的配对令牌填入扩展。服务地址：http://127.0.0.1:8765</p><input aria-label="收藏配对令牌" readOnly value={token} onFocus={e=>e.target.select()}/><p className="muted">API Key 保存在本机用户配置目录，不会返回到页面。Agent 可用 read_image 查看页面与图表原图。</p><footer><button type="button" disabled={saving||testing} onClick={()=>setSettings(null)}>关闭</button><button disabled={saving||testing} className="primary">{saving?'正在保存…':'保存配置'}</button></footer></form></div>}
 </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
