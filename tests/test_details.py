import json

import pytest
from fastapi.testclient import TestClient

from backend.app import create_app
from tests.backend_test import client, upload


def symlink_or_skip(link, target, directory=False):
    # Windows 默认不允许普通进程创建符号链接（需开发者模式或管理员权限）。
    try:
        link.symlink_to(target, target_is_directory=directory)
    except OSError as exc:
        if getattr(exc, 'winerror', None) == 1314:
            pytest.skip(f'Windows symlink privilege unavailable: {exc}')
        raise


def test_details_resolved_paths_and_allowlist(client, tmp_path):
    paper = upload(client)
    folder = client.app.state.data_dir / 'papers' / paper['id']
    settings = tmp_path / 'config/settings.json'
    settings.parent.mkdir(parents=True, exist_ok=True)
    settings.write_text(json.dumps({'api_key': 'private-api-key'}))
    meta = json.loads((folder / 'paper.json').read_text())
    meta.update(api_key='private-metadata-key', token='private-metadata-token', size=0)
    (folder / 'paper.json').write_text(json.dumps(meta))
    result = client.get(f"/api/papers/{paper['id']}/details")
    assert result.status_code == 200
    details = result.json()
    assert details == {
        'id': paper['id'], 'title': paper['title'], 'filename': 'Research.pdf',
        'page_count': 2, 'size': (folder / 'paper.pdf').stat().st_size,
        'created_at': paper['created_at'], 'project_id': 'default', 'project_name': '默认项目',
        'source_url': None, 'pdf_url': paper['pdf_url'],
        'pdf_path': str((folder / 'paper.pdf').resolve()), 'metadata_dir': str(folder.resolve()),
    }
    assert 'private-' not in result.text
    assert 'capture-token' not in result.text and 'settings.json' not in result.text


def test_details_custom_root_legacy_and_project(tmp_path):
    root = tmp_path / 'custom storage'
    root.mkdir()
    alias = tmp_path / 'alias'
    symlink_or_skip(alias, root, directory=True)
    with TestClient(create_app(alias, tmp_path / 'settings.json')) as client:
        paper = upload(client)
        folder = root / 'papers' / paper['id']
        meta = json.loads((folder / 'paper.json').read_text())
        del meta['project_id']
        meta['source_url'] = 'https://example.org/original.pdf'
        (folder / 'paper.json').write_text(json.dumps(meta))
        details = client.get(f"/api/papers/{paper['id']}/details").json()
        assert details['metadata_dir'] == str(folder.resolve())
        assert details['source_url'] == meta['source_url']
        assert details['project_name'] == '默认项目'
        project = client.post('/api/projects', json={'name': '研究项目'}).json()
        meta['project_id'] = project['id']
        (folder / 'paper.json').write_text(json.dumps(meta))
        assert client.get(f"/api/papers/{paper['id']}/details").json()['project_name'] == '研究项目'


@pytest.mark.parametrize('source', ['javascript:alert(1)', 'file:///tmp/a.pdf', 'https://user:private-password@example.org/a', 'https://[invalid'])
def test_details_rejects_unsafe_sources(client, source):
    paper = upload(client)
    path = client.app.state.data_dir / 'papers' / paper['id'] / 'paper.json'
    meta = json.loads(path.read_text())
    meta['source_url'] = source
    path.write_text(json.dumps(meta))
    result = client.get(f"/api/papers/{paper['id']}/details")
    assert result.json()['source_url'] is None
    assert 'private-password' not in result.text


def test_details_notfound_and_escaping_paths(client, tmp_path):
    for id in ['missing', 'f' * 32, '%2E%2E%2Fsettings']:
        assert client.get(f'/api/papers/{id}/details').status_code == 404
    paper = upload(client)
    folder = client.app.state.data_dir / 'papers' / paper['id']
    pdf = folder / 'paper.pdf'
    pdf.unlink()
    assert client.get(f"/api/papers/{paper['id']}/details").status_code == 404
    outside = tmp_path / 'outside.pdf'
    outside.write_bytes(b'private file')
    symlink_or_skip(pdf, outside)
    assert client.get(f"/api/papers/{paper['id']}/details").status_code == 404
    escaped = client.app.state.data_dir / 'papers' / ('e' * 32)
    symlink_or_skip(escaped, folder.parent.parent.parent, directory=True)
    assert client.get(f"/api/papers/{'e' * 32}/details").status_code == 404


def test_upload_preserves_original_filename(client):
    paper = upload(client)
    raw = client.get(paper['pdf_url']).content
    added = client.post('/api/papers/upload', files={'file': ('原始.PDF', raw, 'application/pdf')}).json()
    assert client.get(f"/api/papers/{added['id']}/details").json()['filename'] == '原始.PDF'
def test_import_uses_source_filename(client):
    from unittest.mock import patch

    paper = upload(client)
    raw = client.get(paper['pdf_url']).content
    with patch('backend.app.download', return_value=(raw, 'https://example.org/Original%20Name.PDF')):
        added = client.post('/api/papers/import', json={'url': 'https://example.org/paper', 'title': 'Display title'}).json()
    assert client.get(f"/api/papers/{added['id']}/details").json()['filename'] == 'Original Name.PDF'
