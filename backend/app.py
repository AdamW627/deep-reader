from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import queue
import re
import secrets
import shutil
import threading
import uuid
from urllib.parse import unquote, urlsplit

import httpx
import pymupdf
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import assets, prompts
from .download import MAX_BYTES, download
from .project_memory import MAX_CHARS, context_text, maintenance_due, maintenance_prompt, normalize_items, record_completed_turn

ROOT = Path(__file__).resolve().parent.parent
INSTRUCTIONS = prompts.AGENTS
WORKSPACE_FILES = ('fulltext.md', 'figures.md', 'annotations.json', 'paper.pdf')
WORKSPACE_DIRS = ('pages', 'figures')
ACTIONS = tuple(prompts.ACTIONS)
_ABSTRACT_START = re.compile(r'(?im)^[ \t]*(?:abstract|摘要)\s*[:：]?\s*')
_NEXT_SECTION = re.compile(r'(?im)^[ \t]*(?:\d+(?:\.\d+)*\.?[ \t]+)?(?:introduction|keywords|index terms|引言|关键词)\b')
_TITLE_SKIP = re.compile(r'(?i)(arxiv|published as|under review|technical report|copyright|all rights reserved)')
TITLE_VERSION = 1


def paper_title(pdf, fallback):
    """Prefer the document title; otherwise the largest text block on the first page.

    The first line of an arXiv page is usually a venue banner, not the title.
    """
    metadata = (pdf.metadata or {}).get('title') or ''
    if metadata.strip() and not _TITLE_SKIP.search(metadata):
        return metadata.strip()[:240]
    page = pdf[0]
    height = page.rect.height
    groups, current = [], None
    for block in page.get_text('dict')['blocks']:
        for line in block.get('lines', []):
            spans = [s for s in line.get('spans', []) if s['text'].strip()]
            if not spans:
                continue
            size = max(s['size'] for s in spans)
            top = line['bbox'][1]
            text = ''
            for span in spans:
                gap = span['bbox'][0] - spans[0]['bbox'][0] if text == '' else span['bbox'][0] - previous
                text += (' ' if text and gap > span['size'] * 0.12 else '') + span['text']
                previous = span['bbox'][2]
            text = text.strip()
            if top < height * 0.8 and current and abs(current['size'] - size) < 0.5 and top - current['bottom'] < size * 0.9:
                current['lines'].append(text)
                current['bottom'] = line['bbox'][3]
            else:
                current = {'size': size, 'top': top, 'bottom': line['bbox'][3], 'lines': [text]}
                groups.append(current)
    groups = [g for g in groups if g['size'] >= 12 and g['top'] < height * 0.6 and not _TITLE_SKIP.search(' '.join(g['lines']))]
    if groups:
        best = max(groups, key=lambda g: g['size'])
        title = re.sub(r'\s+', ' ', ' '.join(best['lines'])).strip(' .')
        if len(title) > 8:
            return title[:240]
    return fallback or 'Untitled paper'


def reading_brief(pages):
    """Free preview from extracted text. Never calls a model."""
    raw = '\n'.join((page.get('text') or '') for page in pages[:3])
    raw = re.sub(r'-\r?\n(?=[a-z])', '', raw)
    kind = ''
    body = raw
    start = _ABSTRACT_START.search(raw)
    if start:
        kind = 'abstract'
        body = raw[start.end():]
        end = _NEXT_SECTION.search(body)
        if end:
            body = body[:end.start()]
    excerpt = re.sub(r'\s+', ' ', body).strip()
    if len(excerpt) > 700:
        cut = excerpt[:700].rsplit(' ', 1)[0]
        excerpt = (cut or excerpt[:700]).rstrip('，,;；') + '…'
    return {'brief': excerpt, 'brief_kind': kind or ('opening' if excerpt else '')}


def agent_error(result, key=''):
    for event in reversed(result.events):
        reason = event.get('data', {}).get('reason', {})
        if reason.get('kind') == 'error':
            error = reason.get('error', {})
            text = f"Harness 请求失败：{error.get('message', 'Unknown error')} ({error.get('code', '')})"
            if error.get('status') == 404:
                text += '。DeepSeek 官方 Harness 地址应为 https://api.deepseek.com/anthropic'
            return text.replace(key, '[redacted]')[:1500] if key else text[:1500]
    return 'Harness 未返回回复，请测试连接后重试。'


def now():
    return datetime.now(timezone.utc).isoformat()


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path, value, private=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
    os.replace(temp, path)


class ImportBody(BaseModel):
    url: str = Field(min_length=1, max_length=8192)
    title: str | None = Field(default=None, max_length=1000)
    project_id: str = 'default'


class ProjectBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class Selection(BaseModel):
    text: str = Field(max_length=100000)
    page: int = Field(ge=1)
    rects: list = Field(default_factory=list, max_length=1000)


class ChatBody(BaseModel):
    conversation_id: str = 'default'
    message: str = Field(min_length=1, max_length=100000)
    selection: Selection | None = None
    page: int | None = Field(default=None, ge=1)
    action: str | None = Field(default=None, pattern='^(' + '|'.join(ACTIONS) + ')$')


class TranslateBody(BaseModel):
    conversation_id: str = 'default'
    selection: Selection


def event_stream(events):
    while True:
        try:
            event = events.get(timeout=15)
        except queue.Empty:
            yield ': keepalive\n\n'
            continue
        if event is None:
            break
        yield 'data: ' + json.dumps(event, ensure_ascii=False) + '\n\n'


