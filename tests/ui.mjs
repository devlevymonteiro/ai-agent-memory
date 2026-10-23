/* Teste de interface com JSDOM: carrega o app real e simula interações do usuário. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4810 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wam-ui-data-'));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wam-ui-uploads-'));

let logs = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: uploadDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(`FALHOU: ${message}`);
};
const step = (msg) => console.log(`  ✓ ${msg}`);

async function waitFor(fn, label, timeout = 10000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timeout esperando ${label}`);
    await sleep(80);
  }
}

const jar = { cookie: '' };

function storeCookies(response) {
  const cookies = response.headers.getSetCookie?.() || [];
  for (const raw of cookies) {
    const pair = raw.split(';')[0];
    const name = pair.split('=')[0];
    const parts = jar.cookie ? jar.cookie.split('; ') : [];
    jar.cookie = [...parts.filter((p) => !p.startsWith(`${name}=`)), pair].join('; ');
  }
}

function proxyFetch(input, init = {}) {
  const raw = typeof input === 'string' ? input : input.url;
  const url = new URL(raw, BASE).href;
  const headers = { ...(init.headers || {}) };
  if (jar.cookie) headers.Cookie = jar.cookie;
  return fetch(url, { ...init, headers }).then((response) => {
    storeCookies(response);
    return response;
  });
}

async function api(pathname, options = {}, cookie = jar.cookie) {
  const headers = { ...(options.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${pathname}`, { ...options, headers, body });
  storeCookies(response);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${pathname}: ${data.error || response.status}`);
  return data;
}

function createEventSourceClass(window) {
  return class EventSourcePolyfill {
    constructor(url) {
      this.url = new URL(url, window.location.href).href;
      this.readyState = 0;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.listeners = new Map();
      this.controller = new AbortController();
      this.connect();
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }

    emit(type, payload) {
      const event = { type, ...payload };
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler(event);
      for (const fn of this.listeners.get(type) || []) fn(event);
    }

    async connect() {
      try {
        const response = await proxyFetch(this.url, {
          headers: { Accept: 'text/event-stream' },
          signal: this.controller.signal,
        });
        if (!response.ok) throw new Error(`SSE ${response.status}`);
        this.readyState = 1;
        this.emit('open', {});
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            let data = '';
            let eventType = 'message';
            for (const line of chunk.split('\n')) {
              if (line.startsWith('event:')) eventType = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trimStart();
            }
            if (data) this.emit(eventType, { data });
          }
        }
        this.readyState = 2;
      } catch {
        if (this.controller.signal.aborted) return;
        this.readyState = 0;
        this.emit('error', {});
        setTimeout(() => this.connect(), 1500);
      }
    }

    close() {
      this.controller.abort();
      this.readyState = 2;
    }
  };
}

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

try {
  await waitFor(
    async () => {
      try {
        return (await fetch(`${BASE}/api/health`)).ok;
      } catch {
        return false;
      }
    },
    'o servidor subir',
    15000
  );

  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (msg) => {
    if (!String(msg).includes('Could not parse CSS')) errors.push(String(msg));
  });
  virtualConsole.on('jsdomError', (err) => {
    if (!String(err?.message || '').includes('Could not parse CSS')) errors.push(err?.stack || String(err));
  });

  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.fetch = proxyFetch;
      window.EventSource = createEventSourceClass(window);
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.Element.prototype.scrollTo = function scrollTo(options) {
        if (options && typeof options === 'object' && 'top' in options) this.scrollTop = options.top;
      };
      window.Element.prototype.scrollIntoView = function scrollIntoView() {};
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.addEventListener('error', (event) => errors.push(event.error?.stack || event.message));
      window.addEventListener('unhandledrejection', (event) => errors.push(event.reason?.stack || String(event.reason)));
    },
  });

  const { window } = dom;
  const { document } = window;
  const wait = (selector, label = selector, timeout = 12000) =>
    waitFor(() => document.querySelector(selector), label, timeout);

  await wait('#loginView:not([hidden])');
  await waitFor(() => !document.querySelector('#boot'), 'boot desaparecer');
  assert(!document.querySelector('#loginView').hidden, 'tela de login visível');
  assert(document.querySelector('#appView').hidden, 'app escondido antes do login');
  step('tela de login renderizada');

  document.querySelector('#demoLoginBtn').click();
  await wait('#appView:not([hidden])');
  await waitFor(() => document.querySelectorAll('#chatList .chat-item').length >= 6, 'lista de conversas');
  assert(textOf(document.querySelector('#footMe')).includes('Alex'), 'usuário demo carregado');
  step('login demo pelo botão');

  await waitFor(() => !document.querySelector('#connDot').classList.contains('off'), 'conexão SSE');
  step('stream em tempo real conectado');

  const anaItem = await wait('[data-conv-id="c_ana"]');
  anaItem.click();
  await wait('#chatView:not([hidden])');
  await waitFor(() => document.querySelectorAll('#messages .msg-row').length === 7, 'histórico da Ana');
  assert(textOf(document.querySelector('#chatTitle')) === 'Ana Beatriz', 'cabeçalho da conversa');
  assert(textOf(document.querySelector('#chatSubtitle')).length > 0, 'status do contato');
  assert(document.querySelectorAll('#messages .date-divider').length >= 1, 'separador de data');
  assert(document.querySelectorAll('#messages .unread-divider').length === 1, 'divisor de não lidas');
  step('conversa aberta com histórico, datas e não lidas');

  await waitFor(() => !document.querySelector('[data-conv-id="c_ana"] .unread-badge'), 'badge de não lidas sumir');
  step('recibo de leitura ao abrir a conversa');

  const input = document.querySelector('#messageInput');
  const initialIncoming = document.querySelectorAll('#messages .msg-row.in').length;
  input.value = 'Teste de interface 🚀';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert(!document.querySelector('#sendBtn').hidden, 'botão enviar aparece com texto');
  const typingIndicator = waitFor(
    () => textOf(document.querySelector('#chatSubtitle')).includes('digitando'),
    'indicador de digitação',
    15000
  );
  document.querySelector('#sendBtn').click();
  await waitFor(
    () => [...document.querySelectorAll('#messages .msg-row.out')].some((r) => textOf(r).includes('Teste de interface')),
    'mensagem enviada aparecer'
  );
  step('envio de mensagem pelo composer');

  await typingIndicator;
  step('indicador "digitando…" no cabeçalho');

  await waitFor(
    () => document.querySelectorAll('#messages .msg-row.in').length > initialIncoming,
    'resposta automática da Ana',
    15000
  );
  await waitFor(() => {
    const rows = [...document.querySelectorAll('#messages .msg-row.out')];
    const last = rows[rows.length - 1];
    return last && textOf(last).includes('Teste de interface') && last.querySelector('.ticks.read');
  }, 'ticks azuis na mensagem enviada', 12000);
  step('resposta do contato + recibo de leitura (✓✓ azul)');

  const targetRow = [...document.querySelectorAll('#messages .msg-row.in')].find((row) => !row.querySelector('.reactions'));
  assert(targetRow, 'mensagem sem reação para testar');
  const targetId = targetRow.dataset.id;
  targetRow.querySelector('[data-msg-action="react"]').click();
  await wait('#reactionBar:not([hidden])');
  document.querySelectorAll('#reactionBar button')[1].click();
  await waitFor(
    () => textOf(document.querySelector(`.msg-row[data-id="${targetId}"] .reactions`)).includes('😂'),
    'reação aplicada no DOM'
  );
  step('reação em tempo real');

  const replyRow = [...document.querySelectorAll('#messages .msg-row.in')].at(-1);
  replyRow.querySelector('[data-msg-action="reply"]').click();
  assert(!document.querySelector('#replyBar').hidden, 'barra de resposta');
  input.value = 'Respondendo com citação';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#sendBtn').click();
  await waitFor(
    () => {
      const rows = [...document.querySelectorAll('#messages .msg-row.out')];
      return rows.at(-1)?.querySelector('.quoted') && textOf(rows.at(-1)).includes('Respondendo com citação');
    },
    'mensagem com citação'
  );
  assert(document.querySelector('#replyBar').hidden, 'barra de resposta some após enviar');
  step('responder citando mensagem');

  document.querySelector('[data-action="open-info"]').click();
  await wait('.drawer');
  assert(textOf(document.querySelector('.drawer')).includes('Dados da conversa'), 'painel de informações');
  assert(textOf(document.querySelector('.drawer')).includes('mensagens'), 'estatísticas');
  document.querySelector('[data-drawer-close]').click();
  await waitFor(() => !document.querySelector('.drawer'), 'drawer fechar');
  step('painel de dados da conversa');

  document.querySelector('[data-action="open-profile"]').click();
  await wait('.drawer');
  assert(textOf(document.querySelector('.drawer')).includes('Preferências'), 'configurações');
  document.querySelector('[data-toggle="theme"]').click();
  await waitFor(() => document.documentElement.dataset.theme === 'light', 'tema claro');
  document.querySelector('[data-toggle="theme"]').click();
  await waitFor(() => document.documentElement.dataset.theme === 'dark', 'tema escuro');
  document.querySelector('[data-drawer-close]').click();
  await waitFor(() => !document.querySelector('.drawer'), 'drawer fechar');
  step('troca de tema pelo perfil');

  const searchInput = document.querySelector('#searchInput');
  searchInput.value = 'café';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#searchResults .search-result').length > 0, 'resultados da busca');
  document.querySelector('#searchResults .search-result').click();
  await waitFor(() => document.querySelector('#searchResults').hidden, 'busca fechar');
  step('busca global com salto para a mensagem');

  document.querySelector('[data-action="new-group"]').click();
  await wait('.modal');
  const groupName = document.querySelector('#groupName');
  groupName.value = 'Grupo de UI';
  groupName.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.querySelector('#groupContacts .contact-row').click();
  const createBtn = await wait('#createGroup');
  await waitFor(() => !createBtn.disabled, 'botão criar liberado');
  createBtn.click();
  await waitFor(() => textOf(document.querySelector('#chatTitle')) === 'Grupo de UI', 'grupo aberto');
  await waitFor(() => document.querySelectorAll('#messages .system-msg').length > 0, 'mensagem de sistema do grupo');
  step('criação de grupo pela interface');

  document.querySelector('[data-action="open-info"]').click();
  await wait('.drawer');
  assert(textOf(document.querySelector('.drawer')).includes('Participantes (2)'), 'painel do grupo com participantes');
  document.querySelector('.drawer [data-info-action="add-members"]').click();
  await wait('.modal');
  assert(document.querySelectorAll('.modal .contact-row').length >= 2, 'contatos disponíveis para adicionar');
  document.querySelector('.modal .contact-row').click();
  await waitFor(() => !document.querySelector('#confirmAddMembers').disabled, 'botão adicionar liberado');
  document.querySelector('#confirmAddMembers').click();
  await waitFor(
    () => textOf(document.querySelector('.drawer')).includes('Participantes (3)'),
    'participante adicionado no painel'
  );
  const removeBtn = document.querySelector('.drawer .m-remove');
  assert(removeBtn, 'botão de remover participante');
  removeBtn.click();
  await wait('.modal');
  document.querySelector('#confirmAction').click();
  await waitFor(
    () => textOf(document.querySelector('.drawer')).includes('Participantes (2)'),
    'participante removido do painel'
  );
  document.querySelector('[data-drawer-close]').click();
  await waitFor(() => !document.querySelector('.drawer'), 'drawer fechar');
  step('participantes do grupo pela interface (adicionar e remover)');

  /* Mídia e chamada chegando por SSE */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'ui-pixel.png');
  form.append('name', 'ui-pixel.png');
  const uploaded = await api('/api/upload', { method: 'POST', body: form });
  const allConvs = (await api('/api/conversations')).conversations;
  const groupId = allConvs.find((c) => c.title === 'Grupo de UI')?.id;
  assert(groupId, 'grupo criado encontrado na API');
  await api(`/api/conversations/${groupId}/messages`, {
    method: 'POST',
    body: { type: 'image', mediaId: uploaded.media.id, body: 'Imagem via SSE' },
  });
  await waitFor(() => document.querySelector(`#messages .msg-media img`), 'imagem recebida via SSE');
  const mediaNode = document.querySelector('#messages .msg-media');
  mediaNode.click();
  await wait('#lightbox:not([hidden])');
  assert(document.querySelector('#lightbox img'), 'imagem no lightbox');
  document.querySelector('#lightbox [data-action="lb-close"]').click();
  await waitFor(() => document.querySelector('#lightbox').hidden, 'lightbox fechar');
  step('mídia recebida em tempo real + lightbox');

  await api('/api/calls', {
    method: 'POST',
    body: { conversationId: groupId, kind: 'audio', duration: 42, status: 'answered' },
  });
  await waitFor(() => document.querySelector('#messages .call-msg'), 'registro de chamada');
  assert(textOf(document.querySelector('#messages .call-msg')).includes('Chamada de voz'), 'texto da chamada');

  const previousCalls = document.querySelectorAll('#messages .call-msg').length;
  document.querySelector('[data-action="call-audio"]').click();
  await wait('#callOverlay:not([hidden])');
  assert(textOf(document.querySelector('#callStatus')).includes('Chamando'), 'tela de chamada');
  await waitFor(() => textOf(document.querySelector('#callStatus')).includes('Conectada'), 'chamada conectada', 8000);
  document.querySelector('#callEnd').click();
  await waitFor(() => document.querySelector('#callOverlay').hidden, 'overlay fechar');
  await waitFor(() => document.querySelectorAll('#messages .call-msg').length > previousCalls, 'registro da chamada pela UI');
  step('chamada de voz pela interface + registro');

  document.querySelector('[data-action="open-info"]').click();
  await wait('.drawer');
  document.querySelector('.drawer [data-info-action="leave"]').click();
  await wait('.modal');
  document.querySelector('#confirmAction').click();
  await waitFor(() => document.querySelector('#chatView').hidden, 'chat fechado após sair do grupo');
  await waitFor(
    () => ![...document.querySelectorAll('#chatList .chat-item .chat-name')].some((el) => textOf(el) === 'Grupo de UI'),
    'grupo fora da lista'
  );
  const convsAfterLeave = (await api('/api/conversations')).conversations;
  assert(!convsAfterLeave.some((c) => c.title === 'Grupo de UI'), 'grupo removido para quem saiu');
  step('sair do grupo pela interface');

  const errorsAfter = errors.filter((e) => !String(e).includes('Not implemented'));
  assert(errorsAfter.length === 0, `erros de JavaScript no navegador:\n${errorsAfter.join('\n')}`);
  step('nenhum erro de JavaScript no console');

  dom.window.close();

  /* ---- iframe/preview com localStorage bloqueado não pode travar o app ---- */
  await api('/api/logout', { method: 'POST' });
  const blockedErrors = [];
  const blockedConsole = new VirtualConsole();
  blockedConsole.on('jsdomError', (err) => {
    if (!String(err?.message || '').includes('Could not parse CSS')) blockedErrors.push(err?.stack || String(err));
  });
  const blocked = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: blockedConsole,
    beforeParse(window) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new window.DOMException('The operation is insecure.', 'SecurityError');
        },
      });
      window.fetch = proxyFetch;
      window.EventSource = createEventSourceClass(window);
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.Element.prototype.scrollTo = function scrollTo() {};
      window.Element.prototype.scrollIntoView = function scrollIntoView() {};
      window.URL.createObjectURL = () => 'blob:mock';
      window.URL.revokeObjectURL = () => {};
      window.addEventListener('error', (event) => blockedErrors.push(event.error?.stack || event.message));
      window.addEventListener('unhandledrejection', (event) => blockedErrors.push(event.reason?.stack || String(event.reason)));
    },
  });
  const bd = blocked.window.document;
  await waitFor(() => bd.querySelector('#loginView:not([hidden])'), 'login renderizar sem localStorage', 12000);
  await waitFor(() => !bd.querySelector('#boot'), 'overlay de boot sair mesmo sem storage', 8000);
  assert(!bd.querySelector('#loginView').hidden, 'tela de login visível sem storage');
  bd.querySelector('#demoLoginBtn').click();
  await waitFor(() => bd.querySelectorAll('#chatList .chat-item').length >= 6, 'lista de conversas sem storage', 15000);
  await waitFor(() => !bd.querySelector('#connDot').classList.contains('off'), 'SSE autenticado por token', 12000);
  blocked.window.close();
  const blockedAfter = blockedErrors.filter((e) => !String(e).includes('Not implemented'));
  assert(blockedAfter.length === 0, `erros com localStorage bloqueado:\n${blockedAfter.join('\n')}`);
  step('app abre e conecta com localStorage bloqueado (preview em iframe)');

  console.log('\n  ✅ Testes de interface passaram.\n');
} catch (error) {
  console.error('\n  ❌', error.message, '\n');
  if (logs.trim()) console.error('  --- log do servidor ---\n' + logs.split('\n').slice(-25).join('\n'));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
