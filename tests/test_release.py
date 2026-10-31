import importlib.util
from pathlib import Path
import tarfile
import pytest

from fastapi.testclient import TestClient
from backend.app import create_app

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_release', ROOT / 'scripts/package_release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def test_release_allowlist_excludes_private_artifacts():
    for name in ('', '.data/papers/paper.pdf', '.env', '.env.example', '.git/config',
                 'frontend/node_modules/a.js', 'frontend/dist/index.html',
                 'config/settings.json', 'notes.md', 'backend/private.key',
                 'npm/app/backend/app.py', 'npm/SECURITY.md', 'npm/node_modules/a.js'):
        assert not release.allowed(name), name
    assert release.allowed('backend/app.py')
    assert release.allowed('frontend/src/main.jsx')
    assert release.allowed('npm/bin/reader.mjs')
    assert release.allowed('requirements-macos.lock')


@pytest.mark.skipif(not (ROOT / '.git').exists(), reason='Repackaging requires the maintainer Git checkout')
def test_release_archive_is_source_only(tmp_path):
    archive = release.build(tmp_path / 'source.tar.gz')
    with tarfile.open(archive) as source:
        members = source.getmembers()
        assert 'deepseek-reader/README.md' in source.getnames()
        assert 'deepseek-reader/PRIVACY.md' in source.getnames()
        assert 'deepseek-reader/LICENSE' in source.getnames()
        assert 'deepseek-reader/npm/bin/reader.mjs' in source.getnames()
        assert 'deepseek-reader/requirements-macos.lock' in source.getnames()
        assert all(release.allowed(member.name.removeprefix('deepseek-reader/')) for member in members)
        assert all(member.uid == member.gid == 0 and not member.uname and not member.gname for member in members)
        assert not any(member.issym() for member in members)


def test_unrelated_localhost_origin_is_rejected(tmp_path):
    client = TestClient(create_app(tmp_path / 'data', tmp_path / 'settings.json'))
    assert client.get('/api/settings', headers={'Origin': 'http://localhost:9999'}).status_code == 403
    assert client.get('/api/settings', headers={'Origin': 'http://testserver'}).status_code == 200
    assert client.get('/api/settings', headers={'Origin': 'http://127.0.0.1:5173'}).status_code == 200
