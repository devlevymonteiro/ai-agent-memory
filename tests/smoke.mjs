/* Teste de integração ponta a ponta: sobe o servidor em portas e pastas temporárias. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4399 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wam-data-'));
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wam-uploads-'));

let logs = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UPLOAD_DIR: uploadDir },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (chunk) => (logs += chunk));
server.stderr.on('data', (chunk) => (logs += chunk));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`FALHOU: ${message}`);
}

async function waitFor(fn, { timeout = 8000, interval = 80, label = 'condição' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timeout esperando ${label}`);
    await sleep(interval);
  }
}

class Client {
  constructor(name) {
    this.name = name;
    this.cookie = '';
  }

  async req(pathname, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (this.cookie) headers.Cookie = this.cookie;
    let body = options.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${pathname}`, { ...options, headers, body, redirect: 'manual' });
    const setCookie = res.headers.getSetCookie?.()[0] || res.headers.get('set-cookie');
    if (setCookie && !this.cookie) this.cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const error = new Error(`${this.name} ${pathname} → HTTP ${res.status}: ${JSON.stringify(data).slice(0, 240)}`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }
}

function subscribe(client) {
  const events = [];
  const controller = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${BASE}/api/events`, {
      headers: { Cookie: client.cookie, Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    assert(res.ok, `SSE de ${client.name} respondeu ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let index;
          while ((index = buffer.indexOf('\n\n')) >= 0) {
            const chunk = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const line = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (line) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch {
                /* ignora keep-alive */
              }
            }
          }
        }
      } catch {
        /* stream encerrado */
      }
    })();
  })();
  return { events, ready, close: () => controller.abort() };
}

const step = (msg) => console.log(`  ✓ ${msg}`);

