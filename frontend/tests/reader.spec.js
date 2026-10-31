import {test, expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

// Small valid PDF fixture generated locally; API routes are deliberately mocked.
function pdfFixture(count=12){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${count} >>`];
 for(let i=0;i<count;i++){objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${4+i*2} 0 R >>`);objects.push('<< /Length 0 >>\nstream\n\nendstream')}
 let text='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`});const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(text);
}
async function setup(page){
 const calls=[];let papers=[{id:'one',title:'First paper',page_count:12,created_at:'2026-01-01'}];
 let conversations=[{id:'default',title:'默认对话',created_at:'2026-01-01'}];const histories={default:[{role:'assistant',content:'Evidence [p.6]',trace:[{id:'r',kind:'reasoning',content:'Public reasoning fixture',status:'completed'},{id:'t',kind:'tool',name:'read_file',call_id:'c1',content:'fulltext.md',status:'running'},{id:'o',kind:'tool_result',call_id:'c1',content:'Paper evidence',status:'completed'}]}]};
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;calls.push({path,query:url.search,method:request.method(),body:request.postData()});
  const fulfill=(value,status=200)=>route.fulfill({status,json:value});
  if(path==='/api/projects')return fulfill([{id:'default',name:'默认项目'},{id:'second',name:'第二项目'}]);
  if(path.endsWith('/memory')&&request.method()==='GET')return fulfill({items:[],turns_since_maintenance:0,last_maintenance_at:null});
  if(path.endsWith('/memory')&&request.method()==='PUT')return fulfill({items:request.postDataJSON().items,turns_since_maintenance:0,last_maintenance_at:null});
  if(path.endsWith('/memory/maintain')&&request.method()==='POST')return fulfill({status:'started'});
  if(path==='/api/health')return fulfill({harness:{configured:true}});
  if(path==='/api/papers')return fulfill(url.searchParams.get('project_id')==='second'?[]:papers);
  if(path.endsWith('/details')){const id=path.split('/').at(-2);return fulfill({id,title:id==='one'?'First paper':'Uploaded paper',filename:id==='one'?'Original.PDF':'upload.pdf',page_count:12,size:1536,created_at:'2026-01-01T12:34:56Z',project_name:'默认项目',source_url:id==='one'?'https://example.org/original.pdf':null,pdf_path:'/custom/storage/'+id+'/paper.pdf',metadata_dir:'/custom/storage/'+id})}
  if(path.endsWith('/pdf'))return route.fulfill({contentType:'application/pdf',body:pdfFixture()});
  if(path.endsWith('/annotations'))return fulfill(request.method()==='POST'?{id:'created',...request.postDataJSON()}:[{id:'note',page:8,text:'Saved annotation',note:'test',rects:[]}]);
  if(path.endsWith('/suggest-title')){const id=path.split('/').at(-2),item=conversations.find(c=>c.id===id);return fulfill({title:'Suggested '+(item?.title||'chat')})}
  const conversationAction=path.match(/\/api\/papers\/([^/]+)\/conversations\/([^/]+)$/);if(conversationAction){const id=conversationAction[2];if(id==='default')return fulfill({detail:'Default conversation is protected'},403);if(request.method()==='PATCH'){const patch=request.postDataJSON();conversations=conversations.map(c=>c.id===id?{...c,...patch}:c);return fulfill(conversations.find(c=>c.id===id))}if(request.method()==='DELETE'){conversations=conversations.filter(c=>c.id!==id);delete histories[id];return fulfill({ok:true})}}
  if(path.endsWith('/conversations')){if(request.method()==='POST'){const item={id:'conv-'+conversations.length,title:'新对话',created_at:'2026-01-01',archived:false};conversations.push(item);histories[item.id]=[];return fulfill(item)}return fulfill(conversations)}
  if(path.endsWith('/messages'))return fulfill(histories[url.searchParams.get('conversation_id')]||[]);
  if(path.endsWith('/chat')){const body=request.postDataJSON();histories[body.conversation_id]=[...histories[body.conversation_id],{role:'user',content:body.message},{role:'assistant',content:'Independent reply'}];conversations=conversations.map(c=>c.id===body.conversation_id?{...c,title:body.message}:c);return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'delta',content:'Independent reply'})+'\n\ndata: '+JSON.stringify({type:'done'})+'\n\n'})}
  if(path.endsWith('/translate'))return route.fulfill({contentType:'text/event-stream',body:'data: '+JSON.stringify({type:'delta',content:'快速译文'})+'\n\ndata: '+JSON.stringify({type:'done'})+'\n\n'});
  if(path==='/api/papers/upload'){
   if(request.postDataBuffer().includes(Buffer.from('bad.pdf')))return fulfill({detail:'Invalid PDF'},400);
   const paper={id:'uploaded',title:'Uploaded paper',page_count:12,created_at:'2026-01-01'};papers=[...papers,paper];return fulfill(paper);
  }
  if(path==='/api/papers/import'){const paper={id:'linked',title:'Linked paper',page_count:12,created_at:'2026-01-01'};papers=[...papers,paper];return fulfill(paper)}
  if(path==='/api/settings')return fulfill({has_api_key:true,model:'deepseek',base_url:'https://api.deepseek.com'});
  if(path==='/api/capture-token')return fulfill({token:'fixture-pairing-token'});
  if(path==='/api/settings/test')return fulfill({ok:true,detail:'Connection successful'});
  if(path.endsWith('/blocks'))return fulfill({pages:[{page:2,blocks:[{id:'p2#1',bbox:[0.1,0.3,0.9,0.4],text:'Cited paragraph text'}]},{page:3,blocks:[{id:'p3#1',bbox:[0.1,0.3,0.9,0.4],text:'Another cited paragraph'}]}]});
  if(path.endsWith('/card'))return fulfill({status:'done',content:'## 一句话\n核心想法见 [p.3]。'});
  if(path==='/api/profile')return fulfill({text:request.method()==='PUT'?request.postDataJSON().text:'自动驾驶研究者'});
  return fulfill({detail:'Unexpected route'},404);
 });
 return calls;
}
test('Markdown remote images never trigger third-party requests',async({page})=>{
 await setup(page);
 const requests=[];
 await page.route('https://privacy-test.invalid/**',route=>{requests.push(route.request().url());return route.abort()});
 await page.route('**/api/papers/one/messages*',route=>route.fulfill({json:[{role:'assistant',content:'![tracking](https://privacy-test.invalid/pixel.png)'}]}));
 await page.goto('/');
 await expect(page.getByText('[图片已阻止自动加载：tracking]',{exact:true})).toBeVisible();
 await expect(page.locator('.markdown img')).toHaveCount(0);
 expect(requests).toEqual([]);
});

