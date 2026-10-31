"""Agent-readable paper sources derived from paper.pdf.

fulltext.md keeps the `## [p.N]` page headings and prefixes every text block with
`[p.N#K]`, so answers can cite a paragraph that the reader can highlight again.
Page renders and figure crops let the agent inspect equations and figures with
read_image, because PDF text extraction mangles them.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import uuid
from pathlib import Path

import pymupdf

VERSION = 2
PAGE_DPI = 120
FIGURE_DPI = 200
CAPTION = re.compile(r'^\s*(Figure|Fig\.?|FIGURE|FIG\.?|Table|TABLE)\s*(\d+|[IVX]+)(?=\s*[:.|]|\s+[A-Z]|\s*\n|\s*$)')
JPEG_QUALITY = 82
HYPHEN = re.compile(r'(\w)-\n(?=[a-z])')


def clean_block(text):
    text = HYPHEN.sub(r'\1', text)
    return ' '.join(text.split())


def page_blocks(page):
    return [{'rect': pymupdf.Rect(x0, y0, x1, y1), 'text': clean_block(text)}
            for x0, y0, x1, y1, text, _, kind in page.get_text('blocks') if kind == 0 and clean_block(text)]


def number_blocks(page, blocks):
    width, height = page.rect.width or 1, page.rect.height or 1
    for index, block in enumerate(blocks, 1):
        r = block['rect']
        block['id'] = f'p{page.number + 1}#{index}'
        block['bbox'] = [round(max(0, r.x0 / width), 4), round(max(0, r.y0 / height), 4), round(min(1, r.x1 / width), 4), round(min(1, r.y1 / height), 4)]
    return blocks


def graphics(page):
    rects = [pymupdf.Rect(info['bbox']) for info in page.get_image_info()]
    try:
        rects += page.cluster_drawings()
    except Exception:
        rects += [d['rect'] for d in page.get_drawings()]
    area = page.rect.width * page.rect.height
    return [r & page.rect for r in rects if r.is_valid and not r.is_empty and r.width > 8 and r.height > 8 and r.width * r.height < area * 0.9]


def figure_region(page, caption, shapes):
    """Union of graphics stacked directly above a figure caption, or None."""
    width = page.rect.width
    left, right = caption[0], caption[2]
    if right - left < width * 0.55 and (left > width * 0.2 and right < width * 0.8):
        left, right = 0, width
    above = [r for r in shapes if r.y1 <= caption[1] + 4 and r.x1 > left - 4 and r.x0 < right + 4 and r.y0 > caption[1] - page.rect.height * 0.8]
    above.sort(key=lambda r: -r.y1)
    if not above or caption[1] - above[0].y1 > 48:
        return None
    region = pymupdf.Rect(above[0])
    for r in above[1:]:
        if r.y1 >= region.y0 - 24:
            region |= r
    if region.width < 40 or region.height < 30:
        return None
    region |= pymupdf.Rect(caption)
    return (region + (-6, -6, 6, 6)) & page.rect


def build(folder: Path, title=None):
    """Regenerate fulltext.md, blocks.json, pages/ and figures/ from paper.pdf."""
    folder = Path(folder)
    pages_dir, figures_dir = folder / 'pages', folder / 'figures'
    for directory in (pages_dir, figures_dir):
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir()
    if title is None and (folder / 'paper.json').exists():
        title = json.loads((folder / 'paper.json').read_text()).get('title')
    lines = [f'# {title or "Paper"}', '',
             '> PDF 文本抽取：每页以 `## [p.N]` 开头，每个段落块以 `[p.N#K]` 开头。公式、上下标和表格可能损坏，请对照 figures/ 与 pages/pN.jpg 原图。', '']
    index, block_pages, seen = [], [], {}
    with pymupdf.open(folder / 'paper.pdf') as pdf:
        for page in pdf:
            number = page.number + 1
            blocks = page_blocks(page)
            page.get_pixmap(dpi=PAGE_DPI).save(pages_dir / f'p{number}.jpg', jpg_quality=JPEG_QUALITY)
            shapes, found, regions = None, [], []
            for block in blocks:
                match = CAPTION.match(block['text'])
                if not match:
                    continue
                kind = 'Table' if match.group(1).lower().startswith('tab') else 'Figure'
                label = f'{kind} {match.group(2)}'
                seen[label] = seen.get(label, 0) + 1
                name = f'{kind.lower()}-{match.group(2)}' + (f'-{seen[label]}' if seen[label] > 1 else '')
                image = None
                if kind == 'Figure':
                    shapes = graphics(page) if shapes is None else shapes
                    region = figure_region(page, block['rect'], shapes)
                    if region is not None:
                        image = f'figures/{name}.jpg'
                        page.get_pixmap(dpi=FIGURE_DPI, clip=region).save(folder / image, jpg_quality=JPEG_QUALITY)
                        regions.append((region, block))
                found.append((block, {'label': label, 'page': number, 'caption': block['text'][:600], 'image': image, 'page_image': f'pages/p{number}.jpg'}))
            # Axis ticks and labels inside a cropped figure are noise in the text; the crop carries them.
            blocks = [b for b in blocks if not any(b is not caption and len(b['text']) < 120 and region.contains(b['rect']) for region, caption in regions)]
            number_blocks(page, blocks)
            for block, item in found:
                index.append({**item, 'block': block['id']})
            lines += [f'## [p.{number}]', '']
            lines += [f'[{b["id"].replace("p", "p.", 1)}] {b["text"]}' for b in blocks]
            lines.append('')
            block_pages.append({'page': number, 'blocks': [{k: b[k] for k in ('id', 'bbox', 'text')} for b in blocks]})
    figures = ['# 图表索引', '', '用 read_image 查看图片。`image` 为自动裁剪（可能不完整），`page_image` 为整页图。', '']
    for item in index:
        figures.append(f'- {item["label"]} [p.{item["page"]}] image: {item["image"] or "（未裁剪，看整页）"} · page_image: {item["page_image"]}')
        figures.append(f'  图注：{item["caption"]}')
    if not index:
        figures.append('未检测到带编号的图表标题；请直接查看 pages/pN.jpg。')
    write_text(folder / 'fulltext.md', '\n'.join(lines))
    write_text(folder / 'figures.md', '\n'.join(figures) + '\n')
    write_text(folder / 'blocks.json', json.dumps({'pages': block_pages}, ensure_ascii=False))
    write_text(folder / 'figures.json', json.dumps(index, ensure_ascii=False))
    write_text(folder / 'assets.json', json.dumps({'version': VERSION, 'figures': len(index)}))


def write_text(path: Path, text: str):
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(text)
    os.replace(temp, path)


def ensure(folder: Path):
    marker = Path(folder) / 'assets.json'
    try:
        if json.loads(marker.read_text()).get('version') == VERSION:
            return
    except (OSError, ValueError):
        pass
    build(folder)
