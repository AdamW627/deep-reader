import React, {useLayoutEffect, useRef, useState} from 'react';
import {ArrowRightLeft, ChartColumn, Highlighter, Languages, Lightbulb, MessageSquarePlus, Scale, Sigma, X} from 'lucide-react';

export const ACTIONS = [
  {id: 'explain', label: '解释', message: '解释这段', icon: Lightbulb},
  {id: 'derive', label: '推导', message: '推导这里的公式', icon: Sigma},
  {id: 'figure', label: '图表', message: '讲解这张图表', icon: ChartColumn},
  {id: 'critique', label: '审稿', message: '从审稿人视角看这段', icon: Scale},
  {id: 'transfer', label: '迁移', message: '这能迁移到我的场景吗', icon: ArrowRightLeft},
  {id: 'translate', label: '翻译', message: '翻译这段', icon: Languages},
];

export default function SelectionPopover({selection, anchor, note, onNote, palette, onAnnotate, onAction, onAsk, onClose, disabled}) {
  const box = useRef(null);
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    const el = box.current, reader = el?.parentElement?.getBoundingClientRect();
    if (!el || !reader) return;
    const {width, height} = el.getBoundingClientRect();
    const gap = 10;
    let top = anchor ? anchor.bottom + gap : reader.bottom - height - 20;
    if (anchor && top + height > reader.bottom - 8) top = Math.max(reader.top + 64, anchor.top - height - gap);
    const center = anchor ? anchor.x : reader.left + reader.width / 2;
    const left = Math.min(Math.max(center - width / 2, reader.left + 12), reader.right - width - 12);
    setPosition({top: top - reader.top, left: left - reader.left});
  }, [anchor, selection]);
  return <div ref={box} className="selection-bar" role="dialog" aria-label="选中文字操作" style={position ? {top: position.top, left: position.left} : {visibility: 'hidden'}}>
    <div className="selection-head">
      <span>第 {selection.page} 页 · {selection.text.trim().slice(0, 60)}{selection.text.trim().length > 60 ? '…' : ''}</span>
      <button type="button" className="icon-button" aria-label="清除选区" onClick={onClose}><X size={14}/></button>
    </div>
    <div className="selection-actions">
      {ACTIONS.map(({id, label, icon: Icon}) => <button type="button" key={id} disabled={disabled} onClick={() => onAction(id)}><Icon size={14}/>{label}</button>)}
      <button type="button" className="ask" disabled={disabled} onClick={onAsk}><MessageSquarePlus size={14}/>提问</button>
    </div>
    <div className="selection-annotate">
      {palette}
      <input aria-label="批注备注" placeholder="添加备注（可选）" value={note} onChange={e => onNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') onAnnotate(); }}/>
      <button type="button" aria-label="高亮并保存" title="高亮并保存" onClick={onAnnotate}><Highlighter size={14}/>高亮</button>
    </div>
  </div>;
}