test('LaTeX delimiters render equations and contain wide formulas',async({page})=>{
 await setup(page);
 const content=String.raw`行内 \(x^2 + y^2\) 与 $z^2$。

\[\begin{aligned}a&=b+c\\d&=\frac{1}{2}\end{aligned}\]

\[a_1+a_2+a_3+a_4+a_5+a_6+a_7+a_8+a_9+a_{10}+a_{11}+a_{12}=0\]

代码：`+'`'+String.raw`\(keep\)`+'`';
 await page.route('**/api/papers/*/messages*',route=>route.fulfill({json:[{role:'assistant',content}]}));
 await page.goto('/');
 await expect(page.locator('.message .katex-display')).toHaveCount(2);
 await expect(page.locator('.message .katex-error')).toHaveCount(0);
 await expect(page.locator('.message code')).toHaveText(String.raw`\(keep\)`);
 const display=page.locator('.message .katex-display').last();
 expect(await display.evaluate(el=>getComputedStyle(el).overflowX)).toBe('auto');
 const sizes=await page.locator('.conversation').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+2);
 await page.getByRole('button',{name:'放大回复区',exact:true}).click();
 await expect(page.locator('.message .katex-display')).toHaveCount(2);
});
test('restored and streamed agent trace expands reasoning and tool details',async({page})=>{
 await setup(page);await page.goto('/');
 await expect(page.locator('.agent-trace')).toContainText('1 次调用');
 await expect(page.getByText('Public reasoning fixture',{exact:true})).toBeHidden();
 await page.locator('.agent-trace > summary').click();
 await page.locator('.agent-trace summary').filter({hasText:'模型推理'}).click();
 await expect(page.getByText('Public reasoning fixture',{exact:true})).toBeVisible();
 await page.locator('.agent-trace summary').filter({hasText:'调用 read_file'}).click();
 await expect(page.getByText('fulltext.md',{exact:true})).toBeVisible();
 await page.route('**/api/papers/*/chat',route=>route.fulfill({contentType:'text/event-stream',body:[{type:'trace',content:{id:'live',kind:'reasoning',content:'Live public reasoning',status:'completed'}},{type:'delta',content:'Live answer'},{type:'done'}].map(x=>'data: '+JSON.stringify(x)+'\n\n').join('')}));
 await page.getByLabel('向 Agent 提问').fill('Explain');await page.getByRole('button',{name:'发送',exact:true}).click();
 const trace=page.locator('.message.assistant').last().locator('.agent-trace');await expect(trace).toBeVisible();
 await trace.locator('> summary').click();await trace.locator('summary').filter({hasText:'模型推理'}).click();await expect(page.getByText('Live public reasoning',{exact:true})).toBeVisible();
 await expect(page.getByText('Live answer',{exact:true})).toBeVisible();
 await page.reload();await expect(page.locator('.agent-trace')).toContainText('1 次调用');
});
test('continuous reader scroll, lazy canvases and navigation preserve page containers',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await setup(page);await page.goto('/');
 const reader=page.getByLabel('PDF 连续阅读');await expect(reader.locator('[data-page]')).toHaveCount(12);
 await expect(reader.locator('canvas').first()).toBeVisible();expect(await reader.locator('canvas').count()).toBeLessThan(12);
 await reader.locator('[data-page="1"]').evaluate(el=>el.dataset.marker='stable');
 await reader.hover();await page.mouse.wheel(0,1900);await expect(page.getByLabel('页码',{exact:true})).not.toHaveValue('1');
 await page.getByLabel('页码',{exact:true}).fill('10');await expect(page.getByLabel('页码',{exact:true})).toHaveValue('10');
 await expect(reader.locator('[data-page="10"] canvas')).toBeVisible();
 await page.getByRole('button',{name:'[p.6]',exact:true}).click();await expect(page.getByLabel('页码',{exact:true})).toHaveValue('6');
 await page.getByRole('button',{name:'批注 1',exact:true}).click();await page.getByRole('button',{name:'第 8 页',exact:true}).click();await expect(page.getByLabel('页码',{exact:true})).toHaveValue('8');
 await expect(reader.locator('[data-page="1"]')).toHaveAttribute('data-marker','stable');expect(errors).toEqual([]);
});
test('multi-file import continues after failures, skips non-PDF, persists project',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();
 await page.locator('input[type=file]').first().setInputFiles([{name:'good.pdf',mimeType:'application/pdf',buffer:pdfFixture()},{name:'bad.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid')},{name:'readme.txt',mimeType:'text/plain',buffer:Buffer.from('skip')},{name:'later.pdf',mimeType:'application/pdf',buffer:pdfFixture()}]);
 await expect(page.getByRole('status')).toContainText('已导入 2 个 PDF，跳过 1 个非 PDF');await expect(page.getByRole('status')).toContainText('bad.pdf：Invalid PDF');
 expect(calls.filter(c=>c.path==='/api/papers/upload')).toHaveLength(3);expect(calls.filter(c=>c.path==='/api/papers/upload').every(c=>c.query==='?project_id=default')).toBeTruthy();
 await expect(page.locator('.reader-header')).toContainText('Uploaded paper');
 await page.getByLabel('项目',{exact:true}).selectOption('second');await expect(page.locator('.paper-item')).toHaveCount(0);expect(await page.evaluate(()=>localStorage.getItem('project'))).toBe('second');await page.reload();await expect(page.getByLabel('项目',{exact:true})).toHaveValue('second');
 expect(await page.locator('input[webkitdirectory]').count()).toBe(1);
});
test('directory selection imports nested PDFs sequentially and locks project during batch',async({page},testInfo)=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();
 const directory=testInfo.outputPath('folder');await mkdir(path.join(directory,'nested'),{recursive:true});await writeFile(path.join(directory,'nested','paper.pdf'),pdfFixture());await writeFile(path.join(directory,'readme.txt'),'skip');
 let release;const gate=new Promise(resolve=>{release=resolve});await page.route('**/api/papers/upload?*',async route=>{await gate;await route.fallback()});
 await page.locator('input[webkitdirectory]').setInputFiles(directory);await expect(page.getByLabel('项目',{exact:true})).toBeDisabled();await expect(page.locator('.import-progress')).toContainText('nested/paper.pdf');release();
 await expect(page.getByRole('status')).toContainText('已导入 1 个 PDF，跳过 1 个非 PDF');await expect(page.getByLabel('项目',{exact:true})).toBeEnabled();expect(calls.filter(c=>c.path==='/api/papers/upload')).toHaveLength(1);
});

