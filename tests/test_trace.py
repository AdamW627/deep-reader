from backend.trace import TraceCollector
from tests.test_conversations import sdk
from tests.backend_test import client, upload
from types import SimpleNamespace
import json


def test_chat_stream_and_history_preserve_trace(client, sdk, monkeypatch):
    import deepseek_harness
    def run(self, prompt, on_notification):
        for seq, (kind, data) in enumerate([
            ('assistant/message', {'message': {'content': [{'type': 'reasoning', 'text': 'Public reasoning'}]}}),
            ('tool/call', {'callId': 'c1', 'name': 'read', 'arguments': '{"path":"fulltext.md"}'}),
            ('tool/result', {'message': {'toolCallId': 'c1', 'content': [{'type': 'text', 'text': 'Paper content'}]}}),
        ]):
            on_notification(SimpleNamespace(method='session.event', payload={'event': {'seq': seq, 'type': kind, 'data': data}}))
        return SimpleNamespace(finish_reason='stop', final_response='Answer')
    monkeypatch.setattr(deepseek_harness.DeepSeekHarness, 'run', run)
    pid = upload(client)['id']
    response = client.post(f'/api/papers/{pid}/chat', json={'message': 'Read'})
    events = [json.loads(x[6:]) for x in response.text.splitlines() if x.startswith('data: ')]
    streamed = [x['content'] for x in events if x['type'] == 'trace']
    assert len(streamed) == 3
    assert events[-1]['type'] == 'done'
    history = client.get(f'/api/papers/{pid}/messages').json()
    assert len(history) == 2
    assert history[-1]['trace'] == streamed



def test_real_sdk_events_redacted_and_ordered():
    trace = TraceCollector('secret-key')
    trace.accept({'type': 'assistant/message', 'seq': 1, 'data': {'message': {'content': [{'type': 'reasoning', 'text': 'Read the paper first.'}]}}})
    trace.accept({'type': 'tool/call', 'seq': 2, 'data': {'callId': 'c1', 'name': 'read_file', 'arguments': '{"path":"fulltext.md","api_key":"secret-key"}'}})
    trace.accept({'type': 'tool/result', 'seq': 3, 'data': {'message': {'toolCallId': 'c1', 'content': [{'type': 'text', 'text': 'evidence secret-key'}]}}})
    assert [x['kind'] for x in trace.items] == ['reasoning', 'tool', 'tool_result']
    assert trace.items[-1]['call_id'] == 'c1'
    assert 'secret-key' not in str(trace.items)
    assert trace.items[-1]['status'] == 'completed'
    assert trace.accept({'type': 'request/header', 'data': {'header': 'private'}}) == []


def test_stream_fallback_error_and_limits():
    trace = TraceCollector('key')
    events = trace.accept({'type': 'assistant/message', 'data': {'stream': [{'type': 'reasoning-chunks', 'texts': ['a', 'b']}]}})
    assert events[0]['content'] == 'ab'
    trace.accept({'type': 'tool/result', 'data': {'message': {'toolCallId': 'bad', 'isError': True, 'content': [{'type': 'text', 'text': 'x' * 40000}]}}})
    assert trace.items[-1]['status'] == 'error'
    assert len(trace.items[-1]['content']) < 17000
