// Full-text search over PDF.js text content. Matches are case-insensitive and
// whitespace-insensitive; rectangles are normalized to the page (0–1).

export function indexPage(items) {
  let text='';const map=[];let space=true;
  items.forEach((item,index)=>{
    const value=(item.str||'')+(item.hasEOL?' ':'');
    for(let offset=0;offset<value.length;offset++) {
      const char=value[offset];
      if(/\s/.test(char)) {
        if(space)continue;
        space=true;text+=' ';
      } else {
        space=false;text+=char.toLowerCase();
      }
      map.push({index,offset:Math.min(offset,(item.str||'').length)});
    }
  });
  return {text,map};
}

export function normalizeQuery(query) {
  return query.trim().replace(/\s+/g,' ').toLowerCase();
}

// `measure(item, text)` returns the rendered width of a prefix in any unit;
// without it characters are assumed to be equally wide.
export function findInPage(index,query,items,viewport,measure=(item,text)=>text.length) {
  const needle=normalizeQuery(query);
  if(!needle)return [];
  const matches=[];
  for(let start=index.text.indexOf(needle);start>=0;start=index.text.indexOf(needle,start+needle.length)) {
    const spans=new Map();
    for(let i=start;i<start+needle.length;i++) {
      const {index:item,offset}=index.map[i];
      const span=spans.get(item)||{from:offset,to:offset+1};
      span.from=Math.min(span.from,offset);span.to=Math.max(span.to,offset+1);
      spans.set(item,span);
    }
    matches.push([...spans].map(([item,span])=>itemRect(items[item],span,viewport,measure)).filter(Boolean));
  }
  return matches;
}

function itemRect(item,{from,to},viewport,measure) {
  const str=item.str||'';
  const total=measure(item,str);
  if(!str.length||!item.width||!total)return null;
  const [, , , , x, y]=item.transform;
  const height=item.height||Math.hypot(item.transform[2],item.transform[3]);
  const x0=x+item.width*measure(item,str.slice(0,from))/total,x1=x+item.width*measure(item,str.slice(0,Math.min(to,str.length)))/total;
  const [a,b,c,d]=viewport.convertToViewportRectangle([x0,y-height*0.2,x1,y+height*0.9]);
  const left=Math.min(a,c),top=Math.min(b,d);
  return {x:left/viewport.width,y:top/viewport.height,width:Math.abs(c-a)/viewport.width,height:Math.abs(d-b)/viewport.height};
}