test('rapid project switching ignores late results even when returning to same project',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();let release;const gate=new Promise(resolve=>{release=resolve});let secondRequests=0;
 await page.route('**/api/papers?project_id=second',async route=>{secondRequests++;if(secondRequests===1){await gate;await route.fulfill({json:[{id:'stale',title:'Stale paper',page_count:12,created_at:'2026-01-01'}]})}else await route.fulfill({json:[]})});
 await page.getByLabel('项目',{exact:true}).selectOption('second');await expect.poll(()=>secondRequests).toBe(1);await page.getByLabel('项目',{exact:true}).selectOption('default');await page.getByLabel('项目',{exact:true}).selectOption('second');await expect.poll(()=>secondRequests).toBe(2);release();
 await expect(page.locator('.reader-header')).not.toContainText('Stale paper');await expect(page.locator('.paper-item')).toHaveCount(0);await expect(page.getByLabel('PDF 连续阅读')).toHaveCount(0);
});

test('independent conversations clear context, restore history and persist active choice',async({page},testInfo)=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByRole('button',{name:'[p.6]',exact:true})).toBeVisible();await expect(page.getByLabel('缩放')).toHaveValue('1.5');
 await selectFixtureText(page);await expect(page.locator('.context-chip')).toBeVisible();await page.getByLabel('向 Agent 提问').fill('Unsent old question');await page.getByRole('button',{name:'新建对话',exact:true}).click();
 await expect(page.getByLabel('对话记录')).toHaveValue('conv-1');await expect(page.locator('.message')).toHaveCount(0);await expect(page.getByLabel('向 Agent 提问')).toHaveValue('');await expect(page.locator('.context-chip')).toHaveCount(0);await expect(page.locator('.selection-bar')).toHaveCount(0);
 let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/papers/one/chat',async route=>{await gate;await route.fallback()});
 await page.getByLabel('向 Agent 提问').fill('New topic');await page.getByRole('button',{name:'发送',exact:true}).click();await expect(page.getByLabel('对话记录')).toBeDisabled();await expect(page.getByRole('button',{name:'新建对话',exact:true})).toBeDisabled();release();
 await expect(page.locator('.conversation')).toContainText('Independent reply');await expect(page.getByLabel('对话记录')).toBeEnabled();expect(JSON.parse(calls.find(c=>c.path.endsWith('/chat')).body)).toMatchObject({conversation_id:'conv-1',selection:null,message:'New topic'});await expect(page.getByLabel('对话记录').locator('option:checked')).toHaveText('New topic');
 await page.getByLabel('对话记录').selectOption('default');await expect(page.getByRole('button',{name:'[p.6]',exact:true})).toBeVisible();await expect(page.locator('.conversation')).not.toContainText('Independent reply');await page.getByLabel('对话记录').selectOption('conv-1');await expect(page.locator('.conversation')).toContainText('Independent reply');await page.reload();await expect(page.getByLabel('对话记录')).toHaveValue('conv-1');await expect(page.locator('.conversation')).toContainText('Independent reply');expect(calls.some(c=>c.query==='?conversation_id=conv-1')).toBeTruthy();
 const styles=await page.locator('.continuous-reader').evaluate(el=>({padding:getComputedStyle(el).paddingRight,overflow:getComputedStyle(el).overflow,scrollbar:getComputedStyle(el).scrollbarWidth,border:getComputedStyle(document.querySelector('.reader')).borderRightWidth}));expect(styles).toEqual({padding:'8px',overflow:'auto',scrollbar:'thin',border:'1px'});console.log('Reader DOM styles:',styles);await page.screenshot({path:testInfo.outputPath('reader-conversations.png')});
});
// The blank PDF fixture has no text; insert a DOM text-layer span to exercise native selection and the real reader mouseup handler.
async function selectFixtureText(page){const first=page.locator('[data-page="1"]');await expect(first.locator('.textLayer')).toHaveCount(1);await first.evaluate(el=>{const layer=el.querySelector('.textLayer');const span=document.createElement('span');span.textContent='Selected PDF passage';span.style.cssText='left:50px;top:50px;font-size:16px';layer.append(span);const range=document.createRange();range.selectNodeContents(span);window.getSelection().removeAllRanges();window.getSelection().addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))})}

