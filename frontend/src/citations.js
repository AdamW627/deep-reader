// Agent answers cite `[p.N]` (page) or `[p.N#K]` (paragraph block K on page N).
const CITATION = /\[p\.(\d+)(?:#(\d+))?(?:\s*[–-]\s*(\d+))?\]/g;
const CODE = /(```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)|`+[^`\n]*`+)/g;

export function linkCitations(text='') {
  return text.split(CODE).map((part,i)=>i%2?part:part.replace(CITATION,(_,page,block,end)=>{
    const label=`p.${page}${block?'#'+block:''}${end?'–'+end:''}`;
    return `[${label}](#cite/${page}/${block||''})`;
  })).join('');
}

export function parseCitation(href='') {
  const match=href.match(/^#cite\/(\d+)\/(\d*)$/);
  return match && Number(match[1]) > 0?{page:Number(match[1]),block:match[2]?Number(match[2]):null}:null;
}
