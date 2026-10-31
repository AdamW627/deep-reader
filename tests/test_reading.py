import json
import sys
import time
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pymupdf
import pytest

from tests.backend_test import client, upload


def figure_pdf():
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 72), 'Body paragraph before the figure.')
        page.draw_rect(pymupdf.Rect(100, 120, 400, 300), color=(0, 0, 0), fill=(0.8, 0.8, 0.9))
        page.insert_text((200, 210), 'axis')
        page.insert_text((100, 320), 'Figure 1: Overview of the method.')
        page.insert_text((72, 400), 'Fig. 1 (left) shows the trend in running text.')
        return pdf.tobytes()


@pytest.fixture
def harness(monkeypatch):
    module = ModuleType('deepseek_harness')
    monkeypatch.setitem(sys.modules, 'deepseek_harness', module)
    calls = []

    class Harness:
        def __init__(self, **kwargs):
            self.call = dict(kwargs)
            calls.append(self.call)

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def start_session(self, session_id):
            self.call['session_id'] = session_id
            return self

        resume_session = start_session

        def get_working_directory(self):
            return self.call['cwd']

        def run(self, prompt, on_notification=None):
            cwd = Path(self.call['cwd'])
            self.call.update(prompt=prompt, files=sorted(str(p.relative_to(cwd)) for p in cwd.rglob('*') if p.is_file()))
            if (cwd / 'reader_profile.md').exists():
                self.call['profile'] = (cwd / 'reader_profile.md').read_text()
            for event in ({'type': 'tool/call', 'seq': 1, 'data': {'callId': 'c1', 'name': 'read', 'arguments': json.dumps({'file_path': str(cwd / 'fulltext.md')})}},
                          {'type': 'assistant/message', 'seq': 2, 'data': {'message': {'content': [{'type': 'text', 'text': '我先看一下原文。'}]}}}):
                if on_notification:
                    on_notification(SimpleNamespace(method='session.event', payload={'event': event}))
            return SimpleNamespace(finish_reason='completed', final_response='## 一句话\n关键 [p.1#1]', events=[])

    module.DeepSeekHarness = Harness
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'mock-key')
    return calls


def chat(client, pid, **body):
    response = client.post(f'/api/papers/{pid}/chat', json={'message': '问题', **body})
    assert response.status_code == 200, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]


def test_figures_are_cropped_and_figure_text_leaves_fulltext(client):
    paper = client.post('/api/papers/upload', files={'file': ('fig.pdf', figure_pdf(), 'application/pdf')}).json()
    folder = client.app.state.data_dir / 'papers' / paper['id']
    figures = client.get(f'/api/papers/{paper["id"]}/figures').json()
    assert [(f['label'], f['page'], f['image']) for f in figures] == [('Figure 1', 1, 'figures/figure-1.jpg')]
    assert (folder / 'figures/figure-1.jpg').stat().st_size > 0
    assert (folder / 'pages/p1.jpg').stat().st_size > 0
    text = (folder / 'fulltext.md').read_text()
    assert 'axis' not in text
    assert '[p.1#1] Body paragraph before the figure.' in text
    assert 'Fig. 1 (left) shows' in text
    blocks = client.get(f'/api/papers/{paper["id"]}/blocks').json()['pages'][0]['blocks']
    assert blocks[0]['id'] == 'p1#1' and all(0 <= v <= 1 for v in blocks[0]['bbox'])
    assert 'Figure 1 [p.1] image: figures/figure-1.jpg' in (folder / 'figures.md').read_text()


def test_legacy_paper_sources_are_migrated(client):
    pid = upload(client)['id']
    folder = client.app.state.data_dir / 'papers' / pid
    for name in ('assets.json', 'blocks.json', 'figures.md'):
        (folder / name).unlink()
    (folder / 'fulltext.md').write_text('## [p.1]\n\nold text')
    (folder / 'AGENTS.md').write_text('old instructions')
    assert client.get(f'/api/papers/{pid}/blocks').json()['pages'][1]['blocks'][0]['text'] == 'Second page conclusion.'
    assert '[p.2#1] Second page conclusion.' in (folder / 'fulltext.md').read_text()
    assert '论文讲解协议' in (folder / 'AGENTS.md').read_text()


def test_profile_action_and_live_progress(client, harness):
    pid = upload(client)['id']
    assert client.get('/api/profile').json() == {'text': ''}
    assert client.put('/api/profile', json={'text': '  自动驾驶 VLA 研究者  '}).json() == {'text': '自动驾驶 VLA 研究者'}
    conversation = client.post(f'/api/papers/{pid}/conversations').json()['id']
    events = chat(client, pid, conversation_id=conversation, action='derive', selection={'text': 'y = F(x) + x', 'page': 1, 'rects': []})
    assert {'type': 'status', 'content': '阅读 fulltext.md'} in events
    assert {'type': 'step', 'content': '我先看一下原文。'} in events
    assert events[-2] == {'type': 'delta', 'content': '## 一句话\n关键 [p.1#1]'}
    call = harness[-1]
    assert call['profile'] == '自动驾驶 VLA 研究者'
    assert '快捷动作「推导公式」' in call['prompt'] and 'y = F(x) + x' in call['prompt']
    history = client.get(f'/api/papers/{pid}/messages', params={'conversation_id': conversation}).json()
    assert history[0]['action'] == 'derive'
    assert client.post(f'/api/papers/{pid}/chat', json={'message': 'x', 'action': 'rm -rf'}).status_code == 422
    client.put('/api/profile', json={'text': ''})
    chat(client, pid, conversation_id=conversation)
    assert 'reader_profile.md' not in harness[-1]['files']