test('highlight palette persists preference and sends chosen annotation color',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();await selectFixtureText(page);await expect(page.getByRole('group',{name:'高亮颜色'}).getByRole('button')).toHaveCount(5);await page.getByRole('button',{name:'紫色',exact:true}).click();await expect(page.getByRole('button',{name:'紫色',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'高亮并保存'}).click();await expect(page.locator('.selection-bar')).toHaveCount(0);expect(JSON.parse(calls.find(c=>c.path.endsWith('/annotations')&&c.method==='POST').body)).toMatchObject({color:'#bda0ed',text:'Selected PDF passage'});
 await page.reload();await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();await selectFixtureText(page);await expect(page.getByRole('button',{name:'紫色',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'高亮并保存'}).click();await expect.poll(()=>calls.filter(c=>c.path.endsWith('/annotations')&&c.method==='POST').length).toBe(2);expect(JSON.parse(calls.filter(c=>c.path.endsWith('/annotations')&&c.method==='POST')[1].body).color).toBe('#bda0ed');
});

test('conversation organizer supports naming, search, archive fallback and delete protection',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();await page.getByRole('button',{name:'新建对话',exact:true}).click();await expect(page.getByLabel('对话记录')).toHaveValue('conv-1');
 await expect(page.locator('.conversation-organizer')).toHaveCount(0);await page.getByRole('button',{name:'管理对话',exact:true}).click();
 await page.getByRole('button',{name:'重命名 新对话'}).click();await page.getByLabel('对话名称').fill('Methods discussion');await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.conversation-title').filter({hasText:'Methods discussion'})).toBeVisible();await expect(page.getByLabel('对话记录')).toContainText('Methods discussion');
 await page.getByLabel('搜索对话').fill('methods');await expect(page.locator('.conversation-title').filter({hasText:'Methods discussion'})).toBeVisible();await expect(page.getByRole('button',{name:'默认对话'})).toHaveCount(0);await page.getByLabel('搜索对话').fill('absent');await expect(page.locator('.conversation-group').filter({hasText:'进行中的对话'})).toContainText('没有匹配的对话');await page.getByLabel('搜索对话').fill('');
 await page.getByRole('button',{name:'自动命名 Methods discussion'}).click();await expect(page.locator('.conversation-title').filter({hasText:'Suggested Methods discussion'})).toBeVisible();expect(calls.some(c=>c.path.endsWith('/suggest-title')&&c.method==='POST')).toBeTruthy();
 await page.getByRole('button',{name:'归档 Suggested Methods discussion'}).click();await expect(page.getByLabel('对话记录')).toHaveValue('default');await expect(page.getByRole('button',{name:'取消归档 Suggested Methods discussion'})).toBeVisible();await expect(calls.some(c=>c.method==='PATCH'&&JSON.parse(c.body).archived===true)).toBeTruthy();
 await page.getByRole('button',{name:'取消归档 Suggested Methods discussion'}).click();await expect(page.getByRole('button',{name:'归档 Suggested Methods discussion'})).toBeVisible();await page.locator('.conversation-title').filter({hasText:'Suggested Methods discussion'}).click();await expect(page.getByLabel('对话记录')).toHaveValue('conv-1');
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'删除 Suggested Methods discussion'}).click();await expect(page.locator('.conversation-title').filter({hasText:'Suggested Methods discussion'})).toHaveCount(0);await expect(page.getByLabel('对话记录')).toHaveValue('default');expect(calls.some(c=>c.method==='DELETE'&&c.path.endsWith('/conv-1'))).toBeTruthy();
 await expect(page.getByRole('button',{name:/归档 默认对话/})).toHaveCount(0);await expect(page.getByRole('button',{name:/删除 默认对话/})).toHaveCount(0);
});

