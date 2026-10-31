// Accept the LaTeX delimiters returned by LLMs, without altering code examples.
export function normalizeMath(text='') {
 return text.split(/(```[^\n]*\n[\s\S]*?(?:```|$)|~~~[^\n]*\n[\s\S]*?(?:~~~|$)|`+[^`\n]*`+)/g).map((part,i)=>{
  if(i%2)return part;
  return part.replace(/\\\[([\s\S]*?)\\\]/g,(_,body)=>'\n\n$$\n'+body.trim()+'\n$$\n\n')
   .replace(/\\\(([^\n]*?)\\\)/g,(_,body)=>'$'+body.trim()+'$');
 }).join('');
}
