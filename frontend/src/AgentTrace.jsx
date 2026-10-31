import React from 'react';
import {ChevronRight} from 'lucide-react';

export default function AgentTrace({items=[]}) {
 if(!items.length)return null;
 const calls=items.filter(x=>x.kind==='tool');
 const images=calls.filter(x=>x.name==='read_image').length;
 return <details className="agent-trace"><summary><ChevronRight className="trace-chevron" size={13}/>执行记录 · {calls.length} 次调用{images?` · 看了 ${images} 张图`:''}</summary><p className="trace-hint">仅展示接口公开返回的推理文本和实际工具事件；推理在每个模型步骤结束后出现。</p><ol>{items.map((item,i)=>{
 const result=item.kind==='tool'?items.find(x=>x.kind==='tool_result'&&x.call_id===item.call_id):null;
 const label=item.kind==='reasoning'?'模型推理':item.kind==='tool'?'调用 '+item.name:'工具结果';
 const status=result?.status||item.status;
 return <li key={item.id||i}><details><summary><span>{label}</span><small className={status==='error'?'failed':''}>{status==='error'?'失败':status==='running'?'已发起': '已完成'}</small></summary>{item.call_id&&<div className="trace-id">调用 ID：{item.call_id}</div>}<pre>{item.content}</pre></details></li>;
 })}</ol></details>;
}
