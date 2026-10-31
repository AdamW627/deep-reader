import json
import socket
from unittest.mock import patch

import pymupdf
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.download import public_target


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv('DEEPSEEK_API_KEY', raising=False)
    return TestClient(create_app(tmp_path / 'data', tmp_path / 'config/settings.json'))


def upload(client):
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 72), 'Real PDF research evidence.')
        pdf.new_page().insert_text((72, 72), 'Second page conclusion.')
        raw = pdf.tobytes()
    result = client.post('/api/papers/upload', files={'file': ('Research.pdf', raw, 'application/pdf')})
    assert result.status_code == 200, result.text
    return result.json()


def banner_pdf():
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((72, 40), 'Published as a conference paper at ICLR 2021', fontsize=10)
        page.insert_text((72, 110), 'Deformable DETR: Deformable Transformers', fontsize=18)
        page.insert_text((72, 134), 'for End-to-End Object Detection', fontsize=18)
        return pdf.tobytes()


def test_title_ignores_venue_banner(client):
    paper = client.post('/api/papers/upload', files={'file': ('banner.pdf', banner_pdf(), 'application/pdf')}).json()
    assert paper['title'] == 'Deformable DETR: Deformable Transformers for End-to-End Object Detection'


def test_startup_repairs_legacy_titles_once(client, tmp_path):
    with pymupdf.open() as pdf:
        pdf.new_page()
        blank = pdf.tobytes()
    banner = client.post('/api/papers/upload', files={'file': ('banner.pdf', banner_pdf(), 'application/pdf')}).json()
    scanned = client.post('/api/papers/upload', files={'file': ('scan.pdf', blank, 'application/pdf')}).json()
    papers = client.app.state.data_dir / 'papers'
    for paper, legacy in ((banner, 'Published as a conference paper at ICLR 2021'), (scanned, 'Scanned Paper Title')):
        path = papers / paper['id'] / 'paper.json'
        meta = json.loads(path.read_text())
        meta['title'] = legacy
        del meta['title_version']
        path.write_text(json.dumps(meta))
    (papers / banner['id'] / 'fulltext.md').write_text('# Published as a conference paper at ICLR 2021\n\nbody')

    def restart():
        with TestClient(create_app(tmp_path / 'data', tmp_path / 'config/settings.json')) as restarted:
            return {p['id']: p['title'] for p in restarted.get('/api/papers').json()}

    titles = restart()
    assert titles[banner['id']] == 'Deformable DETR: Deformable Transformers for End-to-End Object Detection'
    assert titles[scanned['id']] == 'Scanned Paper Title'
    assert (papers / banner['id'] / 'fulltext.md').read_text() == '# Deformable DETR: Deformable Transformers for End-to-End Object Detection\n\nbody'
    path = papers / banner['id'] / 'paper.json'
    path.write_text(json.dumps({**json.loads(path.read_text()), 'title': 'Renamed by hand'}))
    assert restart()[banner['id']] == 'Renamed by hand'


def test_metadata_title_wins(client):
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((72, 120), 'Visible Heading On The Page', fontsize=20)
        pdf.set_metadata({'title': 'The Real Metadata Title'})
        raw = pdf.tobytes()
    paper = client.post('/api/papers/upload', files={'file': ('ignored-filename.pdf', raw, 'application/pdf')}).json()
    assert paper['title'] == 'The Real Metadata Title'


def test_pdf_annotations_history(client):
    paper = upload(client)
    id = paper['id']
    assert paper['page_count'] == 2
    assert client.get('/api/papers').json()[0]['id'] == id
    assert client.get(f'/api/papers/{id}/pdf').content.startswith(b'%PDF-')
    pages = client.get(f'/api/papers/{id}/text').json()['pages']
    assert 'research evidence' in pages[0]['text']
    assert 'conclusion' in client.get(f'/api/papers/{id}/text?page=2').json()['pages'][0]['text']
    assert client.get(f'/api/papers/{id}/text?page=3').status_code == 400
    annotation = client.post(f'/api/papers/{id}/annotations', json={'page': 1, 'text': 'evidence', 'note': 'check this', 'rects': [{'x': 0.1, 'y': 0.2, 'width': 0.3, 'height': 0.02}]}).json()
    assert client.get(f'/api/papers/{id}/annotations').json()[0]['note'] == 'check this'
    folder = client.app.state.data_dir / 'papers' / id
    assert '[p.2]' in (folder / 'fulltext.md').read_text()
    assert json.loads((folder / 'annotations.json').read_text())[0]['id'] == annotation['id']
    response = client.post(f'/api/papers/{id}/chat', json={'message': 'Explain this', 'selection': {'text': 'evidence', 'page': 1, 'rects': []}})
    assert response.headers['content-type'].startswith('text/event-stream')
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
    assert events[-1]['type'] == 'error'
    assert events[-1]['code'] == 'setup_required'
    assert not any(e['type'] == 'delta' for e in events)
    assert client.get(f'/api/papers/{id}/messages').json()[0]['role'] == 'user'
    assert client.delete(f'/api/papers/{id}/annotations/{annotation["id"]}').status_code == 200
    assert client.get(f'/api/papers/{id}/annotations').json() == []


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'http://127.0.0.1/x', 'http://[::1]/x', 'http://169.254.169.254/', 'http://user:password@example.com/x', 'http://example.com:8080/x'])
def test_ssrf(client, url):
    assert client.post('/api/papers/import', json={'url': url}).status_code == 400


def test_mixed_dns_is_rejected():
    with patch('socket.getaddrinfo', return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 80)), (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.1', 80))]):
        with pytest.raises(HTTPException):
            public_target('http://example.com')


def test_settings_origin_and_extension(client, tmp_path):
    assert not client.get('/api/settings').json()['has_api_key']
    with patch('backend.download.public_target'):
        result = client.put('/api/settings', json={'api_key': 'secret-for-test'})
    assert result.json() == {'has_api_key': True, 'model': 'deepseek-flash', 'base_url': 'https://api.deepseek.com/anthropic'}
    settings_file = tmp_path / 'config/settings.json'
    assert settings_file.stat().st_mode & 0o777 == 0o600
    assert 'secret-for-test' not in client.get('/api/health').text
    assert 'secret-for-test' not in client.get('/api/settings').text
    extension = {'Origin': 'chrome-extension://' + 'a' * 32}
    assert client.get('/api/capture-token', headers=extension).status_code == 403
    assert client.post('/api/papers/import', json={'url': 'http://127.0.0.1'}, headers=extension).status_code == 403
    token = client.get('/api/capture-token').json()['token']
    extension['X-Capture-Token'] = token
    # Passed token authorization, then rejected unsafe destination.
    assert client.post('/api/papers/import', json={'url': 'http://127.0.0.1'}, headers=extension).status_code == 400
    assert client.put('/api/settings', json={'api_key': 'evil'}, headers={'Origin': 'https://evil.example'}).status_code == 403
    assert client.get('/api/health', headers={'Host': 'evil.example'}).status_code == 403
    assert client.options('/api/papers/import', headers={'Origin': extension['Origin'], 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Capture-Token,Content-Type'}).status_code == 200


def test_invalid_pdf_and_ids(client):
    assert client.post('/api/papers/upload', files={'file': ('bad.pdf', b'not a pdf')}).status_code == 400
    assert client.get('/api/papers/' + 'a' * 32 + '/pdf').status_code == 404
    assert client.get('/api/unknown').status_code == 404