test('late conversation history never replaces the active conversation',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();await page.getByRole('button',{name:'新建对话',exact:true}).click();await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();let release;const gate=new Promise(resolve=>release=resolve);let requested=false;await page.route('**/api/papers/one/messages?conversation_id=default',async route=>{requested=true;await gate;await route.fulfill({json:[{role:'assistant',content:'Stale history'}]})});await page.getByLabel('对话记录').selectOption('default');await expect.poll(()=>requested).toBe(true);await page.getByLabel('对话记录').selectOption('conv-1');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();release();await expect(page.locator('.conversation')).not.toContainText('Stale history');await expect(page.getByLabel('对话记录')).toHaveValue('conv-1');
});

test('initial URL imports once, explicit link form and saved settings test',async({page})=>{
 const calls=await setup(page);await page.goto('/?url=https%3A%2F%2Fexample.com%2Fpaper.pdf');await expect(page.locator('.reader-header')).toContainText('Linked paper');
 expect(calls.filter(c=>c.path==='/api/papers/import')).toHaveLength(1);expect(JSON.parse(calls.find(c=>c.path==='/api/papers/import').body)).toEqual({url:'https://example.com/paper.pdf',project_id:'default'});
 await expect(page).not.toHaveURL(/url=/);await page.reload();await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();expect(calls.filter(c=>c.path==='/api/papers/import')).toHaveLength(1);
 await page.getByRole('button',{name:'导入',exact:true}).click();await page.getByRole('button',{name:/从链接打开/}).click();await page.getByLabel('论文链接').fill('https://example.com/other.pdf');await page.getByRole('button',{name:'导入并打开',exact:true}).click();await expect(page.getByRole('heading',{name:'从链接打开'})).toHaveCount(0);
 await page.getByRole('button',{name:'设置与浏览器收藏'}).click();await expect(page.locator('.modal')).toContainText('API Key · 已保存');await expect(page.locator('.modal')).not.toContainText('已验证');await expect(page.getByLabel('研究背景')).toHaveValue('自动驾驶研究者');
 await page.getByRole('button',{name:'测试连接',exact:true}).click();await expect(page.getByRole('status')).toContainText('已验证');const call=calls.find(c=>c.path==='/api/settings/test');expect(call.method).toBe('POST');expect(call.body).toBeNull();
});
test('document details available during PDF loading, all fields, focus and clipboard',async({page})=>{
 await setup(page);await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{window.copiedPath=value}},configurable:true}));
 let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/papers/one/pdf',async route=>{await gate;await route.fallback()});await page.goto('/');
 const button=page.getByRole('button',{name:'文档详情',exact:true});await expect(button).toBeEnabled();await expect(page.getByRole('heading',{name:'正在加载论文…'})).toBeVisible();await button.click();
 const modal=page.getByRole('dialog',{name:'文档详情'});await expect(modal).toBeVisible();await expect(modal.getByRole('button',{name:'关闭文档详情'})).toBeFocused();
 for(const value of ['First paper','Original.PDF','12','1.5 KiB（1536 字节）','默认项目','one','/custom/storage/one/paper.pdf','/custom/storage/one'])await expect(modal.locator('dd').filter({hasText:value}).first()).toBeVisible();
 const localDate=await page.evaluate(()=>new Date('2026-01-01T12:34:56Z').toLocaleString());await expect(modal.locator('time')).toHaveText(localDate);
 await expect(modal.getByRole('link',{name:'https://example.org/original.pdf'})).toHaveAttribute('href','https://example.org/original.pdf');await expect(modal.getByRole('link',{name:'打开原始 PDF ↗'})).toHaveAttribute('href','/api/papers/one/pdf');
 await modal.getByRole('button',{name:'复制 PDF 路径',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('路径已复制');expect(await page.evaluate(()=>window.copiedPath)).toBe('/custom/storage/one/paper.pdf');
 await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(button).toBeFocused();release();
});

