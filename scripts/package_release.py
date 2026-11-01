"""Build a source-only release, never copying local data or Git history."""
from pathlib import Path
import argparse
import hashlib
import io
import re
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]
FILES = {'.gitignore', 'README.md', 'README.en.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'PRIVACY.md', 'SECURITY.md',
         'RELEASING.md', 'requirements.txt', 'requirements-dev.txt', 'requirements-macos.lock', 'LICENSE', 'docs/reader.png'}
DIRECTORIES = {'backend', 'frontend', 'extension', 'scripts', 'tests', '.github', 'npm', 'docs'}
FRONTEND_FILES = {'package.json', 'package-lock.json', 'index.html',
                  'vite.config.js', 'playwright.config.js'}
SUFFIXES = {'.py', '.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.md',
            '.json', '.svg', '.png', '.yml', '.yaml'}
SECRET = re.compile(rb'sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|/Users/[A-Za-z0-9._-]+/')


def allowed(name):
    path = Path(name)
    if not path.parts:
        return False
    if name == 'scripts/diagnose_agent.py':
        return False
    if name in FILES:
        return True
    if path.parts[0] == 'npm':
        return name in {'npm/package.json', 'npm/README.md', 'npm/prepare.mjs', 'npm/bin/reader.mjs'} or (
            len(path.parts) == 3 and path.parts[1] == 'test' and path.suffix == '.mjs')
    if len(path.parts) < 2 or path.parts[0] not in DIRECTORIES:
        return False
    if any(p.startswith('.') or p in {'node_modules', 'dist', '__pycache__', 'test-results', 'playwright-report'} for p in path.parts[1:]):
        return False
    if path.parts[0] == 'frontend' and path.parts[1] not in {'src', 'public', 'tests'}:
        return path.name in FRONTEND_FILES and len(path.parts) == 2
    return path.suffix in SUFFIXES or name in {'scripts/paper', 'scripts/paper.ps1', 'scripts/paper.cmd'}


def build(output):
    # Tracked files only: untracked personal artifacts are never included.
    names = set(subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0'))
    names.update(name for name in FILES if (ROOT / name).is_file())
    names.update({'scripts/package_release.py', 'tests/test_release.py', '.github/workflows/ci.yml'})
    names.update({'npm/package.json', 'npm/README.md', 'npm/prepare.mjs', 'npm/bin/reader.mjs'})
    names.update({'frontend/tests/citation-navigation.spec.js'})
    names.update(path.relative_to(ROOT).as_posix() for path in (ROOT / 'npm' / 'test').glob('*.test.mjs'))
    selected = []
    for name in sorted(filter(None, names)):
        if not allowed(name):
            continue
        source = ROOT / name
        if source.is_symlink() or not source.is_file():
            raise ValueError(f'Unsafe or missing release file: {name}')
        if source.suffix not in {'.png'} and SECRET.search(source.read_bytes()):
            raise ValueError(f'Potential private content in {name}; review locally (value not printed)')
        selected.append((name, source))
    output = Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new archive name')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, 'w:gz') as archive:
        for name, source in selected:
            info = archive.gettarinfo(str(source), arcname='deepseek-reader/' + name)
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mtime = 0
            info.pax_headers = {}
            info.mode = 0o755 if name in {'scripts/paper', 'npm/bin/reader.mjs'} else 0o644
            raw = source.read_bytes()
            archive.addfile(info, io.BytesIO(raw))
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    print(f'{len(selected)} files: {output}\nSHA256: {digest}')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', help='New .tar.gz path; existing files are not overwritten')
    build(parser.parse_args().output)
