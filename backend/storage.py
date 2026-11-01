"""UTF-8 atomic writes shared by metadata and generated paper assets."""
from contextlib import contextmanager
import os
import time
import uuid


@contextmanager
def atomic_write(path):
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            yield stream
        for attempt in range(50):
            try:
                os.replace(temp, path)
                break
            except PermissionError as exc:
                # Windows readers and virus scanners can briefly block replacement.
                if os.name != 'nt' or getattr(exc, 'winerror', None) not in (5, 32, 33) or attempt == 49:
                    raise
                time.sleep(0.02)
    finally:
        temp.unlink(missing_ok=True)