test('details local uploads, clipboard failure and long path wrapping',async({page})=>{
 await setup(page);await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw Error('denied')}},configurable:true}));await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();
 await page.locator('input[type=file]').first().setInputFiles({name:'local.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await expect(page.locator('.reader-header')).toContainText('Uploaded paper');
 const longPath='/custom/'+ '长目录'.repeat(180)+'/paper.pdf';await page.route('**/api/papers/uploaded/details',route=>route.fulfill({json:{id:'uploaded',title:'Uploaded paper',filename:'local.pdf',size:1536,page_count:12,created_at:'2026-01-01T00:00:00Z',project_name:'默认项目',source_url:null,pdf_path:longPath,metadata_dir:longPath.slice(0,-10)}}));
 await page.getByRole('button',{name:'文档详情',exact:true}).click();const modal=page.getByRole('dialog',{name:'文档详情'});await expect(modal).toContainText('本地文件导入');await expect(modal.locator('dd a')).toHaveCount(0);await modal.getByRole('button',{name:'复制 PDF 路径',exact:true}).click();await expect(modal.getByRole('status')).toContainText('手动复制');await expect(modal.locator('code').first()).toHaveText(longPath);
 expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await page.setViewportSize({width:390,height:844});expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth&&el.getBoundingClientRect().right<=innerWidth)).toBe(true);
 await modal.getByRole('button',{name:'关闭文档详情'}).click();await expect(modal).toHaveCount(0);
});

test('details ignore closed late requests and clear on paper and project switches',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();let release,requested=false;const gate=new Promise(resolve=>release=resolve);
 await page.route('**/api/papers/one/details',async route=>{requested=true;await gate;await route.fulfill({json:{title:'Stale details',id:'one',pdf_path:'/stale'}})});
 await page.getByRole('button',{name:'文档详情',exact:true}).click();await expect.poll(()=>requested).toBe(true);await page.keyboard.press('Escape');
 await page.locator('input[type=file]').first().setInputFiles({name:'local.pdf',mimeType:'application/pdf',buffer:pdfFixture()});await expect(page.locator('.reader-header')).toContainText('Uploaded paper');await page.getByRole('button',{name:'文档详情',exact:true}).click();const modal=page.getByRole('dialog',{name:'文档详情'});await expect(modal).toContainText('本地文件导入');release();await expect(modal).not.toContainText('Stale details');await page.keyboard.press('Escape');
 await page.locator('.paper-item').filter({hasText:'First paper'}).click();await page.getByRole('button',{name:'文档详情',exact:true}).click();await expect(modal).not.toContainText('Uploaded paper');await page.keyboard.press('Escape');await page.getByLabel('项目',{exact:true}).selectOption('second');await expect(modal).toHaveCount(0);await expect(page.getByRole('button',{name:'文档详情',exact:true})).toHaveCount(0);
});

test('details source links reject unsafe schemes and URL credentials',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByRole('button',{name:'文档详情',exact:true})).toBeVisible();
 for(const source_url of ['javascript:alert(1)','file:///tmp/private.pdf','https://user:password@example.org/a.pdf']){
  await page.route('**/api/papers/one/details',route=>route.fulfill({json:{id:'one',title:'First paper',source_url,pdf_path:'/local/paper.pdf',metadata_dir:'/local'}}));await page.getByRole('button',{name:'文档详情',exact:true}).click();const modal=page.getByRole('dialog',{name:'文档详情'});await expect(modal).toContainText('来源链接不可用');await expect(modal.locator('dd a')).toHaveCount(0);await expect(modal).not.toContainText(source_url);await page.keyboard.press('Escape');
 }
});

