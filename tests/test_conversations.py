import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from tests.backend_test import client, upload


@pytest.fixture
def sdk(monkeypatch):
    # Mock the SDK at its real import boundary; no installed SDK or API required.
    deepseek_harness = ModuleType('deepseek_harness')
    monkeypatch.setitem(sys.modules, 'deepseek_harness', deepseek_harness)

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
            self.call.update(action='start', session_id=session_id)
            return self

        def resume_session(self, session_id):
            self.call.update(action='resume', session_id=session_id)
            return self

        def get_working_directory(self):
            return self.call['cwd']

        def run(self, prompt, **kwargs):
            self.call['prompt'] = prompt
            cwd = Path(self.call['cwd'])
            self.call['files'] = {str(p.relative_to(cwd)): p.read_bytes()
                                  for p in cwd.rglob('*') if p.is_file()}
            return SimpleNamespace(finish_reason='stop', final_response='Mock SDK answer [p.1]', events=[])

    monkeypatch.setattr(deepseek_harness, 'DeepSeekHarness', Harness, raising=False)
    monkeypatch.setenv('DEEPSEEK_API_KEY', 'mock-key')
    return calls


def send(client, paper_id, message, conversation_id=None):
    body = {'message': message}
    if conversation_id is not None:
        body['conversation_id'] = conversation_id
    response = client.post(f'/api/papers/{paper_id}/chat', json=body)
    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'done', events
    return events[-1]['session_id']


def test_independent_sessions_and_workspaces(client, sdk):
    paper = upload(client)
    pid = paper['id']
    url = f'/api/papers/{pid}'
    data = client.app.state.data_dir
    legacy = data / 'papers' / pid
    # A pre-existing legacy session/history must survive new conversations.
    old_history = [{'role': 'user', 'content': 'LEGACY_PRIVATE_HISTORY'}]
    (legacy / 'messages.json').write_text(json.dumps(old_history))
    (legacy / 'session.json').write_text(json.dumps({'session_id': 'paper-' + pid}))
    old_marker = (legacy / 'session.json').read_bytes()
    listed = client.get(url + '/conversations').json()
    assert listed == [{'id': 'default', 'title': '原有对话', 'created_at': paper['created_at']}]
    a, b = [client.post(url + '/conversations').json() for _ in range(2)]
    assert a['id'] != b['id']
    assert set(a) == {'id', 'title', 'created_at', 'title_source', 'archived'}
    for item in (a, b):
        assert client.get(url + '/messages', params={'conversation_id': item['id']}).json() == []
    assert client.get(url + '/messages').json() == old_history
    assert client.get(url + '/messages?conversation_id=default').json() == old_history

    first_question = 'FIRST_CONVERSATION_SECRET ' + 'long question ' * 10
    sid_a = send(client, pid, first_question, a['id'])
    annotation = client.post(url + '/annotations', json={'page': 1, 'note': 'shared updated note', 'color': '#22c55e'}).json()
    sid_b = send(client, pid, 'SECOND_CONVERSATION_QUESTION', b['id'])
    assert sid_a != sid_b
    assert send(client, pid, 'Follow up', a['id']) == sid_a
    assert [c['action'] for c in sdk] == ['start', 'start', 'resume']
    assert sdk[0]['dsh_home'] != sdk[1]['dsh_home']
    assert sdk[0]['cwd'] != sdk[1]['cwd']
    for call, item in zip(sdk[:2], (a, b)):
        conv = data / 'conversations' / pid / item['id']
        assert Path(call['dsh_home']) == data / 'harness' / pid / item['id']
        assert Path(call['cwd']) == conv / 'workspace'
        assert call['runtime_cwd'] == call['cwd']
        assert not conv.is_relative_to(legacy)
        assert set(call['files']) == {'fulltext.md', 'figures.md', 'annotations.json', 'paper.pdf', 'AGENTS.md', 'pages/p1.jpg', 'pages/p2.jpg'}
        assert b'[p.1#1] Real PDF research evidence.' in call['files']['fulltext.md']
        # The protocol reaches the agent through AGENTS.md, not by repeating it every turn.
        assert '<reader_context>' in call['prompt'] and '论文讲解协议' not in call['prompt']
        assert '论文讲解协议' in call['files']['AGENTS.md'].decode()
        assert all(b'LEGACY_PRIVATE_HISTORY' not in content for content in call['files'].values())
        assert (conv / 'messages.json').is_file()
        assert json.loads((conv / 'session.json').read_text())['session_id'] == call['session_id']
        assert all((conv / 'workspace' / name).stat().st_mode & 0o222 == 0 for name in call['files'])
    assert first_question not in sdk[1]['prompt']
    assert all(first_question.encode() not in content for content in sdk[1]['files'].values())
    assert json.loads(sdk[2]['files']['annotations.json']) == [annotation]
    assert (legacy / 'messages.json').read_text() == json.dumps(old_history)
    assert (legacy / 'session.json').read_bytes() == old_marker
    histories = [client.get(url + '/messages', params={'conversation_id': c['id']}).json() for c in (a, b)]
    assert len(histories[0]) == 4 and len(histories[1]) == 2
    assert histories[1][0]['content'] == 'SECOND_CONVERSATION_QUESTION'
    assert client.get(url + '/conversations').json()[1]['title'] == first_question[:40].rstrip() + '…'

    # Omission still resumes the original session in its original cwd and home.
    assert send(client, pid, 'Legacy follow-up') == 'paper-' + pid
    assert sdk[-1]['action'] == 'resume'
    assert Path(sdk[-1]['cwd']) == legacy
    assert Path(sdk[-1]['dsh_home']) == data / 'harness' / pid


