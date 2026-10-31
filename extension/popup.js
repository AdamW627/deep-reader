'use strict';

const DEFAULT_BACKEND = 'http://127.0.0.1:8765';
const captureButton = document.getElementById('capture');
const statusElement = document.getElementById('status');
const backendInput = document.getElementById('backend');
const tokenInput = document.getElementById('token');
const settings = document.getElementById('settings');
const saveButton = document.getElementById('save');
let config = null;

function setStatus(message, kind = '') {
  statusElement.textContent = message;
  statusElement.dataset.kind = kind;
}

function normalizeBackend(value) {
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('请输入有效的本机阅读器地址。'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('阅读器地址须为 http://127.0.0.1:端口 或 http://localhost:端口，不含路径。');
  }
  return url.origin;
}

function publicWebUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// This function is serialized by Chrome; keep it self-contained.
function readPageMetadata() {
  if (document.contentType === 'application/pdf') return null;
  return {
    pdfUrl: document.querySelector('meta[name="citation_pdf_url" i]')?.content || '',
    title: document.querySelector('meta[property="og:title" i], meta[name="og:title" i]')?.content || document.title,
    baseUrl: document.baseURI
  };
}

async function getCurrentPaper() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url && publicWebUrl(tab.url);
  if (!tabUrl) {
    throw new Error('请打开 http(s) 论文网页或在线 PDF。浏览器内部页和本地文件暂不支持。');
  }
  let metadata;
  // PDF viewer pages may retain an HTTPS tab URL but reject script injection.
  // Failure is expected: the active tab URL remains a valid import source.
  if (!/\.pdf$/i.test(new URL(tabUrl).pathname)) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readPageMetadata
      });
      metadata = results?.[0]?.result;
    } catch { /* Built-in PDF viewer or otherwise inaccessible document. */ }
  }
  return {
    url: metadata?.pdfUrl ? publicWebUrl(metadata.pdfUrl, metadata.baseUrl || tabUrl) || tabUrl : tabUrl,
    title: (metadata?.title || tab.title || '').trim() || tabUrl
  };
}

async function responseError(response) {
  let detail = '';
  try {
    const data = await response.json();
    const message = data.detail || data.error || data.message;
    if (typeof message === 'string') detail = message.slice(0, 400);
  } catch { /* The backend or proxy may return a non-JSON error. */ }
  if ([401, 403].includes(response.status)) return '收藏令牌无效或已更新，请从阅读器「设置」重新复制并保存。';
  return `导入失败（HTTP ${response.status}）${detail ? `：${detail}` : '，请检查链接或阅读器日志。'}`;
}

async function capture() {
  captureButton.disabled = true;
  saveButton.disabled = true;
  let timeout;
  try {
    if (!config?.token) {
      settings.open = true;
      throw new Error('请先从阅读器「设置」复制收藏令牌，并在连接设置中保存。');
    }
    setStatus('正在读取当前页面…');
    const paper = await getCurrentPaper();
    setStatus('正在发送到阅读器，请保持弹窗打开…');
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 120000);
    const response = await fetch(`${config.backend}/api/papers/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Capture-Token': config.token },
      body: JSON.stringify(paper),
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(await responseError(response));
    setStatus('已发送，阅读器已接受导入请求。请在阅读器中查看论文及处理状态。', 'success');
  } catch (error) {
    const message = error.name === 'AbortError'
      ? '请求超时。导入可能仍在进行，请先查看阅读器，避免重复提交。'
      : error instanceof TypeError
        ? '无法连接阅读器。请确认服务已启动、地址正确；若请求已发送，请先检查书架后再重试。'
        : error.message || '导入失败，请重试。';
    setStatus(message, 'error');
  } finally {
    clearTimeout(timeout);
    captureButton.disabled = false;
    saveButton.disabled = false;
  }
}

async function saveConfig(event) {
  event.preventDefault();
  try {
    const backend = normalizeBackend(backendInput.value);
    const token = tokenInput.value.trim();
    if (!token || /[\r\n]/.test(token)) throw new Error('请粘贴有效的收藏令牌。');
    const next = { backend, token };
    await chrome.storage.local.set({ captureConfig: next });
    config = next;
    backendInput.value = backend;
    setStatus('设置已保存，可以收藏当前页面。', 'success');
    settings.open = false;
  } catch (error) {
    setStatus(error.message || '保存失败，请重试。', 'error');
  }
}

async function initialize() {
  try {
    const { captureConfig } = await chrome.storage.local.get('captureConfig');
    config = {
      backend: normalizeBackend(captureConfig?.backend || DEFAULT_BACKEND),
      token: typeof captureConfig?.token === 'string' ? captureConfig.token : ''
    };
    backendInput.value = config.backend;
    tokenInput.value = config.token;
    settings.open = !config.token;
    setStatus(config.token ? '准备就绪，点击即可收藏当前页面。' : '首次使用：请先填写并保存收藏令牌。');
  } catch {
    backendInput.value = DEFAULT_BACKEND;
    settings.open = true;
    setStatus('读取配置失败，请重新填写并保存连接设置。', 'error');
  } finally {
    captureButton.disabled = false;
  }
}

captureButton.addEventListener('click', capture);
document.getElementById('config-form').addEventListener('submit', saveConfig);
initialize();