test('Cmd/Ctrl+B collapses and restores the library sidebar with persistence',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();
 const library=page.locator('.library');const tracks=()=>page.locator('.app').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
 await expect(library).toBeVisible();expect(await tracks()).toBe(3);
 await expect(library).toHaveCSS('display','flex');await expect(library).toHaveCSS('flex-direction','column');await expect(page.locator('.paper-list')).toHaveCSS('overflow-y','auto');await expect(page.locator('.brand')).toHaveCSS('display','flex');
 await page.keyboard.press('ControlOrMeta+b');await expect(library).toBeHidden();await expect(page.getByRole('button',{name:'展开论文库'})).toBeVisible();expect(await tracks()).toBe(2);
 expect(await page.evaluate(()=>localStorage.getItem('library-hidden'))).toBe('1');
 await page.reload();await expect(library).toBeHidden();await expect(page.getByRole('button',{name:'展开论文库'})).toBeVisible();
 await page.keyboard.press('ControlOrMeta+b');await expect(library).toBeVisible();
 await page.getByRole('button',{name:'设置与浏览器收藏'}).click();await expect(page.locator('.modal')).toBeVisible();
 await page.keyboard.press('ControlOrMeta+b');await expect(library).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.modal')).toHaveCount(0);
 await page.getByRole('button',{name:'收起论文库'}).click();await expect(library).toBeHidden();await page.keyboard.press('ControlOrMeta+b');await expect(library).toBeVisible();expect(await tracks()).toBe(3);
});

test('assistant replies expand horizontally and vertically with Cmd/Ctrl+J',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();
 const app=page.locator('.app'),reply=page.locator('.conversation');
 const before=await reply.boundingBox();const tracks=await app.evaluate(el=>getComputedStyle(el).gridTemplateColumns);const reader=await page.locator('main.reader').boundingBox();
 await page.keyboard.press('ControlOrMeta+j');await expect(app).toHaveClass(/assistant-maximized/);
 await expect.poll(async()=> (await reply.boundingBox()).height).toBeGreaterThan(before.height+20);
 expect(await app.evaluate(el=>getComputedStyle(el).gridTemplateColumns)).toBe(tracks);expect(await page.locator('main.reader').boundingBox()).toEqual(reader);
 await expect.poll(async()=> (await reply.boundingBox()).width).toBeGreaterThan(before.width+200);
 await expect(page.locator('.conversation-picker')).toBeVisible();await expect(page.locator('.composer')).toBeVisible();
 await page.getByLabel('向 Agent 提问').press('ControlOrMeta+j');await expect(app).not.toHaveClass(/assistant-maximized/);
 await page.getByRole('button',{name:'放大回复区',exact:true}).click();await expect(page.getByRole('button',{name:'还原回复区',exact:true})).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'收起放大面板',exact:true}).click();await expect(app).not.toHaveClass(/assistant-maximized/);
});

test('Escape dismisses the selection bar and defers to open dialogs',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();
 await selectFixtureText(page);await expect(page.locator('.selection-bar')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.selection-bar')).toHaveCount(0);
 await selectFixtureText(page);await expect(page.locator('.selection-bar')).toBeVisible();
 await page.getByRole('button',{name:'文档详情',exact:true}).click();const modal=page.getByRole('dialog',{name:'文档详情'});await expect(modal).toBeVisible();
 await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(page.locator('.selection-bar')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.selection-bar')).toHaveCount(0);
});

test('selection quick actions send a structured action with the passage',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();await selectFixtureText(page);
 await page.locator('.selection-bar').getByRole('button',{name:'推导',exact:true}).click();await expect(page.locator('.conversation')).toContainText('Independent reply');
 expect(JSON.parse(calls.find(c=>c.path.endsWith('/chat')).body)).toMatchObject({action:'derive',message:'推导这里的公式',selection:{text:'Selected PDF passage',page:1}});
 await expect(page.locator('.selection-bar')).toHaveCount(0);await expect(page.locator('.message.user').last()).toContainText('推导');await expect(page.locator('.message.user').last()).toContainText('Selected PDF passage');
});

test('translate uses the direct endpoint and only sends the passage',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.getByLabel('向 Agent 提问')).toBeEnabled();await selectFixtureText(page);
 await page.locator('.selection-bar').getByRole('button',{name:'翻译',exact:true}).click();await expect(page.locator('.conversation')).toContainText('快速译文');
 const sent=calls.find(c=>c.path.endsWith('/translate'));expect(JSON.parse(sent.body)).toEqual({selection:{text:'Selected PDF passage',page:1,rects:expect.any(Array)},conversation_id:'default'});
 expect(calls.some(c=>c.path.endsWith('/chat'))).toBe(false);
});

test('paragraph citations jump to the cited block and flash it',async({page})=>{
 await setup(page);await page.route('**/api/papers/one/messages*',route=>route.fulfill({json:[{role:'assistant',content:'Key claim [p.2#1] and `[p.9]` stays code.'}]}));
 await page.goto('/');const cite=page.getByRole('button',{name:'[p.2#1]',exact:true});await expect(cite).toHaveAttribute('title',/Cited paragraph text/);await expect(page.locator('.message code')).toHaveText('[p.9]');
 await cite.click();await expect(page.getByLabel('页码')).toHaveValue('2');const flash=page.locator('[data-page="2"] .mark.flash');await expect(flash).toBeVisible();
 const [box,pageBox]=await Promise.all([flash.boundingBox(),page.locator('[data-page="2"]').boundingBox()]);expect(Math.abs((box.y-pageBox.y)/pageBox.height-0.3)).toBeLessThan(0.02);
 await expect(flash).toHaveCount(0,{timeout:5000});
});

