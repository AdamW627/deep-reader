'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');

async function fixture({ url = 'https://example.org/paper', metadata, rejectScript = false, fetchImpl = fetch } = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', dataset: {}, addEventListener() {} });
    return elements.get(id);
  };
  let stored;
  let injections = 0;
  const context = vm.createContext({
    document: { getElementById: element }, URL, AbortController, setTimeout, clearTimeout,
    fetch: fetchImpl,
    chrome: {
      tabs: { query: async () => [{ id: 12, url, title: '标签标题' }] },
      scripting: { executeScript: async () => {
        injections++;
        if (rejectScript) throw new Error('Cannot access viewer');
        return [{ result: metadata }];
      } },
      storage: { local: {
        get: async () => ({ captureConfig: { backend: 'http://127.0.0.1:8765', token: 'test-token' } }),
        set: async value => { stored = value; }
      } }
    }
  });
  vm.runInContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, element, run: expression => vm.runInContext(expression, context),
    injections: () => injections, stored: () => stored };
}

test('manifest uses MV3 and only local backend host permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*']);
  assert.ok(fs.existsSync(path.join(root, manifest.action.default_popup)));
});

test('metadata PDF and og title are sent with capture token to real loopback HTTP server', async () => {
  let received;
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received = { method: request.method, path: request.url, token: request.headers['x-capture-token'], body: JSON.parse(body) };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const f = await fixture({ metadata: { pdfUrl: '/files/paper.pdf', title: '论文标题', baseUrl: 'https://example.org/paper' } });
    f.element('backend').value = `http://127.0.0.1:${server.address().port}`;
    f.element('token').value = 'saved-token';
    await f.run('saveConfig({ preventDefault() {} })');
    assert.equal(f.stored().captureConfig.token, 'saved-token');
    await f.run('capture()');
    assert.deepEqual(received, { method: 'POST', path: '/api/papers/import', token: 'saved-token', body: { url: 'https://example.org/files/paper.pdf', title: '论文标题' } });
    assert.equal(f.element('status').dataset.kind, 'success');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('PDF URL avoids injection and inaccessible viewer falls back to tab URL', async () => {
  const pdf = await fixture({ url: 'https://example.org/paper.pdf?download=1' });
  assert.equal((await pdf.run('getCurrentPaper()')).url, 'https://example.org/paper.pdf?download=1');
  assert.equal(pdf.injections(), 0);
  const viewer = await fixture({ url: 'https://example.org/download/123', rejectScript: true });
  assert.equal((await viewer.run('getCurrentPaper()')).url, 'https://example.org/download/123');
  assert.equal(viewer.injections(), 1);
});

test('unsupported internal page never attempts script injection or import', async () => {
  let requests = 0;
  const f = await fixture({ url: 'chrome://extensions/', fetchImpl: async () => { requests++; } });
  await f.run('capture()');
  assert.equal(f.injections(), 0);
  assert.equal(requests, 0);
  assert.equal(f.element('status').dataset.kind, 'error');
});

test('backend configuration rejects remote hosts and URL credentials', async () => {
  const f = await fixture();
  for (const address of ['https://example.org', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost:8765', 'http://localhost:8765/api']) {
    assert.throws(() => f.run(`normalizeBackend(${JSON.stringify(address)})`));
  }
  assert.equal(f.run("normalizeBackend('http://localhost:8888/')"), 'http://localhost:8888');
});

test('authentication and network errors show actionable Chinese messages', async () => {
  const unauthorized = await fixture({ fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ detail: 'invalid token' }) }) });
  await unauthorized.run('capture()');
  assert.match(unauthorized.element('status').textContent, /令牌/);
  assert.equal(unauthorized.element('capture').disabled, false);
  const offline = await fixture({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  // Use the VM's TypeError to match the browser error realm.
  offline.context.fetch = async () => { throw vm.runInContext("new TypeError('Failed to fetch')", offline.context); };
  await offline.run('capture()');
  assert.match(offline.element('status').textContent, /无法连接阅读器/);
});

test('metadata reader extracts citation and Open Graph fields and skips PDF documents', async () => {
  const f = await fixture();
  f.context.document.contentType = 'text/html';
  f.context.document.baseURI = 'https://example.org/base/';
  f.context.document.querySelector = selector => ({ content: selector.includes('citation_pdf_url') ? 'paper.pdf' : 'Open Graph 标题' });
  const result = f.run('readPageMetadata()');
  assert.equal(result.pdfUrl, 'paper.pdf');
  assert.equal(result.title, 'Open Graph 标题');
  f.context.document.contentType = 'application/pdf';
  assert.equal(f.run('readPageMetadata()'), null);
});
