from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.app import create_app


def test_project_memory_is_scoped_editable_and_persistent(tmp_path):
    data_dir = tmp_path / 'data'
    settings_path = tmp_path / 'settings.json'
    app = create_app(data_dir, settings_path)
    client = TestClient(app)

    first = client.post('/api/projects', json={'name': '规划'}).json()
    second = client.post('/api/projects', json={'name': '感知'}).json()
    url = f"/api/projects/{first['id']}/memory"
    assert client.get(url).json()['items'] == []

    saved = client.put(url, json={'items': [{'text': '正在研究长尾规划场景', 'kind': 'goal'}]})
    assert saved.status_code == 200
    assert saved.json()['items'][0]['text'] == '正在研究长尾规划场景'
    assert client.get(url).json()['items'][0]['text'] == '正在研究长尾规划场景'
    assert client.get(f"/api/projects/{second['id']}/memory").json()['items'] == []

    recreated = TestClient(create_app(data_dir, settings_path))
    assert recreated.get(url).json()['items'][0]['text'] == '正在研究长尾规划场景'


def test_project_memory_save_endpoint_returns_saved_value(tmp_path):
    client = TestClient(create_app(tmp_path / 'data', tmp_path / 'settings.json'))
    project = client.post('/api/projects', json={'name': '记忆返回值'}).json()
    response = client.put(f"/api/projects/{project['id']}/memory", json={'items': [{'text': '明确的研究目标', 'kind': 'goal'}]})
    assert response.status_code == 200
    assert response.json()['items'][0]['text'] == '明确的研究目标'


def test_memory_due_and_context_are_bounded():
    from backend.project_memory import context_text, maintenance_due, record_completed_turn

    state = {'turns_since_maintenance': 9, 'last_maintenance_at': None}
    assert not maintenance_due(state, now='2026-10-27T12:00:00+00:00')
    state = record_completed_turn(state, timestamp='2026-10-27T12:00:00+00:00')
    assert maintenance_due(state, now='2026-10-27T12:00:00+00:00')

    old = {'turns_since_maintenance': 0, 'last_maintenance_at': '2026-10-25T12:00:00+00:00'}
    assert maintenance_due(old, now='2026-10-27T12:00:00+00:00')

    items = [{'text': '研究自动驾驶规划', 'kind': 'goal'}, {'text': '关注图像分割', 'kind': 'goal'}]
    assert '自动驾驶规划' in context_text(items, '自动驾驶论文的问题')