test('cross-page paragraph citation flashes only the destination page',async({page})=>{
 await setup(page);await page.route('**/api/papers/one/messages*',route=>route.fulfill({json:[{role:'assistant',content:'Cross-page claim [p.3#1].'}]}));
 await page.goto('/');const cite=page.getByRole('button',{name:'[p.3#1]',exact:true});await expect(cite).toHaveAttribute('title',/Another cited paragraph/);
 await cite.click();await expect(page.getByLabel('页码')).toHaveValue('3');await expect(page.locator('[data-page="3"] .mark.flash')).toBeVisible();
});

test('guide tab shows the free local brief and generates only on request',async({page})=>{
 await setup(page);
 let posts=0;
 await page.route('**/api/papers/one/card',async route=>{
  if(route.request().method()==='POST'){posts++;return route.fulfill({json:{status:'running',content:'',brief:'',brief_kind:''}})}
  return route.fulfill({json:{status:'missing',content:'',brief:'Residual networks learn a residual mapping.',brief_kind:'abstract'}});
 });
 await page.goto('/');await page.getByRole('navigation',{name:'助手面板'}).getByRole('button',{name:'导读'}).click();
 await expect(page.locator('.card-brief')).toContainText('Residual networks learn a residual mapping.');
 await expect(page.locator('.card-brief')).toContainText('不产生费用');
 expect(posts).toBe(0);
 await page.getByRole('button',{name:'生成深度导读',exact:true}).click();
 await expect.poll(()=>posts).toBe(1);
});

test('import menu explains pdf, folder and link import',async({page})=>{
 await setup(page);await page.goto('/');await expect(page.getByLabel('PDF 连续阅读')).toBeVisible();
 await page.getByRole('button',{name:'导入',exact:true}).click();
 const panel=page.locator('#import-panel');
 await expect(panel.getByRole('button',{name:/选择 PDF/})).toBeVisible();
 await expect(panel.getByRole('button',{name:/导入文件夹/})).toContainText('含子文件夹');
 await expect(panel).toContainText('不会自动生成收费导读');
 await page.keyboard.press('Escape');await expect(panel).toHaveCount(0);
});

test('reading card tab renders the guide and settings save reader and project memory',async({page})=>{
 const calls=await setup(page);await page.goto('/');await expect(page.locator('[data-page="1"] canvas')).toBeVisible();await page.getByRole('navigation',{name:'助手面板'}).getByRole('button',{name:'导读'}).click();await expect(page.locator('.paper-card')).toContainText('核心想法见');
 await page.locator('.paper-card').getByRole('button',{name:'[p.3]',exact:true}).click();await expect(page.getByLabel('页码')).toHaveValue('3');expect(calls.some(c=>c.path.endsWith('/card')&&c.method==='POST')).toBeFalsy();
 await page.getByRole('button',{name:'设置与浏览器收藏'}).click();await page.getByLabel('研究背景').fill('做 VLA 数据筛选');await page.getByRole('button',{name:'保存配置',exact:true}).click();
 await expect.poll(()=>calls.find(c=>c.path==='/api/profile'&&c.method==='PUT')?.body).toContain('做 VLA 数据筛选');
  await page.getByRole('button',{name:'添加记忆'}).click();
  await page.getByLabel('项目记忆文本 1').fill('本项目关注自动驾驶规划');
  await page.getByRole('button',{name:'添加记忆'}).click();
  await page.getByLabel('项目记忆文本 2').fill('临时记忆');
  await page.getByRole('button',{name:'删除项目记忆 2'}).click();
 await page.getByRole('button',{name:'保存项目记忆'}).click();
 await expect(page.getByRole('status')).toContainText('项目记忆已保存');
 expect(calls.some(c=>c.path==='/api/projects/default/memory'&&c.method==='PUT'&&c.body.includes('自动驾驶规划'))).toBeTruthy();
});


test('appearance toggle cycles themes and persists',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await setup(page);await page.goto('/');const html=page.locator('html'),toggle=page.getByRole('button',{name:'切换外观'});
 await expect(html).toHaveAttribute('data-theme','light');await expect(toggle).toHaveAttribute('title','外观：跟随系统');
 await toggle.click();await expect(toggle).toHaveAttribute('title','外观：浅色');await toggle.click();await expect(html).toHaveAttribute('data-theme','dark');
 await page.reload();await expect(html).toHaveAttribute('data-theme','dark');
});