def test_conversations_and_annotation_colors_survive_recreation(client, sdk, tmp_path):
    pid = upload(client)['id']
    url = f'/api/papers/{pid}'
    conv = client.post(url + '/conversations').json()
    annotation = client.post(url + '/annotations', json={'page': 1, 'text': 'evidence', 'color': '#c084fc'}).json()
    session_id = send(client, pid, 'Saved conversation', conv['id'])
    expected = client.get(url + '/conversations').json()
    history = client.get(url + '/messages', params={'conversation_id': conv['id']}).json()
    recreated = TestClient(create_app(client.app.state.data_dir, tmp_path / 'config/settings.json'))
    assert recreated.get(url + '/conversations').json() == expected
    assert recreated.get(url + '/annotations').json() == [annotation]
    assert recreated.get(url + '/messages', params={'conversation_id': conv['id']}).json() == history
    assert send(recreated, pid, 'Resume after recreation', conv['id']) == session_id
    assert sdk[-1]['action'] == 'resume'


@pytest.mark.parametrize('cid', ['', '..', '../default', '/tmp', 'a' * 31, 'a' * 33, 'A' * 32, 'g' * 32, '0' * 32, 'default/../x'])
def test_invalid_or_missing_conversation_ids(client, sdk, cid):
    pid = upload(client)['id']
    url = f'/api/papers/{pid}'
    before = set(client.app.state.data_dir.rglob('*'))
    assert client.get(url + '/messages', params={'conversation_id': cid}).status_code == 404
    assert client.post(url + '/chat', json={'message': 'hello', 'conversation_id': cid}).status_code == 404
    assert set(client.app.state.data_dir.rglob('*')) == before
    assert not sdk


def test_paper_scoping_and_invalid_papers(client, sdk):
    pid = upload(client)['id']
    other = upload(client)['id']
    conv = client.post(f'/api/papers/{pid}/conversations').json()['id']
    assert client.get(f'/api/papers/{other}/messages', params={'conversation_id': conv}).status_code == 404
    assert client.post(f'/api/papers/{other}/chat', json={'message': 'hello', 'conversation_id': conv}).status_code == 404
    for pid in ('invalid', '0' * 32):
        assert client.get(f'/api/papers/{pid}/conversations').status_code == 404
        assert client.post(f'/api/papers/{pid}/conversations').status_code == 404
    assert not sdk
