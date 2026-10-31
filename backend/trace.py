"""Allowlisted public Harness session events; never forward request headers/replay state."""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone


def _arguments(data):
    try:
        value = json.loads(data.get('arguments') or '{}')
        return value if isinstance(value, dict) else {}
    except ValueError:
        return {}


def describe(event):
    """Short reader-facing progress label for a tool call, or None."""
    if event.get('type') != 'tool/call':
        return None
    data = event.get('data') or {}
    name, args = data.get('name', ''), _arguments(data)
    if name == 'grep':
        target = '“' + str(args.get('pattern', ''))[:50] + '”'
    elif name == 'bash':
        return ('定位原文 ' + str(args.get('description') or '')[:60]).strip()
    else:
        target = str(args.get('file_path') or args.get('path') or args.get('query') or args.get('url') or '')
        target = target if name.startswith('web_') else target.rsplit('/', 1)[-1]
        target = target[:60]
    labels = {'read': '阅读', 'read_image': '查看图片', 'grep': '搜索', 'glob': '查找文件', 'web_search': '联网搜索', 'web_fetch': '读取网页'}
    return f'{labels.get(name, "调用 " + name)} {target}'.strip()


def step_text(event):
    """Visible text of one completed model step."""
    if event.get('type') != 'assistant/message':
        return ''
    blocks = (event.get('data') or {}).get('message', {}).get('content', [])
    return ''.join(b.get('text', '') for b in blocks if isinstance(b, dict) and b.get('type') == 'text').strip()


class TraceCollector:
    def __init__(self, api_key=''):
        self.api_key = api_key
        self.items = []
        self.seen = set()

    def clean(self, value):
        text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        if self.api_key:
            text = text.replace(self.api_key, '[redacted]')
        text = re.sub(r'(?i)(bearer\s+)[\w.\-]+', r'\1[redacted]', text)
        text = re.sub(r'(?i)(["\']?(?:api[_-]?key|authorization|password|access_token)["\']?\s*[:=]\s*)("[^"\n]*"|\'[^\'\n]*\'|[^\s,}]+)', r'\1"[redacted]"', text)
        return text[:16000] + ('\n[内容已截断]' if len(text) > 16000 else '')

    def accept(self, event):
        if len(self.items) >= 500:
            return []
        seq = event.get('seq')
        if seq is not None and seq in self.seen:
            return []
        if seq is not None:
            self.seen.add(seq)
        kind = event.get('type')
        data = event.get('data') or {}
        items = []
        if kind == 'assistant/message':
            blocks = data.get('message', {}).get('content', [])
            text = ''.join(b.get('text', '') for b in blocks if b.get('type') == 'reasoning')
            if not text:
                text = ''.join(''.join(r.get('texts', [])) for r in data.get('stream', []) if r.get('type') == 'reasoning-chunks')
            if text:
                items.append({'kind': 'reasoning', 'content': self.clean(text), 'status': 'completed'})
        elif kind == 'tool/call':
            items.append({'kind': 'tool', 'call_id': self.clean(data.get('callId', '')), 'name': self.clean(data.get('name', '工具')), 'content': self.clean(data.get('arguments', '')), 'status': 'running'})
        elif kind == 'tool/result':
            message = data.get('message') or {}
            blocks = message.get('content', [])
            text = '\n'.join(b.get('text', '') for b in blocks if b.get('type') == 'text')
            if not text:
                text = '[非文本工具结果]' if blocks else '[空结果]'
            items.append({'kind': 'tool_result', 'call_id': self.clean(message.get('toolCallId', '')), 'content': self.clean(text), 'status': 'error' if message.get('isError') or data.get('error') else 'completed'})
        for item in items:
            item['id'] = str(len(self.items))
            item['created_at'] = datetime.now(timezone.utc).isoformat()
            self.items.append(item)
        return items
