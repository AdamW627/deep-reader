import React, {useEffect, useRef, useState} from 'react';
import * as pdfjs from 'pdfjs-dist';

function PdfPage({doc, number, zoom, near, dimensions, annotations, marks, onSelect}) {
  const content = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!near) return;
    let alive = true, render, textLayer;
    const el = content.current;
    el.replaceChildren();
    setError('');
    (async () => {
      try {
        const page = await doc.getPage(number);
        if (!alive) return;
        const viewport = page.getViewport({scale: zoom});
        const canvas = document.createElement('canvas');
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.ceil(viewport.width * ratio);
        canvas.height = Math.ceil(viewport.height * ratio);
        canvas.style.width = viewport.width + 'px';
        canvas.style.height = viewport.height + 'px';
        el.append(canvas);
        render = page.render({canvasContext: canvas.getContext('2d'), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0]});
        await render.promise;
        const text = await page.getTextContent();
        if (!alive) return;
        const layer = document.createElement('div');
        layer.className = 'textLayer';
        layer.style.setProperty('--scale-factor', zoom);
        el.append(layer);
        textLayer = new pdfjs.TextLayer({textContentSource: text, container: layer, viewport});
        await textLayer.render();
      } catch (e) {
        if (alive && !['RenderingCancelledException', 'AbortException'].includes(e.name)) setError(e.message);
      }
    })();
    return () => { alive = false; render?.cancel(); textLayer?.cancel(); el.replaceChildren(); };
  }, [doc, number, zoom, near]);
  function select() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim() || !content.current.contains(selection.anchorNode) || !content.current.contains(selection.focusNode)) return;
    const box = content.current.parentElement.getBoundingClientRect();
    const range = selection.getRangeAt(0), bounds = range.getBoundingClientRect();
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0).map(r => ({x: Math.max(0, (r.left - box.left) / box.width), y: Math.max(0, (r.top - box.top) / box.height), width: Math.min(1, r.width / box.width), height: Math.min(1, r.height / box.height)}));
    onSelect({text: selection.toString(), page: number, rects}, {x: bounds.left + bounds.width / 2, top: bounds.top, bottom: bounds.bottom});
  }
  const rect = r => ({left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.width * 100 + '%', height: r.height * 100 + '%'});
  return <div className="pdf-page" data-page={number} style={{width: dimensions.width * zoom, height: dimensions.height * zoom}} onMouseUp={select}>
    <div ref={content}/>
    <div className="highlights">{annotations.filter(a => a.page === number).flatMap(a => (a.rects || []).map((r, i) => <div key={a.id + ':' + i} title={a.note || a.text} className="highlight" style={{...rect(r), background: a.color}}/>))}</div>
    {marks.length > 0 && <div className="marks">{marks.flatMap((m, i) => m.rects.map((r, j) => <div key={m.kind + i + ':' + j + ':' + (m.sequence || '')} className={'mark ' + m.kind} style={rect(r)}/>))}</div>}
    {error && <div className="error">{error}</div>}<span className="page-label">{number}</span>
  </div>;
}

const NO_MARKS = [];

export default function PdfReader({doc, zoom, annotations, marks = NO_MARKS, onSelect, onPage, onScroll, navigation}) {
  const root = useRef(null);
  const [near, setNear] = useState(new Set([1, 2]));
  const [sizes, setSizes] = useState({});
  useEffect(() => {
    let alive = true;
    // Read page geometry without creating canvases; preserve mixed-size page layout.
    (async () => {
      for (let number = 1; number <= doc.numPages; number++) {
        const page = await doc.getPage(number);
        if (!alive) return;
        const viewport = page.getViewport({scale: 1});
        setSizes(previous => ({...previous, [number]: {width: viewport.width, height: viewport.height}}));
      }
    })().catch(() => {});
    return () => { alive = false; };
  }, [doc]);
  useEffect(() => {
    const container = root.current;
    const observer = new IntersectionObserver(entries => {
      setNear(previous => {
        const next = new Set(previous);
        for (const entry of entries) {
          const number = Number(entry.target.dataset.page);
          if (entry.isIntersecting) next.add(number); else next.delete(number);
        }
        return next;
      });
    }, {root: container, rootMargin: '1000px 0px'});
    container.querySelectorAll('[data-page]').forEach(el => observer.observe(el));
    let frame;
    const track = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = container.getBoundingClientRect().top + Math.min(160, container.clientHeight / 3);
        let current = 1;
        for (const el of container.querySelectorAll('[data-page]')) {
          if (el.getBoundingClientRect().top <= top) current = Number(el.dataset.page); else break;
        }
        onPage(current);
      });
    };
    const scrolled = () => { track(); onScroll?.(); };
    container.addEventListener('scroll', scrolled, {passive: true});
    track();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); container.removeEventListener('scroll', scrolled); };
  }, [doc, onPage, onScroll]);
  useEffect(() => {
    if (!navigation) return;
    const container = root.current;
    const el = container.querySelector(`[data-page="${navigation.page}"]`);
    if (el) {
      // `y` (0–1 within the page) centres a cited paragraph or search hit in the upper third.
      const offset = navigation.y == null ? 24 : Math.min(container.clientHeight / 3, 160) - navigation.y * el.offsetHeight;
      container.scrollTop += el.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
      onPage(navigation.page);
    }
  }, [navigation, onPage]);
  return <div className="document-area continuous-reader" ref={root} aria-label="PDF 连续阅读">
    {Array.from({length: doc.numPages}, (_, index) => <PdfPage key={index + 1} doc={doc} number={index + 1} zoom={zoom} near={near.has(index + 1)} dimensions={sizes[index + 1] || sizes[1] || {width: 612, height: 792}} annotations={annotations} marks={marks.filter(m => m.page === index + 1)} onSelect={onSelect}/>)}
  </div>;
}
