import React from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import {normalizeMath} from './math';
import {linkCitations, parseCitation} from './citations';

export default function Answer({text, onCite, preview}) {
  const components = {
    img: ({alt}) => <span>[图片已阻止自动加载：{alt || '无说明'}]</span>,
    a: ({href, children}) => {
      const cite = parseCitation(href);
      if (!cite) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
      const label = `[p.${cite.page}${cite.block ? '#' + cite.block : ''}]`;
      return <button type="button" className="citation" aria-label={label} title={preview?.(cite) || `跳转到第 ${cite.page} 页`} onClick={() => onCite?.(cite)}>{children}</button>;
    },
  };
  return <div className="markdown">
    <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={components}>{linkCitations(normalizeMath(text))}</Markdown>
  </div>;
}
