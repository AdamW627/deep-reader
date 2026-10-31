import React, {useEffect, useState} from 'react';
import {LoaderCircle, RefreshCw, Sparkles} from 'lucide-react';
import Answer from './Answer';

async function request(path, options) {
  const response = await fetch(path, {cache: 'no-store', ...options});
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(typeof value.detail === 'string' ? value.detail : '导读服务暂不可用');
  return value;
}

export default function PaperCard({paperId, configured, onCite, preview}) {
  const [card, setCard] = useState(null), [error, setError] = useState('');
  async function generate() {
    setError('');
    try { setCard(await request(`/api/papers/${paperId}/card`, {method: 'POST'})); } catch (e) { setError(e.message); }
  }
  useEffect(() => {
    let alive = true;
    setCard(null); setError('');
    request(`/api/papers/${paperId}/card`).then(value => { if (alive) setCard(value); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [paperId]);
  useEffect(() => {
    if (card?.status !== 'running') return;
    let alive = true, timer;
    async function poll() {
      try {
        const value = await request(`/api/papers/${paperId}/card`);
        if (!alive) return;
        setCard(value);
        if (value.status === 'running') timer = setTimeout(poll, 3000);
      } catch (e) { if (alive) setError(e.message); }
    }
    timer = setTimeout(poll, 3000);
    return () => { alive = false; clearTimeout(timer); };
  }, [paperId, card?.status]);
  const running = card?.status === 'running';
  const briefLabel = card?.brief_kind === 'abstract' ? '摘要 · 本地提取' : '开头 · 本地提取';
  return <div className="paper-card">
    <header className="paper-card-header">
      <div><Sparkles size={15}/><strong>论文导读</strong></div>
      {card?.content && !running && <button type="button" className="ghost-button" onClick={generate}><RefreshCw size={13}/>重新生成</button>}
    </header>
    {error && <p className="card-note error-text">{error}</p>}
    {running && <p className="card-note"><LoaderCircle className="spin" size={14}/>Agent 正在通读全文并查看关键图表，通常需要 1–2 分钟…</p>}
    {card?.status === 'error' && <div className="card-note error-text">{card.error || '生成失败'}<button type="button" className="ghost-button" onClick={generate}>重试</button></div>}
    {!card && !error && <p className="card-note">正在读取本地快览…</p>}
    {card?.brief && !card.content && <section className="card-brief"><p className="card-kicker">{briefLabel} · 不产生费用</p><p>{card.brief}</p></section>}
    {!running && card && card.status !== 'error' && !card.content && <div className="card-generate">
      <p>深度导读会让 Agent 通读全文并查看关键图表，每篇大约一次完整阅读的费用。导入和打开都不会自动生成。</p>
      <button type="button" className="primary" disabled={!configured} onClick={generate}>生成深度导读</button>
      {!configured && <p className="card-note">先在设置中保存 DeepSeek API Key。</p>}
    </div>}
    {card?.content && <Answer text={card.content} onCite={onCite} preview={preview}/>}
  </div>;
}
