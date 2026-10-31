import React, {useEffect, useRef, useState} from 'react';

function safeSource(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function readableSize(bytes) {
  if (!Number.isFinite(bytes)) return '未知';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${(bytes / 1024 ** index).toLocaleString(undefined, {maximumFractionDigits: 2})} ${units[index]}（${bytes} 字节）`;
}

export default function DocumentDetails({paperId, onClose}) {
  const dialog = useRef(null), close = useRef(null);
  const [details, setDetails] = useState(null), [error, setError] = useState(''), [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    close.current.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDetails(null); setError(''); setCopyStatus('');
    (async () => {
      try {
        const response = await fetch(`/api/papers/${encodeURIComponent(paperId)}/details`, {signal: controller.signal});
        if (!response.ok) throw Error('无法加载文档详情，请关闭后重试。');
        const value = await response.json();
        if (active) setDetails(value);
      } catch (e) { if (active && e.name !== 'AbortError') setError(e.message); }
    })();
    return () => { active = false; controller.abort(); };
  }, [paperId]);
  async function copyPath(value) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus('路径已复制');
    } catch {
      setCopyStatus('无法访问剪贴板，请选中下方路径后手动复制。');
    }
  }
  const source = safeSource(details?.source_url);
  const date = details?.created_at ? new Date(details.created_at) : null;
  return <dialog ref={dialog} className="modal document-details" aria-labelledby="document-details-title" onCancel={e => {e.preventDefault(); onClose();}}>
    <header><h2 id="document-details-title">文档详情</h2><button ref={close} type="button" aria-label="关闭文档详情" onClick={onClose}>关闭</button></header>
    {!details && !error && <p role="status">正在加载文档详情…</p>}
    {error && <p role="alert">{error}</p>}
    {details && <>
      <dl>
        <dt>标题</dt><dd>{details.title}</dd>
        <dt>原始文件名</dt><dd>{details.filename}</dd>
        <dt>页数</dt><dd>{details.page_count ?? '未知'}</dd>
        <dt>文件大小</dt><dd>{readableSize(details.size)}</dd>
        <dt>导入时间（本地时间）</dt><dd>{date && !Number.isNaN(date.getTime()) ? <time dateTime={details.created_at}>{date.toLocaleString()}</time> : '未知'}</dd>
        <dt>项目</dt><dd>{details.project_name}</dd>
        <dt>来源</dt><dd>{source ? <a href={source} target="_blank" rel="noopener noreferrer">{source}</a> : details.source_url ? '来源链接不可用' : '本地文件导入'}</dd>
        <dt>论文 ID</dt><dd>{details.id}</dd>
        <dt>PDF 绝对路径</dt><dd><code>{details.pdf_path}</code><button type="button" onClick={() => copyPath(details.pdf_path)}>复制 PDF 路径</button></dd>
        <dt>元数据 / 批注目录</dt><dd><code>{details.metadata_dir}</code><button type="button" onClick={() => copyPath(details.metadata_dir)}>复制目录路径</button></dd>
      </dl>
      <p role="status" aria-live="polite">{copyStatus}</p>
      <footer><a href={`/api/papers/${encodeURIComponent(paperId)}/pdf`} target="_blank" rel="noopener noreferrer">打开原始 PDF ↗</a></footer>
    </>}
  </dialog>;
}
