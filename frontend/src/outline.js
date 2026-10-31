// PDF destinations may be named, explicit page references, or zero-based indexes.
export async function destinationPage(doc, destination) {
  try {
    const dest=typeof destination==='string'?await doc.getDestination(destination):destination;
    if(!Array.isArray(dest)||!dest.length)return null;
    const index=Number.isInteger(dest[0])?dest[0]:await doc.getPageIndex(dest[0]);
    return Number.isInteger(index)&&index>=0&&index<doc.numPages?index+1:null;
  } catch {return null;}
}
export async function readBookmarks(doc, items, cancelled=()=>false, prefix='') {
  const result=[];
  for(const [index,item] of (items||[]).entries()) {
    if(cancelled())return [];
    const id=prefix+index;
    result.push({id,title:String(item.title||'未命名书签').replace(/\s+/g,' ').trim(),page:await destinationPage(doc,item.dest),children:await readBookmarks(doc,item.items,cancelled,id+'.')});
  }
  return result;
}

// Conservative fallback: only real, short, numbered headings or conventional
// standalone section names. Never manufacture a TOC from page numbers.
export function headingCandidates(items, page) {
  const lines=[];
  for(const item of items) {
    if(typeof item.str!=='string'||!item.str.trim())continue;
    const y=item.transform?.[5];
    const previous=lines.at(-1);
    if(previous&&Number.isFinite(y)&&Math.abs(previous.y-y)<2)previous.text+=' '+item.str;
    else lines.push({text:item.str,y});
  }
  return lines.flatMap(({text},index)=>{
    const title=text.replace(/\s+/g,' ').trim();
    if(title.length<3||title.length>120||/[.!?。；;]$/.test(title))return [];
    const numbered=title.match(/^(\d{1,2}(?:\.\d{1,2}){0,3})\.?\s+([A-Za-z\u3400-\u9fff].*)$/);
    const conventional=/^(abstract|introduction|background|related work|methods?|methodology|experiments?|results|discussion|conclusions?|references|acknowledg(?:e)?ments|摘要|引言|结论|参考文献)$/i.test(title);
    if(!numbered&&!conventional)return [];
    // Reject numbered prose; extraction is deliberately incomplete, not authoritative.
    if(numbered&&(Number(numbered[1].split('.')[0])===0||!/^([A-Z\u3400-\u9fff])/.test(numbered[2])||/(?:\s\d+(?:\.\d+)?){2,}/.test(numbered[2])||numbered[2].split(/\s+/).length>12))return [];
    if(conventional&&!/^[A-Z\u3400-\u9fff]/.test(title))return [];
    return [{id:`text-${page}-${index}`,title,page,level:numbered?numbered[1].split('.').length:1,children:[]}];
  });
}
export function nestHeadings(headings) {
  const root=[],stack=[];
  for(const heading of headings) {
    while(stack.length&&stack.at(-1).level>=heading.level)stack.pop();
    (stack.at(-1)?.children||root).push(heading);stack.push(heading);
  }
  return root;
}
export function flattenOutline(items) {return items.flatMap(item=>[item,...flattenOutline(item.children)]);}
export function activeSection(items,page) {
  let active=null;
  for(const item of flattenOutline(items))if(item.page&&item.page<=page&&(!active||item.page>=active.page))active=item;
  return active?.id;
}
