import os
from unittest.mock import Mock, patch

import pytest

from backend import assets, storage
from backend.app import load, save


def test_unicode_metadata_and_assets(tmp_path):
    path = tmp_path / '研究背景.json'
    value = {'title': '论文与研究 🧪'}
    save(path, value)
    assert path.read_bytes().decode('utf-8').find(value['title']) >= 0
    assert load(path, {}) == value
    assets.write_text(path, '读者背景：图像分割')
    assert path.read_bytes().decode('utf-8') == '读者背景：图像分割'


@pytest.mark.parametrize('platform,winerror,retries', [('nt', 32, 2), ('nt', 33, 2), ('nt', 5, 2), ('nt', 87, 0), ('posix', 32, 0)])
def test_replace_retries_only_windows_lock_errors(tmp_path, platform, winerror, retries):
    path = tmp_path / 'value.json'
    path.write_bytes(b'old')
    error = PermissionError('locked')
    error.winerror = winerror
    replace = Mock(side_effect=[error, error])
    real_replace = os.replace

    def attempt(source, target):
        if replace.call_count < 2:
            replace(source, target)
        else:
            real_replace(source, target)

    with patch.object(storage, 'os', wraps=os) as system, patch.object(storage.time, 'sleep') as sleep:
        system.name = platform
        system.O_WRONLY, system.O_CREAT, system.O_EXCL = os.O_WRONLY, os.O_CREAT, os.O_EXCL
        system.replace.side_effect = attempt
        if retries:
            assets.write_text(path, 'new')
            assert path.read_bytes() == b'new'
        else:
            with pytest.raises(PermissionError):
                assets.write_text(path, 'new')
            assert path.read_bytes() == b'old'
        assert sleep.call_count == retries
    assert not list(tmp_path.glob('*.tmp'))


def test_failed_serialization_preserves_original_and_cleans_temp(tmp_path):
    path = tmp_path / 'value.json'
    save(path, {'old': True})
    with pytest.raises(TypeError):
        save(path, {'bad': object()})
    assert load(path, {}) == {'old': True}
    assert not list(tmp_path.glob('*.tmp'))


def test_persistent_lock_has_bounded_retries(tmp_path):
    path = tmp_path / 'value.txt'
    path.write_bytes(b'old')
    error = PermissionError('locked')
    error.winerror = 32
    with patch.object(storage, 'os', wraps=os) as system, patch.object(storage.time, 'sleep') as sleep:
        system.name = 'nt'
        system.O_WRONLY, system.O_CREAT, system.O_EXCL = os.O_WRONLY, os.O_CREAT, os.O_EXCL
        system.replace.side_effect = error
        with pytest.raises(PermissionError):
            assets.write_text(path, 'new')
        assert system.replace.call_count == 50
        assert sleep.call_count == 49
    assert path.read_bytes() == b'old'
    assert not list(tmp_path.glob('*.tmp'))
