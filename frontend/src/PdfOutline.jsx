import React,{useEffect,useRef,useState} from 'react';
import {activeSection,headingCandidates,nestHeadings,readBookmarks} from './outline';

export default function PdfOutline({doc,page,onNavigate,onClose}) {
  const [items,setItems]=useState([]),[status,setStatus]=useState('loading'),[query,setQuery]=useState(''),[collapsed,setCollapsed]=useState(new Set());
  const search=useRef();
  useEffect(()=>{search.current?.focus()},[]);
  useEffect(()=>{
    let alive=true;setItems([]);setStatus('loading');
    (async()=>{
      let outline;
      try {outline=await doc.getOutline()}catch {/* Text extraction may still work. */}
      if(!alive)return;
      if(outline?.length) {
        const tree=await readBookmarks(doc,outline,()=>!alive);
        if(alive){setItems(tree);setStatus('bookmarks')}
        return;
      }
      setStatus('extracting');const headings=[];let failed=false;
      for(let number=1;number<=doc.numPages;number++) {
        if(!alive)return;
        try {
          const pdfPage=await doc.getPage(number);
          if(!alive)return;
          const text=await pdfPage.getTextContent();
          headings.push(...headingCandidates(text.items,number));
        } catch {failed=true}
        // Yield between pages so long papers never monopolize the main thread.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(alive){setItems(nestHeadings(headings));setStatus(failed?'partial':'candidates')}
    })().catch(()=>{if(alive)setStatus('error')});
    return()=>{alive=false};
  },[doc]);
  const current=activeSection(items,page),needle=query.trim().toLowerCase();
  function matches(item){return item.title.toLowerCase().includes(needle)||item.children.some(matches)}
  function toggle(id){setCollapsed(old=>{const next=new Set(old);next.has(id)?next.delete(id):next.add(id);return next})}
  function tree(nodes){return <ul>{nodes.filter(item=>!needle||matches(item)).map(item=><li key={item.id}>
    <div className="toc-row">
      {item.children.length>0?<button className="toc-disclosure" aria-label={`${collapsed.has(item.id)?'展开':'折叠'} ${item.title}`} aria-expanded={!!needle||!collapsed.has(item.id)} onClick={()=>toggle(item.id)}>{!needle&&collapsed.has(item.id)?'▸':'▾'}</button>:<span className="toc-spacer"/>}
      <button className="toc-entry" title={item.title} disabled={!item.page} aria-label={`${item.title} · ${item.page?'第 '+item.page+' 页':'无法定位'}`} aria-current={current===item.id?'location':undefined} onClick={()=>onNavigate(item.page)}><span>{item.title}</span><small>{item.page||'—'}</small></button>
    </div>
    {item.children.length>0&&(needle||!collapsed.has(item.id))&&tree(item.children)}
  </li>)}</ul>}
  return <nav id="pdf-outline" className="pdf-outline" aria-label="论文目录" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose()}}}>
    <div className="toc-heading"><strong>论文目录</strong><button aria-label="关闭目录" onClick={onClose}>×</button></div>
    <p className="toc-source">{status==='bookmarks'?'PDF 书签':status==='loading'?'正在读取 PDF 书签…':status==='extracting'?'正在从正文提取标题…':'候选目录 · 自动提取'}</p>
    {!['bookmarks','loading','extracting'].includes(status)&&<p className="toc-note">文档无可用书签；根据 PDF 文本自动提取，可能遗漏或误识别。</p>}
    <input ref={search} aria-label="搜索目录" placeholder="搜索章节…" value={query} onChange={e=>setQuery(e.target.value)}/>
    <div className="toc-tree" aria-busy={['loading','extracting'].includes(status)}>
      {tree(items)}
      {items.length>0&&!items.some(matches)&&<p className="toc-empty">没有匹配的章节</p>}
      {!items.length&&!['loading','extracting'].includes(status)&&<p className="toc-empty">{status==='error'?'目录读取失败，请使用页码导航。':'未发现可靠的章节标题，可使用顶部页码导航。'}</p>}
      {status==='partial'&&<p className="toc-note">部分页面无法读取，候选目录可能不完整。</p>}
    </div>
  </nav>;
}