class ProfileBody(BaseModel):
    text: str = Field(default='', max_length=8000)


class ProjectMemoryItem(BaseModel):
    text: str = Field(min_length=1, max_length=700)
    kind: str = Field(default='project', max_length=40)
    source: str = Field(default='', max_length=240)
    id: str | None = None
    updated_at: str | None = None


class ProjectMemoryBody(BaseModel):
    items: list[ProjectMemoryItem] = Field(default_factory=list, max_length=40)


class ConversationPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)
    archived: bool | None = None


class SettingsBody(BaseModel):
    api_key: str | None = Field(default=None, max_length=4096)
    model: str = Field(default='deepseek-flash', min_length=1, max_length=200)
    base_url: str = Field(default='https://api.deepseek.com/anthropic', max_length=2048)


class AnnotationBody(BaseModel):
    page: int = Field(ge=1)
    text: str = Field(default='', max_length=100000)
    note: str = Field(default='', max_length=100000)
    color: str = Field(default='#facc15', max_length=50)
    rects: list = Field(default_factory=list, max_length=1000)
    id: str | None = None
    type: str = Field(default='highlight', max_length=50)


def create_app(data_dir=None, settings_path=None):
    data = Path(data_dir or os.environ.get('PDF_READER_DATA_DIR', ROOT / '.data')).resolve()
    data.mkdir(parents=True, exist_ok=True)
    data.chmod(0o700)
    papers = data / 'papers'
    papers.mkdir(exist_ok=True)
    # Credentials intentionally live outside the project/git tree.
    settings_file = Path(settings_path or os.environ.get('PDF_READER_SETTINGS_PATH', Path.home() / '.config/deepseek-pdf-reader/settings.json'))
    locks: dict[str, threading.Lock] = {}
    storage_lock = threading.RLock()
    token_file = data / 'capture-token.json'
    if not token_file.exists():
        save(token_file, {'token': secrets.token_urlsafe(32)})
    token = os.environ.get('PDF_READER_CAPTURE_TOKEN') or load(token_file, {})['token']

    def settings():
        value = load(settings_file, {})
        if value.get('base_url', '').rstrip('/') in ('https://api.deepseek.com', 'https://api.deepseek.com/v1'):
            value['base_url'] = 'https://api.deepseek.com/anthropic'
            save(settings_file, value, private=True)
        return {'api_key': value.get('api_key', os.environ.get('DEEPSEEK_API_KEY', '')), 'model': value.get('model', 'deepseek-flash'), 'base_url': value.get('base_url', 'https://api.deepseek.com/anthropic')}

    projects_file = data / 'projects.json'
    if not projects_file.exists():
        save(projects_file, [{'id': 'default', 'name': '默认项目', 'path': str(papers)}])

    def project(id):
        found = next((p for p in load(projects_file, []) if p['id'] == id), None)
        if not found:
            raise HTTPException(404, 'Project not found')
        return found

    def memory_file(project_id):
        return data / 'project-memory' / f'{project_id}.json'

    def project_memory(project_id):
        value = load(memory_file(project_id), {'items': [], 'candidates': [], 'turns_since_maintenance': 0, 'last_maintenance_at': None})
        value.setdefault('turns_since_maintenance', len(value.get('candidates', [])))
        value.setdefault('last_maintenance_at', None)
        value['items'] = normalize_items(value.get('items', []))
        value.setdefault('candidates', [])
        return value

    def append_memory_candidate(project_id, paper_id, conversation_id, user_message):
        with storage_lock:
            state = project_memory(project_id)
            paper = load(papers / paper_id / 'paper.json', {})
            entry = {'id': uuid.uuid4().hex, 'paper': paper.get('title', ''), 'conversation_id': conversation_id,
                     'source': f"{paper.get('title', '论文')} / 对话 {conversation_id}",
                     'user_message': user_message['content'][:1600]}
            state.setdefault('candidates', []).append(entry)
            state['candidates'] = state['candidates'][-20:]
            state['turns_since_maintenance'] = state.get('turns_since_maintenance', 0) + 1
            state['last_maintenance_at'] = state.get('last_maintenance_at') or now()
            state['updated_at'] = now()
            save(memory_file(project_id), state)

    def run_memory_maintenance(project_id, api_settings):
        lock = locks.setdefault('memory:' + project_id, threading.Lock())
        if not lock.acquire(blocking=False):
            return False
        try:
            value = project_memory(project_id)
            if not value['candidates'] or not api_settings['api_key']:
                return False
            snapshot_candidates = value['candidates'][:]
            snapshot_ids = {item.get('id') for item in snapshot_candidates}
            snapshot_count = len(snapshot_candidates)
            snapshot_items = value['items'][:]
            from deepseek_harness import DeepSeekHarness
            project_item = project(project_id)
            workspace = data / 'project-memory-workspaces' / project_id
            workspace.mkdir(parents=True, exist_ok=True)
            prompt = maintenance_prompt(project_item['name'], snapshot_items, snapshot_candidates)
            home = data / 'harness' / 'project-memory' / project_id
            with DeepSeekHarness(dsh_home=str(home), cwd=str(workspace), runtime_cwd=str(workspace), provider='deepseek-official', model=api_settings['model'], api_key=api_settings['api_key'], base_url=api_settings['base_url'], request_timeout_seconds=180) as harness:
                result = harness.run(prompt, session_id='memory-' + project_id + '-' + uuid.uuid4().hex)
            if result.finish_reason == 'error' or not result.final_response:
                return False
            raw = result.final_response.strip()
            if raw.startswith('```'):
                raw = raw.split('\n', 1)[-1].rsplit('```', 1)[0]
            parsed = json.loads(raw)
            items = normalize_items(parsed.get('items', []))
            if sum(len(item['text']) for item in items) > MAX_CHARS:
                return False
            with storage_lock:
                current = project_memory(project_id)
                current['items'] = items
                current['candidates'] = [item for item in current.get('candidates', []) if item.get('id') not in snapshot_ids]
                current['turns_since_maintenance'] = max(0, current.get('turns_since_maintenance', 0) - snapshot_count)
                current['last_maintenance_at'] = now()
                current['updated_at'] = now()
                save(memory_file(project_id), current)
            return True
        finally:
            lock.release()

    def public_settings():
        s = settings()
        return {'has_api_key': bool(s['api_key']), 'model': s['model'], 'base_url': s['base_url']}

    def paper_dir(id):
        if not re.fullmatch(r'[a-f0-9]{32}', id):
            raise HTTPException(404, 'Paper not found')
        folder = (papers / id).resolve()
        if (not folder.is_relative_to(papers.resolve())
                or not (folder / 'paper.json').is_file()
                or not (folder / 'paper.json').resolve().is_relative_to(folder)):
            raise HTTPException(404, 'Paper not found')
        return folder

    def conversation_dir(id, conversation_id):
        folder = paper_dir(id)
        if conversation_id == 'default':
            return folder
        # Check syntax before using an untrusted identifier in any filesystem path.
        if not re.fullmatch(r'[a-f0-9]{32}', conversation_id):
            raise HTTPException(404, 'Conversation not found')
        target = data / 'conversations' / id / conversation_id
        if not (target / 'conversation.json').is_file():
            raise HTTPException(404, 'Conversation not found')
        return target

    profile_file = data / 'reader_profile.md'
    asset_locks: dict[str, threading.Lock] = {}

    def prepare_paper(folder):
        """Migrate older papers to the current sources and refresh shared agent files."""
        with asset_locks.setdefault(folder.name, threading.Lock()):
            assets.ensure(folder)
            for name, text in (('AGENTS.md', INSTRUCTIONS), ('reader_profile.md', profile_text())):
                target = folder / name
                if not text:
                    target.unlink(missing_ok=True)
                elif not target.exists() or target.read_text() != text:
                    target.write_text(text)

    def profile_text():
        return profile_file.read_text().strip() if profile_file.exists() else ''

    def build_workspace(folder, workspace, card=True):
        # Only paper sources enter the agent cwd; messages and restore markers stay
        # outside it. This limits ordinary file discovery, not an OS-level sandbox.
        workspace.mkdir(parents=True, exist_ok=True)
        names = list(WORKSPACE_FILES) + ['AGENTS.md', 'reader_profile.md', 'project_memory.md'] + (['paper_card.md'] if card else [])
        for name in names + ['paper_card.md']:
            target, source = workspace / name, folder / name
            if target.exists():
                target.chmod(0o600)
            if name not in names or not source.exists():
                target.unlink(missing_ok=True)
                continue
            shutil.copyfile(source, target)
            target.chmod(0o400)
        for directory in WORKSPACE_DIRS:
            source_dir, target_dir = folder / directory, workspace / directory
            target_dir.mkdir(exist_ok=True)
            wanted = {p.name for p in source_dir.iterdir()} if source_dir.is_dir() else set()
            for target in target_dir.iterdir():
                if target.name not in wanted or target.stat().st_ino != (source_dir / target.name).stat().st_ino:
                    target.unlink()
            for name in wanted:
                target = target_dir / name
                if target.exists():
                    continue
                try:
                    os.link(source_dir / name, target)
                except OSError:
                    shutil.copyfile(source_dir / name, target)
                target.chmod(0o400)
        return workspace

    def conversation_workspace(folder, conversation):
        return build_workspace(folder, conversation / 'workspace')

    def add_pdf(raw, title, source=None, project_id='default', filename=None):
        project(project_id)
        if len(raw) > MAX_BYTES:
            raise HTTPException(413, 'PDF exceeds 60 MB limit')
        if not raw.lstrip().startswith(b'%PDF-'):
            raise HTTPException(400, 'Not a PDF file')
        try:
            with pymupdf.open(stream=raw, filetype='pdf') as pdf:
                if pdf.needs_pass or not pdf.page_count:
                    raise ValueError('Encrypted or empty PDF')
                texts = [{'page': i + 1, 'text': p.get_text(), 'width': p.rect.width, 'height': p.rect.height} for i, p in enumerate(pdf)]
                pdf_title = paper_title(pdf, title)
        except Exception:
            raise HTTPException(400, 'PDF is invalid, empty, or password protected')
        id = uuid.uuid4().hex
        folder = papers / id
        folder.mkdir()
        meta = {'id': id, 'title': pdf_title, 'title_version': TITLE_VERSION, 'filename': filename or (title or 'paper') + '.pdf', 'page_count': len(texts), 'pages': len(texts), 'created_at': now(), 'source_url': source, 'size': len(raw), 'pdf_url': f'/api/papers/{id}/pdf'}
        meta['project_id'] = project_id
        (folder / 'paper.pdf').write_bytes(raw)
        save(folder / 'text.json', texts)
        save(folder / 'annotations.json', [])
        save(folder / 'messages.json', [])
        assets.build(folder, meta['title'])
        (folder / 'AGENTS.md').write_text(INSTRUCTIONS)
        save(folder / 'paper.json', meta)
        return meta

    app = FastAPI(title='DeepSeek PDF Reader')
    app.state.data_dir = data
    local_origin = r'http://(localhost|127\.0\.0\.1|\[::1\]):5173'
    app.add_middleware(CORSMiddleware, allow_origin_regex=local_origin + r'|chrome-extension://[a-p]{32}', allow_methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allow_headers=['Content-Type', 'X-Capture-Token'])

    @app.middleware('http')
    async def guard(request: Request, call_next):
        origin = request.headers.get('origin', '')
        if request.method != 'OPTIONS' and origin:
            extension = re.fullmatch(r'chrome-extension://[a-p]{32}', origin)
            if extension:
                if request.url.path != '/api/papers/import' or not secrets.compare_digest(request.headers.get('X-Capture-Token', ''), token):
                    return JSONResponse({'detail': 'Extension import requires a paired X-Capture-Token'}, 403)
            elif origin != str(request.base_url).rstrip('/') and not re.fullmatch(local_origin, origin):
                return JSONResponse({'detail': 'Untrusted request origin'}, 403)
        if request.url.hostname not in ('localhost', '127.0.0.1', '::1', 'testserver'):
            return JSONResponse({'detail': 'Untrusted Host'}, 403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.get('/api/health')
    def health():
        try:
            version = importlib.metadata.version('deepseek-harness-sdk')
        except importlib.metadata.PackageNotFoundError:
            version = None
        return {'status': 'ok', 'harness': {'installed': bool(version), 'configured': public_settings()['has_api_key'], 'version': version, 'provider': 'deepseek-official', 'model': settings()['model']}}

    @app.get('/api/settings')
    def get_settings():
        return public_settings()

    @app.put('/api/settings')
    def put_settings(body: SettingsBody):
        from .download import public_target
        public_target(body.base_url)
        s = settings()
        s.update(model=body.model, base_url=body.base_url.rstrip('/'))
        if body.api_key is not None:
            s['api_key'] = body.api_key.strip()
        save(settings_file, s, private=True)
        return public_settings()

    @app.post('/api/settings/test')
    def test_settings():
        import tempfile
        from deepseek_harness import DeepSeekHarness
        s = settings()
        if not s['api_key']:
            return {'ok': False, 'detail': '请先保存 API Key'}
        try:
            with tempfile.TemporaryDirectory() as tmp:
                with DeepSeekHarness(cwd=tmp, dsh_home=tmp + '/home', api_key=s['api_key'], base_url=s['base_url'], model=s['model'], max_tokens=2048, request_timeout_seconds=60) as harness:
                    result = harness.run('Reply with OK only.')
                if result.finish_reason == 'error' or not result.final_response:
                    return {'ok': False, 'detail': agent_error(result, s['api_key'])}
                return {'ok': True, 'detail': 'Harness 连接成功：' + result.final_response[:100]}
        except Exception as exc:
            return {'ok': False, 'detail': str(exc).replace(s['api_key'], '[redacted]')[:1000]}

    @app.get('/api/profile')
    def get_profile():
        return {'text': profile_text()}

    @app.put('/api/profile')
    def put_profile(body: ProfileBody):
        assets.write_text(profile_file, body.text.strip())
        return {'text': profile_text()}

    @app.get('/api/capture-token')
    def capture_token():
        return {'token': token}

    @app.get('/api/projects')
    def list_projects():
        return load(projects_file, [])

    @app.post('/api/projects')
    def create_project(body: ProjectBody):
        name = body.name.strip()
        if not name:
            raise HTTPException(400, 'Project name is required')
        with storage_lock:
            values = load(projects_file, [])
            item = {'id': uuid.uuid4().hex, 'name': name, 'path': str(papers)}
            save(projects_file, values + [item])
        return item

    @app.get('/api/projects/{id}/memory')
    def get_project_memory(id: str):
        project(id)
        value = project_memory(id)
        return {key: value.get(key) for key in ('items', 'turns_since_maintenance', 'last_maintenance_at', 'updated_at')}

    @app.put('/api/projects/{id}/memory')
    def put_project_memory(id: str, body: ProjectMemoryBody):
        project(id)
        items = normalize_items([item.model_dump(exclude_none=True) for item in body.items])
        if sum(len(item['text']) for item in items) > MAX_CHARS:
            raise HTTPException(413, 'Project memory exceeds 12000 characters')
        with storage_lock:
            state = project_memory(id)
            state['items'] = items
            state['updated_at'] = now()
            save(memory_file(id), state)
        return {key: state.get(key) for key in ('items', 'turns_since_maintenance', 'last_maintenance_at', 'updated_at')}

    @app.post('/api/projects/{id}/memory/maintain')
    def maintain_project_memory(id: str):
        project(id)
        if not settings()['api_key']:
            raise HTTPException(400, 'DeepSeek API key is not configured')
        threading.Thread(target=run_memory_maintenance, args=(id, settings()), daemon=True).start()
        return {'status': 'started'}

    @app.on_event('startup')
    def resume_due_memory_maintenance():
        def scan():
            while True:
                for item in load(projects_file, []):
                    state = project_memory(item['id'])
                    if state.get('candidates') and maintenance_due(state):
                        threading.Thread(target=run_memory_maintenance, args=(item['id'], settings()), daemon=True).start()
                threading.Event().wait(3600)
        threading.Thread(target=scan, name='project-memory-maintenance', daemon=True).start()

    def retitle(folder):
        """Re-derive the title of a paper imported before the current TITLE_VERSION."""
        meta = load(folder / 'paper.json', {})
        if not meta or meta.get('title_version') == TITLE_VERSION:
            return
        try:
            with pymupdf.open(folder / 'paper.pdf') as pdf:
                title = paper_title(pdf, meta.get('title') or Path(meta.get('filename') or 'paper').stem)
        except Exception:
            return
        old = meta.get('title')
        meta.update(title=title, title_version=TITLE_VERSION)
        save(folder / 'paper.json', meta)
        fulltext = folder / 'fulltext.md'
        if title != old and fulltext.exists():
            text = fulltext.read_text(errors='replace')
            if text.startswith('# '):
                rest = text.split('\n', 1)[1] if '\n' in text else ''
                fulltext.write_text(f'# {title}\n{rest}')
            else:
                fulltext.write_text(f'# {title}\n\n{text}')

    @app.on_event('startup')
    def repair_titles():
        for folder in papers.glob('[a-f0-9]' * 32):
            retitle(folder)

    @app.get('/api/papers')
    def list_papers(project_id: str | None = None):
        if project_id is not None:
            project(project_id)
        items = [load(p, {}) for p in papers.glob('*/paper.json')]
        return sorted([p for p in items if project_id is None or p.get('project_id', 'default') == project_id], key=lambda p: p['created_at'], reverse=True)

    @app.post('/api/papers/upload')
    async def upload(file: UploadFile = File(...), project_id: str = 'default'):
        chunks, total = [], 0
        while chunk := await file.read(65536):
            total += len(chunk)
            if total > MAX_BYTES:
                raise HTTPException(413, 'PDF exceeds 60 MB limit')
            chunks.append(chunk)
        filename = Path((file.filename or 'paper.pdf').replace('\\', '/')).name
        return await asyncio.to_thread(add_pdf, b''.join(chunks), Path(filename).stem, None, project_id, filename)

    @app.post('/api/papers/import')
    def import_paper(body: ImportBody):
        project(body.project_id)
        raw, url = download(body.url)
        filename = Path(unquote(urlsplit(url).path)).name
        if not filename.lower().endswith('.pdf'):
            filename = 'paper.pdf'
        return add_pdf(raw, body.title, url, body.project_id, filename)

    @app.get('/api/papers/{id}/details')
    def paper_details(id: str):
        folder = paper_dir(id)
        pdf_path = (folder / 'paper.pdf').resolve()
        if not pdf_path.is_relative_to(folder) or not pdf_path.is_file():
            raise HTTPException(404, 'Paper PDF not found')
        meta = load(folder / 'paper.json', {})
        project_id = meta.get('project_id', 'default')
        source = meta.get('source_url')
        # Do not expose credentials embedded in legacy source URLs.
        try:
            parsed = urlsplit(source or '')
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
                source = None
        except ValueError:
            source = None
        return {
            'id': id, 'title': meta.get('title', ''), 'filename': meta.get('filename', 'paper.pdf'),
            'page_count': meta.get('page_count', meta.get('pages')),
            'size': pdf_path.stat().st_size, 'created_at': meta.get('created_at'),
            'project_id': project_id, 'project_name': project(project_id)['name'],
            'source_url': source, 'pdf_url': f'/api/papers/{id}/pdf',
            'pdf_path': str(pdf_path), 'metadata_dir': str(folder),
        }

    @app.get('/api/papers/{id}/pdf')
    def pdf(id: str):
        return FileResponse(paper_dir(id) / 'paper.pdf', media_type='application/pdf')

    @app.get('/api/papers/{id}/text')
    def text(id: str, page: int | None = None):
        values = load(paper_dir(id) / 'text.json', [])
        if page is not None:
            if not 1 <= page <= len(values):
                raise HTTPException(400, 'Page out of range')
            values = [values[page - 1]]
        return {'pages': values}

    @app.get('/api/papers/{id}/blocks')
    def blocks(id: str):
        folder = paper_dir(id)
        prepare_paper(folder)
        return load(folder / 'blocks.json', {'pages': []})

    @app.get('/api/papers/{id}/figures')
    def figures(id: str):
        folder = paper_dir(id)
        prepare_paper(folder)
        return load(folder / 'figures.json', [])

    cards_running: set[str] = set()

    def card_state(folder):
        state = load(folder / 'card.json', {'status': 'missing'})
        if state['status'] == 'running' and folder.name not in cards_running:
            state = {'status': 'error', 'error': '生成被中断（服务重启），请重试。'}
        content = (folder / 'paper_card.md').read_text() if (folder / 'paper_card.md').exists() else ''
        if content and state['status'] == 'missing':
            state['status'] = 'done'
        try:
            brief = reading_brief(load(folder / 'text.json', []))
        except Exception:
            brief = {'brief': '', 'brief_kind': ''}
        return {**state, 'content': content, **brief}

    def generate_card(id, folder):
        s = settings()
        try:
            from deepseek_harness import DeepSeekHarness
            prepare_paper(folder)
            workspace = build_workspace(folder, data / 'cards' / id / 'workspace', card=False)
            home = data / 'harness' / id / 'card'
            home.mkdir(parents=True, exist_ok=True)
            with DeepSeekHarness(dsh_home=str(home), cwd=str(workspace), runtime_cwd=str(workspace), provider='deepseek-official', model=s['model'], api_key=s['api_key'], base_url=s['base_url'], request_timeout_seconds=300) as harness:
                result = harness.start_session('card-' + uuid.uuid4().hex).run(prompts.CARD)
            if result.finish_reason == 'error' or not result.final_response.strip():
                save(folder / 'card.json', {'status': 'error', 'error': agent_error(result, s['api_key']), 'updated_at': now()})
                return
            assets.write_text(folder / 'paper_card.md', result.final_response.strip() + '\n')
            save(folder / 'card.json', {'status': 'done', 'updated_at': now()})
        except Exception as exc:
            message = str(exc).replace(s['api_key'], '[redacted]') if s['api_key'] else str(exc)
            save(folder / 'card.json', {'status': 'error', 'error': message[:1500], 'updated_at': now()})
        finally:
            cards_running.discard(id)

    @app.get('/api/papers/{id}/card')
    def get_card(id: str):
        return card_state(paper_dir(id))

    @app.post('/api/papers/{id}/card')
    def create_card(id: str):
        folder = paper_dir(id)
        if not settings()['api_key']:
            raise HTTPException(400, 'DeepSeek API key is not configured')
        with storage_lock:
            if id not in cards_running:
                cards_running.add(id)
                save(folder / 'card.json', {'status': 'running', 'updated_at': now()})
                threading.Thread(target=generate_card, args=(id, folder), daemon=True).start()
        return card_state(folder)

    @app.get('/api/papers/{id}/annotations')
    def annotations(id: str):
        return load(paper_dir(id) / 'annotations.json', [])

    @app.post('/api/papers/{id}/annotations')
    def add_annotation(id: str, body: AnnotationBody):
        folder = paper_dir(id)
        if body.page > load(folder / 'paper.json', {})['page_count']:
            raise HTTPException(400, 'Page out of range')
        annotation = body.model_dump()
        annotation.update(id=body.id or uuid.uuid4().hex, updated_at=now())
        with storage_lock:
            values = load(folder / 'annotations.json', [])
            old = next((a for a in values if a['id'] == annotation['id']), None)
            annotation['created_at'] = old['created_at'] if old else now()
            save(folder / 'annotations.json', [a for a in values if a['id'] != annotation['id']] + [annotation])
        return annotation

    @app.delete('/api/papers/{id}/annotations/{annotation_id}')
    def delete_annotation(id: str, annotation_id: str):
        folder = paper_dir(id)
        with storage_lock:
            values = load(folder / 'annotations.json', [])
            if not any(a['id'] == annotation_id for a in values):
                raise HTTPException(404, 'Annotation not found')
            save(folder / 'annotations.json', [a for a in values if a['id'] != annotation_id])
        return {'ok': True}

    @app.get('/api/papers/{id}/conversations')
    def conversations(id: str):
        folder = paper_dir(id)
        legacy_meta = load(folder / 'legacy-conversation.json', {})
        legacy = {'id': 'default', 'title': legacy_meta.get('title', '原有对话'), 'created_at': load(folder / 'paper.json', {})['created_at']}
        with storage_lock:
            values = [load(p, {}) for p in (data / 'conversations' / id).glob('*/conversation.json')
                      if re.fullmatch(r'[a-f0-9]{32}', p.parent.name)]
        for item in values:
            item.setdefault('archived', False)
            item.setdefault('title_source', 'auto')
        return [legacy] + sorted(values, key=lambda c: c['created_at'])

    @app.post('/api/papers/{id}/conversations')
    def create_conversation(id: str):
        paper_dir(id)
        item = {'id': uuid.uuid4().hex, 'title': '新对话', 'title_source': 'auto', 'archived': False, 'created_at': now()}
        folder = data / 'conversations' / id / item['id']
        with storage_lock:
            save(folder / 'messages.json', [])
            save(folder / 'conversation.json', item)
        return item

    def suggested_title(history, current):
        for message in history:
            if message.get('role') != 'user':
                continue
            text = ' '.join(str(message.get('content', '')).split())
            text = re.sub(r'^(?:你好[，,。.!！?？\s]*|hi[,.!\s]*|hello[,.!\s]*)', '', text, flags=re.I).strip()
            if len(text) >= 4:
                return text[:40].rstrip() + ('…' if len(text) > 40 else '')
        return current

    @app.patch('/api/papers/{id}/conversations/{conversation_id}')
    def patch_conversation(id: str, conversation_id: str, body: ConversationPatch):
        conversation = conversation_dir(id, conversation_id)
        if conversation_id == 'default' and body.archived is True:
            raise HTTPException(400, 'Default conversation cannot be archived')
        if body.title is None and body.archived is None:
            raise HTTPException(400, 'No conversation fields provided')
        if body.title is not None and not body.title.strip():
            raise HTTPException(400, 'Title is required')
        with storage_lock:
            if conversation_id == 'default':
                meta_path = conversation / 'legacy-conversation.json'
                meta = load(meta_path, {'id': 'default', 'title': '原有对话', 'created_at': load(conversation / 'paper.json', {})['created_at'], 'archived': False, 'title_source': 'auto'})
            else:
                meta_path = conversation / 'conversation.json'
                meta = load(meta_path, {})
            if body.title is not None:
                meta['title'] = body.title.strip()
                meta['title_source'] = 'manual'
            if body.archived is not None:
                meta['archived'] = body.archived
            save(meta_path, meta)
        return meta

    @app.post('/api/papers/{id}/conversations/{conversation_id}/suggest-title')
    def suggest_conversation_title(id: str, conversation_id: str):
        conversation = conversation_dir(id, conversation_id)
        history = load(conversation / 'messages.json', [])
        if conversation_id == 'default':
            meta = load(conversation / 'legacy-conversation.json', {'id': 'default', 'title': '原有对话', 'created_at': load(conversation / 'paper.json', {})['created_at'], 'archived': False, 'title_source': 'auto'})
        else:
            meta = load(conversation / 'conversation.json', {})
        if history and meta.get('title_source', 'auto') == 'auto':
            meta['title'] = suggested_title(history, meta.get('title', '新对话'))
            if conversation_id == 'default':
                save(conversation / 'legacy-conversation.json', meta)
            else:
                save(conversation / 'conversation.json', meta)
        return meta

    @app.delete('/api/papers/{id}/conversations/{conversation_id}')
    def delete_conversation(id: str, conversation_id: str):
        if conversation_id == 'default':
            paper_dir(id)
            raise HTTPException(400, 'Default conversation cannot be deleted')
        conversation = conversation_dir(id, conversation_id)
        with storage_lock:
            shutil.rmtree(conversation)
            harness = data / 'harness' / id / conversation_id
            if harness.is_dir():
                shutil.rmtree(harness)
        return {'ok': True}

    def record_message(conversation, role, content, conversation_id='default', selection=None, page=None, action=None, trace=None):
        with storage_lock:
            history = load(conversation / 'messages.json', [])
            if role == 'user' and not history and conversation_id != 'default':
                meta = load(conversation / 'conversation.json', {})
                if meta.get('title_source', 'auto') == 'auto':
                    meta['title'] = suggested_title([{'role': 'user', 'content': content}], '新对话')
                    save(conversation / 'conversation.json', meta)
            history.append({'id': uuid.uuid4().hex, 'role': role, 'content': content, 'created_at': now(), **({'trace': trace} if role == 'assistant' and trace else {}), **({'selection': selection, 'page': page, 'action': action} if role == 'user' else {})})
            save(conversation / 'messages.json', history)

    @app.get('/api/papers/{id}/messages')
    def messages(id: str, conversation_id: str = 'default'):
        return load(conversation_dir(id, conversation_id) / 'messages.json', [])

    def direct_messages(s, system, user, max_tokens):
        """Stream one model turn straight from the API, with no agent, tools or history."""
        url = s['base_url'].rstrip('/') + '/v1/messages'
        headers = {'x-api-key': s['api_key'], 'anthropic-version': '2023-06-01', 'content-type': 'application/json'}
        payload = {'model': s['model'], 'max_tokens': max_tokens, 'stream': True, 'thinking': {'type': 'disabled'}, 'system': system, 'messages': [{'role': 'user', 'content': user}]}
        with httpx.stream('POST', url, headers=headers, json=payload, timeout=60) as response:
            if response.status_code != 200:
                detail = response.read().decode(errors='replace').replace(s['api_key'], '[redacted]')[:500]
                raise RuntimeError(f'翻译请求失败（{response.status_code}）：{detail}')
            for line in response.iter_lines():
                if not line.startswith('data: '):
                    continue
                event = json.loads(line[6:])
                if event.get('type') == 'content_block_delta' and event.get('delta', {}).get('type') == 'text_delta':
                    yield event['delta']['text']
                if event.get('type') == 'error':
                    raise RuntimeError('翻译请求失败：' + str(event.get('error', ''))[:300])

    @app.post('/api/papers/{id}/translate')
    def translate(id: str, body: TranslateBody):
        """Translate the selected passage directly. Nothing else from the paper is sent."""
        folder = paper_dir(id)
        conversation = conversation_dir(id, body.conversation_id)
        if body.selection.page > load(folder / 'paper.json', {})['page_count']:
            raise HTTPException(400, 'Page out of range')
        lock = locks.setdefault(id + ':' + body.conversation_id, threading.Lock())
        if not lock.acquire(blocking=False):
            raise HTTPException(409, 'This conversation already has an active agent turn')
        events = queue.Queue()
        s = settings()

        def worker():
            try:
                record_message(conversation, 'user', '翻译这段', body.conversation_id, body.selection.model_dump(), body.selection.page, 'translate')
                source = body.selection.text.strip()[:6000]
                key = hashlib.sha256('\n'.join((s['model'], prompts.TRANSLATE, source)).encode()).hexdigest()
                cache_file = folder / 'translations.json'
                with storage_lock:
                    text = load(cache_file, {}).get(key)
                if text:
                    events.put({'type': 'delta', 'content': text})
                else:
                    if not s['api_key']:
                        events.put({'type': 'error', 'content': 'DeepSeek API key is not configured. Open Settings and save your API key.', 'code': 'setup_required'})
                        return
                    parts = []
                    for chunk in direct_messages(s, prompts.TRANSLATE, source, 4000):
                        parts.append(chunk)
                        events.put({'type': 'delta', 'content': chunk})
                    text = ''.join(parts).strip()
                    if not text:
                        events.put({'type': 'error', 'content': '翻译没有返回内容，请重试。'})
                        return
                    with storage_lock:
                        cache = load(cache_file, {})
                        cache[key] = text
                        save(cache_file, cache)
                record_message(conversation, 'assistant', text)
                events.put({'type': 'done', 'content': None})
            except Exception as exc:
                message = str(exc)
                if s['api_key']:
                    message = message.replace(s['api_key'], '[redacted]')
                events.put({'type': 'error', 'content': message[:2000]})
            finally:
                lock.release()
                events.put(None)

        threading.Thread(target=worker, daemon=True).start()
        return StreamingResponse(event_stream(events), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    @app.post('/api/papers/{id}/chat')
    def chat(id: str, body: ChatBody):
        folder = paper_dir(id)
        conversation = conversation_dir(id, body.conversation_id)
        if (body.page or 1) > load(folder / 'paper.json', {})['page_count'] or (body.selection and body.selection.page > load(folder / 'paper.json', {})['page_count']):
            raise HTTPException(400, 'Page out of range')
        lock = locks.setdefault(id + ':' + body.conversation_id, threading.Lock())
        if not lock.acquire(blocking=False):
            raise HTTPException(409, 'This conversation already has an active agent turn')
        events = queue.Queue()
        s = settings()
        def emit(type, content=None, **extra):
            events.put({'type': type, 'content': content, **extra})
        from backend.trace import TraceCollector, describe, step_text
        trace = TraceCollector(s['api_key'])
        assistant_saved = False
        def append_message(role, content):
            record_message(conversation, role, content, body.conversation_id, body.selection.model_dump() if body.selection else None, body.page, body.action, trace.items)
        def worker():
            nonlocal assistant_saved
            try:
                append_message('user', body.message)
                if not s['api_key']:
                    emit('error', 'DeepSeek API key is not configured. Open Settings and save your API key.', code='setup_required')
                    return
                from deepseek_harness import DeepSeekHarness
                emit('status', '正在准备论文资料')
                prepare_paper(folder)
                emit('status', '正在启动 Agent')
                home = data / 'harness' / id
                workspace = folder
                session_id = 'paper-' + id
                if body.conversation_id != 'default':
                    home = home / body.conversation_id
                    workspace = conversation_workspace(folder, conversation)
                    session_id += '-conversation-' + body.conversation_id
                home.mkdir(parents=True, exist_ok=True)
                # No permission overrides or automatic approval callbacks are installed.
                with DeepSeekHarness(dsh_home=str(home), cwd=str(workspace), runtime_cwd=str(workspace), provider='deepseek-official', model=s['model'], api_key=s['api_key'], base_url=s['base_url'], request_timeout_seconds=180) as harness:
                    marker = conversation / 'session.json'
                    session = harness.resume_session(session_id) if marker.exists() else harness.start_session(session_id)
                    # Materialize the session before writing the restore marker, including interrupted turns.
                    session.get_working_directory()
                    save(marker, {'session_id': session_id})
                    def notification(n):
                        if n.method == 'session.event':
                            event = n.payload.get('event', {})
                            kind = event.get('type', '')
                            for item in trace.accept(event):
                                emit('trace', item)
                            label = describe(event)
                            if label:
                                emit('status', label)
                            # Harness SDK forwards only completed model steps, not token chunks.
                            text = step_text(event)
                            if text:
                                emit('step', text)
                    prompt = prompts.turn_prompt(body.message, body.selection.model_dump() if body.selection else None, body.page, body.action)
                    paper_meta = load(folder / 'paper.json', {})
                    memory = project_memory(paper_meta.get('project_id', 'default'))
                    related = context_text(memory['items'], body.message + ' ' + load(folder / 'paper.json', {}).get('title', ''))
                    (workspace / 'project_memory.md').unlink(missing_ok=True)
                    if related:
                        (workspace / 'project_memory.md').write_text('# 当前项目记忆\n以下是用户在本项目明确表达的背景和研究线索，仅在存在具体关联时使用；关联牵强就不要提。论文证据优先，不要把记忆中的猜测当事实。\n\n' + related + '\n')
                    result = session.run(prompt, on_notification=notification)
                    if result.finish_reason == 'error' or not result.final_response:
                        emit('error', agent_error(result, s['api_key']))
                        return
                    append_message('assistant', result.final_response)
                    assistant_saved = True
                    project_id = load(folder / 'paper.json', {}).get('project_id', 'default')
                    with storage_lock:
                        append_memory_candidate(project_id, id, body.conversation_id, {'role': 'user', 'content': body.message})
                    if maintenance_due(project_memory(project_id)):
                        threading.Thread(target=run_memory_maintenance, args=(project_id, s), daemon=True).start()
                    emit('delta', result.final_response)
                    emit('done', None, session_id=session_id, finish_reason=result.finish_reason)
            except Exception as exc:
                message = str(exc)
                if s['api_key']:
                    message = message.replace(s['api_key'], '[redacted]')
                emit('error', 'DeepSeek Harness error: ' + message[:2000])
            finally:
                if trace.items and not assistant_saved:
                    append_message('assistant', '本轮未正常完成，请查看执行记录或重试。')
                lock.release()
                events.put(None)
        threading.Thread(target=worker, daemon=True).start()
        return StreamingResponse(event_stream(events), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})

    @app.get('/{path:path}')
    def frontend(path: str):
        if path.startswith('api/'):
            raise HTTPException(404, 'API endpoint not found')
        dist = ROOT / 'frontend' / 'dist'
        candidate = (dist / path).resolve()
        if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
            return FileResponse(candidate)
        if (dist / 'index.html').is_file():
            return FileResponse(dist / 'index.html')
        raise HTTPException(404, 'Build frontend/dist to serve the reader UI')
    return app


app = create_app()