class Stream:
    def __init__(self, status, lines):
        self.status_code = status
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def iter_lines(self):
        return iter(self._lines)

    def read(self):
        return b'{"error":"bad key"}'


def test_direct_translation_skips_the_agent(client, monkeypatch):
    import httpx
    pid = upload(client)['id']
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'translate-key')
    captured = {}

    def stream(method, url, headers, json, timeout):
        captured.update(method=method, url=url, headers=headers, payload=json, timeout=timeout)
        events = ['data: ' + line for line in ('{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"skip"}}',
                                               '{"type":"content_block_delta","delta":{"type":"text_delta","text":"查询特征 "}}',
                                               '{"type":"content_block_delta","delta":{"type":"text_delta","text":"zq"}}')]
        return Stream(200, events)

    monkeypatch.setattr(httpx, 'stream', stream)
    response = client.post(f'/api/papers/{pid}/translate', json={'selection': {'text': 'the query feature zq', 'page': 1, 'rects': []}})
    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events == [{'type': 'delta', 'content': '查询特征 '}, {'type': 'delta', 'content': 'zq'}, {'type': 'done', 'content': None}]
    assert captured['url'] == 'https://api.deepseek.com/anthropic/v1/messages'
    assert captured['payload']['thinking'] == {'type': 'disabled'} and captured['payload']['model'] == 'deepseek-flash'
    assert captured['payload']['messages'] == [{'role': 'user', 'content': 'the query feature zq'}]
    assert 'fulltext' not in captured['payload']['system'] and captured['headers']['x-api-key'] == 'translate-key'
    history = client.get(f'/api/papers/{pid}/messages').json()
    assert history[0]['action'] == 'translate' and history[0]['selection']['text'] == 'the query feature zq'
    assert history[1]['content'] == '查询特征 zq' and 'trace' not in history[1]
    captured.clear()
    repeat = client.post(f'/api/papers/{pid}/translate', json={'selection': {'text': '  the query feature zq ', 'page': 1}})
    assert '查询特征 zq' in repeat.text and captured == {}
    assert client.post(f'/api/papers/{pid}/translate', json={'selection': {'text': 'x', 'page': 99}}).status_code == 400
    monkeypatch.setattr(httpx, 'stream', lambda *args, **kwargs: Stream(401, []))
    failed = client.post(f'/api/papers/{pid}/translate', json={'selection': {'text': 'again', 'page': 1}})
    assert 'translate-key' not in failed.text and '401' in failed.text


def test_paper_card_generation(client, harness, monkeypatch):
    pid = upload(client)['id']
    folder = client.app.state.data_dir / 'papers' / pid
    state = client.get(f'/api/papers/{pid}/card').json()
    assert state['status'] == 'missing' and state['content'] == ''
    assert 'research evidence' in state['brief'] and state['brief_kind'] == 'opening'
    assert client.post(f'/api/papers/{pid}/card').json()['status'] in ('running', 'done')
    for _ in range(100):
        state = client.get(f'/api/papers/{pid}/card').json()
        if state['status'] != 'running':
            break
        time.sleep(0.02)
    assert state['status'] == 'done' and state['content'].startswith('## 一句话')
    card_call = harness[-1]
    assert 'paper_card.md' not in card_call['files'] and 'fulltext.md' in card_call['files']
    assert '导读卡片' in card_call['prompt']
    conversation = client.post(f'/api/papers/{pid}/conversations').json()['id']
    chat(client, pid, conversation_id=conversation)
    assert 'paper_card.md' in harness[-1]['files']
    (folder / 'card.json').write_text(json.dumps({'status': 'running'}))
    assert client.get(f'/api/papers/{pid}/card').json()['status'] == 'error'


def test_local_brief_does_not_call_model(client):
    import pymupdf
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        for index, line in enumerate(['Residual Networks for Recognition', 'Abstract', 'We learn-', 'ing residuals for deep nets.', '1 Introduction', 'The rest of the paper.']):
            page.insert_text((72, 72 + index * 18), line)
        raw = pdf.tobytes()
    paper = client.post('/api/papers/upload', files={'file': ('brief.pdf', raw, 'application/pdf')})
    assert paper.status_code == 200, paper.text
    pid = paper.json()['id']
    state = client.get(f'/api/papers/{pid}/card').json()
    folder = client.app.state.data_dir / 'papers' / pid
    assert state['status'] == 'missing' and state['content'] == ''
    assert state['brief_kind'] == 'abstract'
    assert 'learning residuals for deep nets' in state['brief']
    assert 'The rest of the paper' not in state['brief']
    assert not (folder / 'card.json').exists()


def test_card_requires_key(client):
    pid = upload(client)['id']
    assert client.post(f'/api/papers/{pid}/card').status_code == 400


def test_progress_labels_are_reader_facing():
    from backend.trace import describe

    def call(name, **args):
        return {'type': 'tool/call', 'data': {'name': name, 'arguments': json.dumps(args)}}

    assert describe(call('read', file_path='/tmp/w/fulltext.md')) == '阅读 fulltext.md'
    assert describe(call('read_image', path='figures/figure-1.jpg')) == '查看图片 figure-1.jpg'
    assert describe(call('grep', pattern='Fig. 1')) == '搜索 “Fig. 1”'
    assert describe(call('bash', command='ls -la', description='List workspace files')) == '定位原文 List workspace files'
    assert describe(call('bash', command='ls')) == '定位原文'
    assert describe({'type': 'tool/call', 'data': {'name': 'read', 'arguments': 'not json'}}) == '阅读'
    assert describe({'type': 'tool/result', 'data': {}}) is None
