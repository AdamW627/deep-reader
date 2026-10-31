import React, {useEffect, useRef, useState} from 'react';
import {ChevronDown, ChevronUp, X} from 'lucide-react';
import {findInPage, indexPage, normalizeQuery} from './search';

let context = null;
// Same font family the PDF.js text layer uses, so highlights line up with selectable text.
function measurer(styles) {
  context ||= document.createElement('canvas').getContext('2d');
  return (item, text) => {
    if (!context) return text.length;
    context.font = `100px ${styles?.[item.fontName]?.fontFamily || 'sans-serif'}`;
    return context.measureText(text).width;
  };
}

export default function PdfSearch({doc, onMarks, onNavigate, onClose}) {
  const input = useRef(null), cache = useRef(new Map());
  const [query, setQuery] = useState(''), [matches, setMatches] = useState([]), [active, setActive] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => () => onMarks([]), [onMarks]);
  useEffect(() => {
    const needle = normalizeQuery(query);
    if (!needle) { setMatches([]); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    const timer = setTimeout(async () => {
      const found = [];
      for (let number = 1; number <= doc.numPages && alive; number++) {
        let entry = cache.current.get(number);
        if (!entry) {
          const page = await doc.getPage(number);
          const {items, styles} = await page.getTextContent();
          entry = {items, styles, index: indexPage(items), viewport: page.getViewport({scale: 1})};
          cache.current.set(number, entry);
        }
        for (const rects of findInPage(entry.index, needle, entry.items, entry.viewport, measurer(entry.styles))) found.push({page: number, rects});
        if (number % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!alive) return;
      setMatches(found); setActive(0); setBusy(false);
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [doc, query]);
  useEffect(() => {
    onMarks(matches.map((m, i) => ({...m, kind: i === active ? 'search-active' : 'search'})));
    const current = matches[active];
    if (current?.rects.length) onNavigate(current.page, current.rects[0].y);
  }, [matches, active, onMarks, onNavigate]);
  function step(delta) {
    if (matches.length) setActive(value => (value + delta + matches.length) % matches.length);
  }
  return <div className="pdf-search" role="search" aria-label="在论文中搜索">
    <input ref={input} aria-label="搜索论文全文" placeholder="在论文中搜索…" value={query} onChange={e => setQuery(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
      }}/>
    <span className="pdf-search-count" aria-live="polite">{busy ? '搜索中…' : query.trim() ? (matches.length ? `${active + 1} / ${matches.length}` : '无结果') : ''}</span>
    <button type="button" className="icon-button" aria-label="上一个结果" disabled={!matches.length} onClick={() => step(-1)}><ChevronUp size={16}/></button>
    <button type="button" className="icon-button" aria-label="下一个结果" disabled={!matches.length} onClick={() => step(1)}><ChevronDown size={16}/></button>
    <button type="button" className="icon-button" aria-label="关闭搜索" onClick={onClose}><X size={16}/></button>
  </div>;
}