try {
  /* ---------------------------------------------------------------- boot */
  await waitFor(
    async () => {
      try {
        const res = await fetch(`${BASE}/api/health`);
        return res.ok;
      } catch {
        return false;
      }
    },
    { timeout: 15000, interval: 200, label: 'o servidor subir' }
  );
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert(health.ok === true, 'health check');
  step('servidor no ar');

  const index = await (await fetch(BASE)).text();
  assert(index.includes('id="appView"') && index.includes('/app.js'), 'HTML principal servido');
  const css = await fetch(`${BASE}/styles.css`);
  assert(css.ok && (await css.text()).includes('--bubble-out'), 'CSS servido');
  step('front-end servido');

  const unauth = await fetch(`${BASE}/api/me`);
  assert(unauth.status === 401, 'API protegida sem sessão');
  step('autenticação obrigatória');

  /* --------------------------------------------------------------- login */
  const alex = new Client('Alex');
  const login = await alex.req('/api/demo', { method: 'POST' });
  assert(login.user.name === 'Alex Moreira', 'conta demo');
  const me = await alex.req('/api/me');
  assert(me.user.id === login.user.id, 'sessão via cookie');
  step('login demo + cookie de sessão');

  const { conversations } = await alex.req('/api/conversations');
  assert(conversations.length >= 6, 'conversas de demonstração');
  const ana = conversations.find((c) => c.id === 'c_ana');
  assert(ana && ana.unread === 2, `Ana com 2 não lidas (recebido ${ana?.unread})`);
  assert(conversations.some((c) => c.isGroup && c.pinned), 'grupo fixado');
  step('lista de conversas, não lidas e grupos');

  const history = await alex.req('/api/conversations/c_ana/messages');
  assert(history.messages.length === 7, 'histórico da Ana');
  assert(history.messages.at(-1).seen === false, 'mensagem ainda não lida');
  step('histórico paginado com estado de leitura');

  const search = await alex.req('/api/search?q=caf%C3%A9');
  assert(search.results.length > 0, 'busca por mensagens');
  step('busca em conversas');

  /* ---------------------------------------------------------------- mídia */
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'pixel.png');
  form.append('name', 'pixel.png');
  const uploaded = await alex.req('/api/upload', { method: 'POST', body: form });
  assert(uploaded.media.kind === 'image', 'upload identificado como imagem');
  const imageRes = await fetch(`${BASE}${uploaded.media.url}`);
  assert(imageRes.ok && (imageRes.headers.get('content-type') || '').includes('image/png'), 'arquivo servido');
  const imageMsg = await alex.req('/api/conversations/c_ana/messages', {
    method: 'POST',
    body: { type: 'image', mediaId: uploaded.media.id, body: 'Olha essa foto!' },
  });
  assert(imageMsg.message.type === 'image' && imageMsg.message.media.url, 'mensagem com imagem');
  step('upload + mensagem de mídia');

  /* ---------------------------------------------------- respostas automáticas */
  const sentText = await alex.req('/api/conversations/c_ana/messages', {
    method: 'POST',
    body: { type: 'text', body: 'Oi, Ana! Tudo bem?' },
  });
  assert(sentText.message.status === 'sent', 'recibo inicial na mensagem enviada');
  const botReply = await waitFor(
    async () => {
      const data = await alex.req('/api/conversations/c_ana/messages?limit=20');
      const mine = data.messages.find((m) => m.id === sentText.message.id);
      const reply = data.messages.find((m) => m.senderId === 'u_ana' && m.createdAt > sentText.message.createdAt);
      if (reply && mine?.status === 'read') return { reply, mine };
      return null;
    },
    { timeout: 10000, label: 'resposta automática da Ana' }
  );
  assert(botReply.reply.body.length > 0, 'resposta recebida');
  assert(botReply.mine.status === 'read', 'recibo de leitura azul após resposta');
  step('resposta automática + recibos ✓ → ✓✓ → lido');

  /* ------------------------------------------------- duas contas em tempo real */
  const bia = new Client('Bia');
  const biaLogin = await bia.req('/api/login', { method: 'POST', body: { phone: '(11) 98765-4321', name: 'Bia Teste' } });
  assert(biaLogin.user.name === 'Bia Teste', 'criação de conta');
  const biaConvs = await bia.req('/api/conversations');
  assert(biaConvs.conversations.some((c) => c.id.includes('g_')), 'grupo de boas-vindas provisionado');
  step('segunda conta criada e provisionada');

  const directory = await bia.req('/api/users');
  const alexUser = directory.users.find((u) => u.id === login.user.id);
  assert(alexUser, 'Alex aparece no diretório da Bia');
  const direct = await bia.req('/api/conversations', { method: 'POST', body: { userId: alexUser.id } });
  const directId = direct.conversation.id;

  const sseBia = subscribe(bia);
  const sseAlex = subscribe(alex);
  await sseBia.ready;
  await sseAlex.ready;
  await waitFor(() => sseBia.events.some((e) => e.type === 'ready'), { label: 'SSE da Bia' });
  await waitFor(() => sseAlex.events.some((e) => e.type === 'ready'), { label: 'SSE do Alex' });
  step('streams SSE conectados');

  const first = await alex.req(`/api/conversations/${directId}/messages`, {
    method: 'POST',
    body: { type: 'text', body: 'Mensagem em tempo real ✅' },
  });
  const received = await waitFor(
    () => sseBia.events.find((e) => e.type === 'message' && e.message?.id === first.message.id),
    { label: 'mensagem em tempo real na Bia' }
  );
  assert(received.message.body === 'Mensagem em tempo real ✅', 'conteúdo chegou intacto');
  assert(received.message.status === null, 'mensagem recebida não mostra ticks');
  step('entrega em tempo real entre duas contas');

  await bia.req(`/api/conversations/${directId}/read`, { method: 'POST' });
  await waitFor(
    () => sseAlex.events.find((e) => e.type === 'message:update' && e.message?.id === first.message.id && e.message.status === 'read'),
    { label: 'recibo de leitura via SSE' }
  );
  step('recibo de leitura em tempo real');

  const typingWait = waitFor(() => sseAlex.events.find((e) => e.type === 'typing' && e.conversationId === directId && e.userId === biaLogin.user.id), {
    label: 'evento de digitação',
  });
  await bia.req(`/api/conversations/${directId}/typing`, { method: 'POST' });
  await typingWait;
  step('indicador de digitação em tempo real');

  const replyBia = await bia.req(`/api/conversations/${directId}/messages`, {
    method: 'POST',
    body: { type: 'text', body: 'Recebido! 👋' },
  });
  await waitFor(
    () => sseAlex.events.find((e) => e.type === 'message' && e.message?.id === replyBia.message.id),
    { label: 'resposta da Bia no SSE do Alex' }
  );

  /* ------------------------------------------------------------- reações etc */
  await alex.req(`/api/conversations/${directId}/messages/${replyBia.message.id}/react`, {
    method: 'POST',
    body: { emoji: '🔥' },
  });
  const reacted = await alex.req(`/api/conversations/${directId}/messages`);
  const reactedMsg = reacted.messages.find((m) => m.id === replyBia.message.id);
  assert(reactedMsg.reactions[login.user.id] === '🔥', 'reação persistida');

  const call = await alex.req('/api/calls', {
    method: 'POST',
    body: { conversationId: directId, kind: 'video', duration: 95, status: 'answered' },
  });
  assert(call.message.type === 'call' && call.message.call.duration === 95, 'registro de chamada');
  step('reações e registro de chamada');

  const deleted = await alex.req(`/api/conversations/${directId}/messages/${first.message.id}?scope=all`, { method: 'DELETE' });
  assert(deleted.ok, 'apagar para todos');
  const afterDelete = await alex.req(`/api/conversations/${directId}/messages`);
  const deletedMsg = afterDelete.messages.find((m) => m.id === first.message.id);
  assert(deletedMsg.deleted === true && deletedMsg.body === '', 'mensagem marcada como apagada');
  step('apagar para todos');

  /* ----------------------------------------------------------------- grupo */
  const group = await alex.req('/api/conversations', {
    method: 'POST',
    body: { type: 'group', name: 'Grupo de Teste', memberIds: [biaLogin.user.id] },
  });
  assert(group.conversation.isGroup && group.conversation.title === 'Grupo de Teste', 'grupo criado');
  const biaAfterGroup = await bia.req('/api/conversations');
  assert(biaAfterGroup.conversations.some((c) => c.id === group.conversation.id), 'Bia recebeu o grupo');
  const groupMsgs = await alex.req(`/api/conversations/${group.conversation.id}/messages`);
  assert(groupMsgs.messages[0].type === 'system', 'mensagem de sistema de criação');
  step('criação de grupo com mensagem de sistema');

  /* --------------------------------------------------- participantes do grupo */
  const groupId = group.conversation.id;
  const addAna = await alex.req(`/api/conversations/${groupId}/participants`, {
    method: 'POST',
    body: { userId: 'u_ana' },
  });
  assert(addAna.conversation.memberCount === 3, 'Ana entrou no grupo');
  assert(addAna.message.type === 'system' && addAna.message.body.includes('Ana'), 'mensagem de sistema ao adicionar');
  const biaDetails = await bia.req(`/api/conversations/${groupId}`);
  assert(biaDetails.members.length === 3, 'participantes visíveis para todos');

  let forbidden = 0;
  try {
    await bia.req(`/api/conversations/${groupId}/participants/${login.user.id}`, { method: 'DELETE' });
  } catch (error) {
    forbidden = error.status;
  }
  assert(forbidden === 403, 'apenas o admin remove outros participantes');

  const removedAna = await alex.req(`/api/conversations/${groupId}/participants/u_ana`, { method: 'DELETE' });
  assert(removedAna.conversation.memberCount === 2, 'Ana removida do grupo');
  step('participantes do grupo: adicionar, remover e permissões');

  /* ------------------------------------------------------- preferências / flags */
  const pinned = await alex.req(`/api/conversations/${group.conversation.id}`, {
    method: 'PATCH',
    body: { pinned: true, muted: true },
  });
  assert(pinned.conversation.pinned === true && pinned.conversation.muted === true, 'fixar/silenciar');
  const archived = await alex.req(`/api/conversations/${group.conversation.id}`, { method: 'PATCH', body: { archived: true } });
  assert(archived.conversation.archived === true, 'arquivar');
  step('fixar, silenciar e arquivar');

  /* ------------------------------------------------------------------ perfil */
  const updated = await alex.req('/api/me', { method: 'PATCH', body: { about: 'Testando a demo 🚀' } });
  assert(updated.user.about.includes('Testando'), 'edição de perfil');
  const settings = await alex.req('/api/settings', { method: 'PATCH', body: { autoReplies: false } });
  assert(settings.autoReplies === false, 'configuração de respostas automáticas');
  await alex.req('/api/settings', { method: 'PATCH', body: { autoReplies: true } });
  step('perfil e configurações');

  /* ----------------------------------------------------------------- logout */
  await alex.req('/api/logout', { method: 'POST' });
  const loggedOut = await fetch(`${BASE}/api/me`, { headers: { Cookie: alex.cookie } });
  assert(loggedOut.status === 401, 'sessão encerrada após logout');
  step('logout invalida a sessão');

  sseBia.close();
  sseAlex.close();
  console.log('\n  ✅ Todos os testes passaram.\n');
} catch (error) {
  console.error('\n  ❌', error.message, '\n');
  if (logs.trim()) console.error('  --- log do servidor ---\n' + logs.split('\n').slice(-30).join('\n'));
  process.exitCode = 1;
} finally {
  server.kill('SIGTERM');
  await sleep(400);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(uploadDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
