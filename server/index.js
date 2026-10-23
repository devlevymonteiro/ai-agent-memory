import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  getDb,
  save,
  saveNow,
  findUser,
  findConversation,
  conversationMembers,
  otherMember,
  isMember,
  conversationTitle,
  conversationAvatar,
  avatarFor,
  normalizePhone,
  newId,
  UPLOAD_DIR,
  DATA_DIR,
  resetDb,
} from './db.js';

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'public');
const SESSION_COOKIE = 'wam_sid';
const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;

const app = express();
// atrás do proxy HTTPS (E2B, Render, Railway...) para cookies e IPs corretos
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.set('etag', false);
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
getDb();

/* ------------------------------ utilidades ------------------------------ */

const cookiesOf = (req) => {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
};

const sessionOf = (req) => {
  const auth = String(req.headers.authorization || '');
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const token = bearer || queryToken || cookiesOf(req)[SESSION_COOKIE];
  if (!token) return null;
  const db = getDb();
  const session = db.sessions[token];
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_AGE) {
    delete db.sessions[token];
    save();
    return null;
  }
  const user = findUser(session.userId);
  if (!user) return null;
  return { token, user, session };
};

function requireAuth(req, res, next) {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  req.session = session;
  req.user = session.user;
  next();
}

function startSession(req, res, user) {
  const db = getDb();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: Date.now() };
  saveNow();
  const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').includes('https');
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_AGE,
    secure,
  });
  return token;
}

const publicUser = (user) =>
  user && {
    id: user.id,
    name: user.name,
    phone: user.phone,
    about: user.about,
    avatarText: user.avatarText,
    avatarColor: user.avatarColor,
  };

/* --------------------------- conexões em tempo real --------------------------- */

const clients = new Map(); // userId -> Set(res)
const botActive = new Map(); // userId -> timestamp até quando está "online"
const botTimers = new Map();
const botPending = new Set(); // conversas com resposta automática agendada

function setBotActive(botId, ms) {
  botActive.set(botId, Date.now() + ms);
  clearTimeout(botTimers.get(botId));
  const timer = setTimeout(() => {
    if ((botActive.get(botId) || 0) <= Date.now()) {
      botActive.delete(botId);
      broadcast(presenceSnapshot());
    }
  }, ms + 300);
  timer.unref?.();
  botTimers.set(botId, timer);
}

function sseSend(res, payload) {
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function sendTo(userId, payload) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return 0;
  let sent = 0;
  for (const res of set) if (sseSend(res, payload)) sent++;
  return sent;
}

function isOnline(userId) {
  if (clients.has(userId)) return true;
  const until = botActive.get(userId);
  return Boolean(until && until > Date.now());
}

function presenceSnapshot() {
  const db = getDb();
  return {
    type: 'presence',
    users: db.users.map((u) => ({ id: u.id, online: isOnline(u.id), lastSeen: u.lastSeen || null })),
  };
}

function broadcast(payload) {
  for (const userId of clients.keys()) sendTo(userId, payload);
}

function broadcastMembers(conv, build) {
  for (const memberId of conversationMembers(conv)) {
    const payload = build(memberId);
    if (payload) sendTo(memberId, payload);
  }
}

/* ----------------------------- serialização ----------------------------- */

const truncate = (str, n = 90) => {
  const s = String(str || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const mediaOf = (id) => getDb().media.find((m) => m.id === id);

function messagePreview(msg) {
  if (!msg) return '';
  if (msg.deletedForAll) return '🚫 Mensagem apagada';
  switch (msg.type) {
    case 'image':
      return msg.body ? `📷 ${msg.body}` : '📷 Foto';
    case 'video':
      return msg.body ? `🎬 ${msg.body}` : '🎬 Vídeo';
    case 'audio':
      return '🎤 Mensagem de voz';
    case 'document':
      return `📄 ${(mediaOf(msg.mediaId) || {}).name || 'Documento'}`;
    case 'call': {
      const kind = msg.meta?.kind === 'video' ? 'vídeo' : 'voz';
      return `📞 Chamada de ${kind}`;
    }
    default:
      return msg.body || '';
  }
}

function statusFor(msg, conv, viewerId) {
  if (msg.senderId !== viewerId) return null;
  const others = conversationMembers(conv).filter((id) => id !== viewerId);
  if (others.length === 0) return 'read';
  if (others.every((id) => msg.readBy.includes(id))) return 'read';
  if (others.every((id) => msg.deliveredTo.includes(id))) return 'delivered';
  return 'sent';
}

function serializeMessage(msg, viewerId) {
  const db = getDb();
  const conv = findConversation(msg.conversationId);
  const sender = findUser(msg.senderId);
  const media = msg.mediaId ? mediaOf(msg.mediaId) : null;
  const quotedMsg = msg.quotedId ? db.messages.find((m) => m.id === msg.quotedId) : null;
  const quotedSender = quotedMsg ? findUser(quotedMsg.senderId) : null;
  const isMine = msg.senderId === viewerId;
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderId: msg.senderId,
    senderName: sender ? sender.name : 'Sistema',
    isMine,
    type: msg.type,
    body: msg.deletedForAll ? '' : msg.body || '',
    createdAt: msg.createdAt,
    deleted: Boolean(msg.deletedForAll),
    edited: Boolean(msg.editedAt),
    media: media
      ? {
          id: media.id,
          url: `/uploads/${media.file}`,
          mime: media.mime,
          name: media.name,
          size: media.size,
          kind: media.kind,
        }
      : null,
    duration: msg.duration || media?.duration || null,
    quoted: quotedMsg
      ? {
          id: quotedMsg.id,
          senderId: quotedMsg.senderId,
          senderName: quotedSender ? quotedSender.name : 'Sistema',
          type: quotedMsg.type,
          body: quotedMsg.deletedForAll ? 'Mensagem apagada' : messagePreview(quotedMsg),
        }
      : null,
    reactions: msg.reactions || {},
    seen: Array.isArray(msg.readBy) && msg.readBy.includes(viewerId),
    status: statusFor(msg, conv, viewerId),
    call: msg.type === 'call' ? msg.meta || null : null,
  };
}

function lastMessageFor(conv, viewerId) {
  const clearedAt = (conv.clearedAt || {})[viewerId] || 0;
  const msgs = getDb().messages.filter(
    (m) =>
      m.conversationId === conv.id &&
      m.createdAt > clearedAt &&
      !m.deletedForMe.includes(viewerId)
  );
  const last = msgs[msgs.length - 1];
  if (!last) return null;
  const sender = findUser(last.senderId);
  return {
    id: last.id,
    senderId: last.senderId,
    senderName: sender ? sender.name : 'Sistema',
    type: last.type,
    preview: messagePreview(last),
    createdAt: last.createdAt,
    status: statusFor(last, conv, viewerId),
    deleted: Boolean(last.deletedForAll),
    outgoing: last.senderId === viewerId,
  };
}

function typingFor(conv, viewerId) {
  const now = Date.now();
  return Array.from(typingState.entries())
    .filter(([key, value]) => key.startsWith(`${conv.id}:`) && value.until > now && value.userId !== viewerId)
    .map(([, value]) => ({ id: value.userId, name: value.name }));
}

function summaryFor(conv, viewerId) {
  const other = otherMember(conv, viewerId);
  const db = getDb();
  const clearedAt = (conv.clearedAt || {})[viewerId] || 0;
  const msgs = db.messages.filter((m) => m.conversationId === conv.id && m.createdAt > clearedAt);
  const unread = msgs.filter(
    (m) =>
      m.senderId !== viewerId &&
      m.type !== 'system' &&
      !m.deletedForAll &&
      !m.readBy.includes(viewerId) &&
      !m.deletedForMe.includes(viewerId)
  ).length;
  const avatar = conversationAvatar(conv, viewerId);
  const presence = other ? { online: isOnline(other.id), lastSeen: other.lastSeen || null } : null;
  const last = lastMessageFor(conv, viewerId);
  return {
    id: conv.id,
    type: conv.type,
    title: conversationTitle(conv, viewerId),
    isGroup: conv.type === 'group',
    avatarText: avatar.avatarText,
    avatarColor: avatar.avatarColor,
    memberIds: conversationMembers(conv),
    memberCount: conversationMembers(conv).length,
    contact: other ? publicUser(other) : null,
    online: presence ? presence.online : false,
    lastSeen: presence ? presence.lastSeen : null,
    lastMessage: last,
    unread,
    typing: typingFor(conv, viewerId),
    pinned: Boolean((conv.pinned || {})[viewerId]),
    muted: Boolean((conv.muted || {})[viewerId]),
    archived: Boolean((conv.archived || {})[viewerId]),
    createdAt: conv.createdAt,
    lastActivity: last ? last.createdAt : conv.createdAt,
  };
}

function pushSummary(conv, extraIds = []) {
  const ids = new Set([...conversationMembers(conv), ...extraIds]);
  for (const id of ids) {
    if (!isMember(conv, id)) continue;
    sendTo(id, { type: 'conv:update', conversation: summaryFor(conv, id) });
  }
}

/* ------------------------------- mídia ------------------------------- */

const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'application/pdf': '.pdf',
  'application/zip': '.zip',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'text/plain': '.txt',
  'text/csv': '.csv',
};

const ALLOWED_MIME = (mime = '') => {
  if (!mime || mime === 'image/svg+xml' || mime.includes('html') || mime.includes('javascript')) return false;
  return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || Boolean(MIME_EXT[mime]);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = MIME_EXT[file.mimetype] || (path.extname(file.originalname || '').toLowerCase().slice(0, 10) || '.bin');
    cb(null, newId('f_') + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME(file.mimetype)) return cb(new Error('Tipo de arquivo não suportado.'));
    cb(null, true);
  },
});

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const name = path.basename(filePath);
      if (!/\.(jpe?g|png|webp|gif|avif|mp4|webm|mov|ogg|mp3|m4a|wav)$/i.test(name)) {
        res.setHeader('Content-Disposition', 'attachment');
      }
    },
  })
);

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload.' });
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo recebido.' });
    const db = getDb();
    const kind = req.file.mimetype.startsWith('image/')
      ? 'image'
      : req.file.mimetype.startsWith('video/')
        ? 'video'
        : req.file.mimetype.startsWith('audio/')
          ? 'audio'
          : 'document';
    const meta = {
      id: newId('md_'),
      file: req.file.filename,
      mime: req.file.mimetype,
      name: String(req.body?.name || req.file.originalname || 'Arquivo').slice(0, 120),
      size: req.file.size,
      kind,
      duration: req.body?.duration ? Number(req.body.duration) : null,
      uploadedBy: req.user.id,
      createdAt: Date.now(),
    };
    db.media.push(meta);
    save();
    res.json({
      media: {
        id: meta.id,
        url: `/uploads/${meta.file}`,
        mime: meta.mime,
        name: meta.name,
        size: meta.size,
        kind: meta.kind,
        duration: meta.duration,
      },
    });
  });
});

/* ------------------------------- sessão ------------------------------- */

app.post('/api/login', (req, res) => {
  const db = getDb();
  const phoneDigits = normalizePhone(req.body?.phone);
  const name = String(req.body?.name || '').trim();
  if (phoneDigits.length < 8) return res.status(400).json({ error: 'Informe um número de telefone válido.' });
  let user = db.users.find((u) => normalizePhone(u.phone) === phoneDigits);
  if (!user) {
    if (name.length < 2) return res.status(400).json({ error: 'Informe seu nome para criar a conta.' });
    if (name.length > 40) return res.status(400).json({ error: 'Nome muito longo.' });
    user = {
      id: newId('u_'),
      name,
      phone: phoneDigits,
      about: 'Disponível',
      avatarText: name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase(),
      avatarColor: ['#00a884', '#e17076', '#7bc862', '#a695e7', '#65aadd'][Math.floor(Math.random() * 5)],
      isBot: false,
      lastSeen: Date.now(),
      createdAt: Date.now(),
    };
    db.users.push(user);
    provisionUser(user);
    saveNow();
  }
  user.lastSeen = Date.now();
  const token = startSession(req, res, user);
  res.json({ user: publicUser(user), token, settings: db.settings });
});

app.post('/api/demo', (req, res) => {
  const db = getDb();
  const user = findUser('u_me');
  if (!user) return res.status(500).json({ error: 'Conta demo indisponível. Reinicie o servidor.' });
  user.lastSeen = Date.now();
  const token = startSession(req, res, user);
  res.json({ user: publicUser(user), token, settings: db.settings });
});

app.post('/api/logout', (req, res) => {
  const session = sessionOf(req);
  const db = getDb();
  if (session) {
    delete db.sessions[session.token];
    session.user.lastSeen = Date.now();
    save();
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), settings: getDb().settings });
});

app.patch('/api/me', requireAuth, (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : undefined;
  const about = typeof req.body?.about === 'string' ? req.body.about.trim() : undefined;
  if (name !== undefined) {
    if (name.length < 2) return res.status(400).json({ error: 'Nome muito curto.' });
    req.user.name = name.slice(0, 40);
    req.user.avatarText = name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
  }
  if (about !== undefined) req.user.about = about.slice(0, 120) || 'Disponível';
  save();
  broadcast({ type: 'user:update', user: publicUser(req.user) });
  for (const conv of getDb().conversations) {
    if (isMember(conv, req.user.id)) pushSummary(conv);
  }
  res.json({ user: publicUser(req.user) });
});

app.get('/api/settings', requireAuth, (req, res) => res.json(getDb().settings));

app.patch('/api/settings', requireAuth, (req, res) => {
  const db = getDb();
  if (typeof req.body?.autoReplies === 'boolean') db.settings.autoReplies = req.body.autoReplies;
  save();
  res.json(db.settings);
});

/* ------------------------------ contatos ------------------------------ */

app.get('/api/users', requireAuth, (req, res) => {
  const db = getDb();
  res.json({
    users: db.users
      .filter((u) => u.id !== req.user.id)
      .map((u) => ({ ...publicUser(u), online: isOnline(u.id), lastSeen: u.lastSeen || null }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
  });
});

/* ---------------------------- conversas ---------------------------- */

function findDirectConversation(a, b) {
  return getDb().conversations.find(
    (c) => c.type === 'direct' && conversationMembers(c).length === 2 && conversationMembers(c).includes(a) && conversationMembers(c).includes(b)
  );
}

function conversationDetails(conv, viewerId) {
  const db = getDb();
  const clearedAt = (conv.clearedAt || {})[viewerId] || 0;
  const msgs = db.messages.filter((m) => m.conversationId === conv.id && m.createdAt > clearedAt && !m.deletedForMe.includes(viewerId));
  const members = conversationMembers(conv)
    .map((id) => findUser(id))
    .filter(Boolean)
    .map((u) => ({
      ...publicUser(u),
      online: isOnline(u.id),
      lastSeen: u.lastSeen || null,
      isMe: u.id === viewerId,
      isAdmin: conv.createdBy === u.id,
    }));
  return {
    conversation: summaryFor(conv, viewerId),
    members,
    stats: {
      messages: msgs.filter((m) => m.type !== 'system').length,
      media: msgs.filter((m) => ['image', 'video', 'audio', 'document'].includes(m.type)).length,
      firstMessageAt: msgs.length ? msgs[0].createdAt : null,
      createdAt: conv.createdAt,
    },
  };
}

app.get('/api/conversations', requireAuth, (req, res) => {
  const db = getDb();
  const list = db.conversations
    .filter((c) => isMember(c, req.user.id))
    .map((c) => summaryFor(c, req.user.id))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastActivity - a.lastActivity;
    });
  res.json({ conversations: list });
});

app.post('/api/conversations', requireAuth, (req, res) => {
  const db = getDb();
  const body = req.body || {};
  if (body.type === 'group') {
    const name = String(body.name || '').trim();
    if (name.length < 2) return res.status(400).json({ error: 'Dê um nome ao grupo.' });
    const memberIds = Array.from(new Set([...(Array.isArray(body.memberIds) ? body.memberIds : []), req.user.id])).filter((id) =>
      findUser(id)
    );
    if (memberIds.length < 2) return res.status(400).json({ error: 'Selecione pelo menos um participante.' });
    const conv = {
      id: newId('g_'),
      type: 'group',
      name: name.slice(0, 60),
      memberIds,
      createdBy: req.user.id,
      avatarColor: ['#00a884', '#6b7c85', '#e17076', '#a695e7', '#65aadd', '#f5a623'][Math.floor(Math.random() * 6)],
      createdAt: Date.now(),
      pinned: {},
      muted: {},
      archived: {},
      clearedAt: {},
    };
    db.conversations.push(conv);
    const systemMsg = {
      id: newId('m_'),
      conversationId: conv.id,
      senderId: 'system',
      type: 'system',
      body: `${req.user.name} criou o grupo "${conv.name}"`,
      createdAt: Date.now(),
      deliveredTo: [],
      readBy: [],
      deletedForMe: [],
      deletedForAll: false,
      reactions: {},
    };
    db.messages.push(systemMsg);
    saveNow();
    for (const id of memberIds) sendTo(id, { type: 'conv:new', conversation: summaryFor(conv, id) });
    pushSummary(conv);
    return res.status(201).json({ conversation: summaryFor(conv, req.user.id) });
  }

  const otherId = body.userId;
  const other = findUser(otherId);
  if (!other) return res.status(404).json({ error: 'Contato não encontrado.' });
  if (other.id === req.user.id) return res.status(400).json({ error: 'Você não pode conversar consigo mesmo.' });
  let conv = findDirectConversation(req.user.id, other.id);
  if (!conv) {
    conv = {
      id: newId('c_'),
      type: 'direct',
      memberIds: [req.user.id, other.id],
      createdBy: req.user.id,
      createdAt: Date.now(),
      pinned: {},
      muted: {},
      archived: {},
      clearedAt: {},
    };
    getDb().conversations.push(conv);
    saveNow();
    pushSummary(conv);
  }
  res.json({ conversation: summaryFor(conv, req.user.id) });
});

app.post('/api/conversations/:id/participants', requireAuth, (req, res) => {
  const db = getDb();
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Só grupos podem receber participantes.' });
  const user = findUser(req.body?.userId);
  if (!user) return res.status(404).json({ error: 'Contato não encontrado.' });
  if (conv.memberIds.includes(user.id)) return res.status(400).json({ error: `${user.name} já está no grupo.` });
  conv.memberIds.push(user.id);
  const msg = {
    id: newId('m_'),
    conversationId: conv.id,
    senderId: 'system',
    type: 'system',
    body: `${req.user.name} adicionou ${user.name}`,
    createdAt: Date.now(),
    deliveredTo: [],
    readBy: [],
    deletedForMe: [],
    deletedForAll: false,
    reactions: {},
  };
  db.messages.push(msg);
  saveNow();
  sendTo(user.id, { type: 'conv:new', conversation: summaryFor(conv, user.id) });
  emitMessage(conv, msg);
  pushSummary(conv);
  res.status(201).json({ conversation: summaryFor(conv, req.user.id), message: serializeMessage(msg, req.user.id) });
});

app.delete('/api/conversations/:id/participants/:userId', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  if (conv.type !== 'group') return res.status(400).json({ error: 'Só grupos têm participantes.' });
  const target = findUser(req.params.userId);
  if (!target || !conv.memberIds.includes(target.id)) return res.status(404).json({ error: 'Participante não encontrado.' });

  const isSelf = target.id === req.user.id;
  const isAdmin = conv.createdBy === req.user.id;
  if (!isSelf && !isAdmin) {
    return res.status(403).json({ error: 'Apenas administradores podem remover participantes.' });
  }
  conv.memberIds = conv.memberIds.filter((id) => id !== target.id);
  if (!conv.memberIds.length) {
    getDb().conversations = getDb().conversations.filter((c) => c.id !== conv.id);
    saveNow();
    return res.json({ ok: true, conversation: null });
  }
  if (conv.createdBy === target.id) conv.createdBy = conv.memberIds[0];

  const msg = {
    id: newId('m_'),
    conversationId: conv.id,
    senderId: 'system',
    type: 'system',
    body: isSelf ? `${req.user.name} saiu do grupo` : `${req.user.name} removeu ${target.name}`,
    createdAt: Date.now(),
    deliveredTo: [],
    readBy: [],
    deletedForMe: [],
    deletedForAll: false,
    reactions: {},
  };
  getDb().messages.push(msg);
  saveNow();
  sendTo(target.id, { type: 'conv:leave', conversationId: conv.id, title: conv.name || 'Grupo', self: isSelf });
  emitMessage(conv, msg);
  pushSummary(conv);
  res.json({ ok: true, conversation: isSelf ? null : summaryFor(conv, req.user.id) });
});

app.get('/api/conversations/:id', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  res.json(conversationDetails(conv, req.user.id));
});

app.get('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const db = getDb();
  const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 100);
  const before = Number(req.query.before) || Infinity;
  const clearedAt = (conv.clearedAt || {})[req.user.id] || 0;
  const visible = db.messages.filter(
    (m) =>
      m.conversationId === conv.id &&
      m.createdAt > clearedAt &&
      m.createdAt < before &&
      !m.deletedForMe.includes(req.user.id)
  );
  const slice = visible.slice(-limit);
  const hasMore = visible.length > slice.length;
  res.json({
    messages: slice.map((m) => serializeMessage(m, req.user.id)),
    hasMore,
    conversation: summaryFor(conv, req.user.id),
  });
});

function emitMessage(conv, msg) {
  const db = getDb();
  // destinatários conectados recebem entrega imediata
  for (const memberId of conversationMembers(conv)) {
    if (memberId === msg.senderId) continue;
    if (isOnline(memberId) && !msg.deliveredTo.includes(memberId)) msg.deliveredTo.push(memberId);
  }
  save();
  for (const memberId of conversationMembers(conv)) {
    sendTo(memberId, {
      type: 'message',
      message: serializeMessage(msg, memberId),
      conversation: summaryFor(conv, memberId),
    });
  }
  return msg;
}

app.post('/api/conversations/:id/messages', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const db = getDb();
  const allowedTypes = ['text', 'image', 'video', 'audio', 'document'];
  const type = allowedTypes.includes(req.body?.type) ? req.body.type : 'text';
  const body = String(req.body?.body || '').slice(0, 4096);
  const mediaId = req.body?.mediaId || null;
  const media = mediaId ? mediaOf(mediaId) : null;
  if (type !== 'text' && !media) return res.status(400).json({ error: 'Mídia inválida ou expirada.' });
  if (type === 'text' && !body.trim()) return res.status(400).json({ error: 'Mensagem vazia.' });
  let quoted = null;
  if (req.body?.quotedId) {
    quoted = db.messages.find((m) => m.id === req.body.quotedId && m.conversationId === conv.id);
  }
  const msg = {
    id: newId('m_'),
    conversationId: conv.id,
    senderId: req.user.id,
    type: media ? (media.kind === 'image' || media.kind === 'video' || media.kind === 'audio' ? media.kind : 'document') : type,
    body,
    mediaId: media ? media.id : null,
    duration: req.body?.duration ? Math.max(0, Math.min(Number(req.body.duration), 3600)) : null,
    quotedId: quoted ? quoted.id : null,
    createdAt: Date.now(),
    deliveredTo: [],
    readBy: [],
    deletedForMe: [],
    deletedForAll: false,
    reactions: {},
  };
  db.messages.push(msg);
  saveNow();
  typingState.delete(`${conv.id}:${req.user.id}`);
  for (const memberId of conversationMembers(conv)) {
    if (memberId === req.user.id) continue;
    sendTo(memberId, { type: 'typing', conversationId: conv.id, userId: req.user.id, name: req.user.name, until: 0 });
  }
  emitMessage(conv, msg);
  res.status(201).json({ message: serializeMessage(msg, req.user.id), conversation: summaryFor(conv, req.user.id) });
  maybeAutoReply(conv, msg);
});

app.post('/api/conversations/:id/read', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const db = getDb();
  const clearedAt = (conv.clearedAt || {})[req.user.id] || 0;
  const affected = new Map(); // messageId -> senderId
  for (const msg of db.messages) {
    if (msg.conversationId !== conv.id) continue;
    if (msg.senderId === req.user.id) continue;
    if (msg.createdAt <= clearedAt) continue;
    if (msg.deletedForAll || msg.deletedForMe.includes(req.user.id)) continue;
    if (!msg.deliveredTo.includes(req.user.id)) msg.deliveredTo.push(req.user.id);
    if (!msg.readBy.includes(req.user.id)) {
      msg.readBy.push(req.user.id);
      affected.set(msg.id, msg.senderId);
    }
  }
  save();
  for (const [messageId, senderId] of affected) {
    const msg = db.messages.find((m) => m.id === messageId);
    if (!msg) continue;
    sendTo(senderId, {
      type: 'message:update',
      message: serializeMessage(msg, senderId),
      conversation: summaryFor(conv, senderId),
    });
  }
  pushSummary(conv);
  res.json({ ok: true, conversation: summaryFor(conv, req.user.id) });
});

const typingState = new Map();

app.post('/api/conversations/:id/typing', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const until = Date.now() + 4200;
  typingState.set(`${conv.id}:${req.user.id}`, { userId: req.user.id, name: req.user.name, until });
  for (const memberId of conversationMembers(conv)) {
    if (memberId === req.user.id) continue;
    sendTo(memberId, { type: 'typing', conversationId: conv.id, userId: req.user.id, name: req.user.name, until });
  }
  res.json({ ok: true });
});

app.patch('/api/conversations/:id', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const fields = ['pinned', 'muted', 'archived'];
  for (const field of fields) {
    if (typeof req.body?.[field] === 'boolean') {
      conv[field] = conv[field] || {};
      if (req.body[field]) conv[field][req.user.id] = true;
      else delete conv[field][req.user.id];
    }
  }
  save();
  res.json({ conversation: summaryFor(conv, req.user.id) });
});

app.post('/api/conversations/:id/clear', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  conv.clearedAt = conv.clearedAt || {};
  conv.clearedAt[req.user.id] = Date.now();
  saveNow();
  res.json({ ok: true, conversation: summaryFor(conv, req.user.id) });
});

app.delete('/api/conversations/:id/messages/:messageId', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const db = getDb();
  const msg = db.messages.find((m) => m.id === req.params.messageId && m.conversationId === conv.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  const scope = req.query.scope === 'all' ? 'all' : 'me';
  if (scope === 'all') {
    if (msg.senderId !== req.user.id) return res.status(403).json({ error: 'Você só pode apagar mensagens suas para todos.' });
    if (Date.now() - msg.createdAt > 1000 * 60 * 60 * 24 * 2) {
      return res.status(400).json({ error: 'Essa mensagem é antiga demais para apagar para todos.' });
    }
    msg.deletedForAll = true;
    msg.body = '';
    msg.mediaId = null;
  } else {
    if (!msg.deletedForMe.includes(req.user.id)) msg.deletedForMe.push(req.user.id);
    sendTo(req.user.id, { type: 'message:remove', conversationId: conv.id, messageId: msg.id });
  }
  save();
  broadcastMembers(conv, (memberId) => {
    if (scope === 'me' && memberId === req.user.id) return null;
    if (scope === 'all') return { type: 'message:update', message: serializeMessage(msg, memberId), conversation: summaryFor(conv, memberId) };
    return null;
  });
  pushSummary(conv);
  res.json({ ok: true, conversation: summaryFor(conv, req.user.id) });
});

app.post('/api/conversations/:id/messages/:messageId/react', requireAuth, (req, res) => {
  const conv = findConversation(req.params.id);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const db = getDb();
  const msg = db.messages.find((m) => m.id === req.params.messageId && m.conversationId === conv.id);
  if (!msg) return res.status(404).json({ error: 'Mensagem não encontrada.' });
  const emoji = String(req.body?.emoji || '').slice(0, 8);
  msg.reactions = msg.reactions || {};
  if (!emoji || msg.reactions[req.user.id] === emoji) delete msg.reactions[req.user.id];
  else msg.reactions[req.user.id] = emoji;
  save();
  broadcastMembers(conv, (memberId) => ({
    type: 'message:update',
    message: serializeMessage(msg, memberId),
  }));
  res.json({ ok: true, reactions: msg.reactions });
});

/* ------------------------------- chamadas ------------------------------- */

app.post('/api/calls', requireAuth, (req, res) => {
  const conv = findConversation(req.body?.conversationId);
  if (!conv || !isMember(conv, req.user.id)) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const kind = req.body?.kind === 'video' ? 'video' : 'audio';
  const duration = Math.max(0, Math.round(Number(req.body?.duration) || 0));
  const status = ['outgoing', 'answered', 'missed'].includes(req.body?.status) ? req.body.status : 'outgoing';
  const db = getDb();
  const msg = {
    id: newId('m_'),
    conversationId: conv.id,
    senderId: req.user.id,
    type: 'call',
    body: '',
    meta: { kind, duration, status },
    createdAt: Date.now(),
    deliveredTo: [],
    readBy: [],
    deletedForMe: [],
    deletedForAll: false,
    reactions: {},
  };
  db.messages.push(msg);
  saveNow();
  emitMessage(conv, msg);
  res.status(201).json({ message: serializeMessage(msg, req.user.id) });
});

/* -------------------------------- busca -------------------------------- */

app.get('/api/search', requireAuth, (req, res) => {
  const db = getDb();
  const q = fold(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const myConvs = db.conversations.filter((c) => isMember(c, req.user.id));
  const convMap = new Map(myConvs.map((c) => [c.id, c]));
  const results = [];
  for (let i = db.messages.length - 1; i >= 0; i--) {
    if (results.length >= 40) break;
    const msg = db.messages[i];
    const conv = convMap.get(msg.conversationId);
    if (!conv) continue;
    if (msg.deletedForAll || msg.deletedForMe.includes(req.user.id)) continue;
    const clearedAt = (conv.clearedAt || {})[req.user.id] || 0;
    if (msg.createdAt <= clearedAt) continue;
    const haystack = fold(`${msg.body || ''} ${messagePreview(msg)}`);
    if (!haystack.includes(q)) continue;
    results.push({
      message: serializeMessage(msg, req.user.id),
      conversation: summaryFor(conv, req.user.id),
    });
  }
  results.sort((a, b) => b.message.createdAt - a.message.createdAt);
  res.json({ results });
});

/* -------------------------------- eventos -------------------------------- */

app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  const userId = req.user.id;
  req.user.lastSeen = Date.now();
  let set = clients.get(userId);
  if (!set) clients.set(userId, (set = new Set()));
  set.add(res);

  const activeBots = Array.from(botActive.entries())
    .filter(([, until]) => until > Date.now())
    .map(([id]) => id);
  sendTo(userId, {
    type: 'ready',
    userId,
    online: Array.from(new Set([...clients.keys(), ...activeBots])),
  });

  // entrega mensagens pendentes (recibos de entrega)
  const db = getDb();
  const pending = new Map();
  for (const conv of db.conversations) {
    if (!isMember(conv, userId)) continue;
    for (const msg of db.messages) {
      if (msg.conversationId !== conv.id) continue;
      if (msg.senderId === userId) continue;
      if (msg.deliveredTo.includes(userId)) continue;
      msg.deliveredTo.push(userId);
      pending.set(msg.id, msg);
    }
  }
  if (pending.size) {
    save();
    for (const msg of pending.values()) {
      if (msg.senderId === 'system') continue;
      const sender = findUser(msg.senderId);
      const conv = findConversation(msg.conversationId);
      if (!sender || !conv) continue;
      sendTo(msg.senderId, { type: 'message:update', message: serializeMessage(msg, msg.senderId), conversation: summaryFor(conv, msg.senderId) });
    }
  }

  broadcast(presenceSnapshot());
  req.on('close', () => {
    set.delete(res);
    if (set.size === 0) {
      clients.delete(userId);
      req.user.lastSeen = Date.now();
      save();
      broadcast(presenceSnapshot());
    }
  });
});

const heartbeat = setInterval(() => {
  for (const set of clients.values()) {
    for (const res of set) {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }
  }
}, 25_000);
heartbeat.unref?.();

/* --------------------------- respostas automáticas --------------------------- */

const BOT_LINES = {
  ana: {
    greeting: ['Oi! 😄 Tudo bem sim, e você?', 'Oi, tudo bom? Que bom te ver por aqui!', 'Oii! Tô aqui sim 😊'],
    thanks: ['Imagina! 😊', 'Por nada!', 'Precisando é só chamar ❤️'],
    question: [
      'Boa pergunta! Deixa eu ver aqui e já te falo 👀',
      'Hmm, acho que sim! Depois te confirmo com certeza 😊',
      'Sim! Fechado então ✅',
    ],
    media: ['Adorei! 😍', 'Que foto boa! Salvando aqui', 'Recebi! Ficou ótimo 👏'],
    default: ['Perfeito!', 'Combinado 😊', 'Boa! Me conta mais', 'Hahaha amei', 'Tô de acordo!', 'Já anotei aqui ✅'],
  },
  bruno: {
    greeting: ['E aí, beleza? 😎', 'Fala, mano! Tudo certo?', 'Opa! Tranquilo?'],
    thanks: ['Valeu! 👊', 'Tamo junto!', 'Nada, parça'],
    question: ['Acho que sim, mano. Bora?', 'Vou ver e te falo, mas acho que dá', 'Só se for agora 😂'],
    media: ['Olha essa! 🔥', 'Boa, mano!', 'Ficou top demais'],
    default: ['Hahaha boa', 'Fechou!', 'Bora! ⚽', 'Sério? 😂', 'Tamo junto', 'Aham, entendi'],
  },
  carla: {
    greeting: ['Oi! Tudo bem? ✨', 'Oii, tudo ótimo por aqui 😊', 'Hello! Como vai?'],
    thanks: ['Por nada! 🎨', 'Imagina, adorei ajudar', 'Fico feliz que gostou ❤️'],
    question: ['Acho que vale a pena tentar sim!', 'Deixa eu achar a referência e te mando', 'Sim, com certeza ✨'],
    media: ['Que lindo! 😍', 'Amei as cores', 'Isso combina muito com o projeto'],
    default: ['Adorei ✨', 'Faz sentido!', 'Já tô imaginando aqui', 'Vou ajustar e te mostro', 'Boa!'],
  },
  diego: {
    greeting: ['Oi! Tudo certo por aqui 👋', 'Fala! Tudo beleza?', 'Opa, oi!'],
    thanks: ['De boa!', 'Tamo junto 🐛', 'Nada, precisando manda aí'],
    question: ['Pelo que vi, sim. Vou confirmar no log', 'Deve ser o cache, tenta limpar', 'Acho que já resolvi isso no último commit'],
    media: ['Vi aqui, top!', 'Boa!', 'Registrei no backlog 😄'],
    default: ['Boa!', 'Faz sentido', 'Vou dar uma olhada', 'Ok! ✅', 'Deploy feito 🚀', 'Hmm, interessante'],
  },
  lucia: {
    greeting: ['Oi, meu amor! ❤️', 'Oi, filho! Tudo bem com você?', 'Bom te falar! 😊'],
    thanks: ['De nada, meu filho ❤️', 'Sempre que precisar', 'Que isso, imagina!'],
    question: ['Acho que sim, filho. Depois te falo', 'Vou confirmar com seu pai', 'Sim, pode deixar!'],
    media: ['Que coisa mais linda! 😍', 'Adorei, meu filho ❤️', 'Que gracinha!'],
    default: ['Que bom, filho ❤️', 'Deus te abençoe', 'Beijo, se cuida!', 'Amo você ❤️', 'Combinado!'],
  },
  paulo: {
    greeting: ['Oi! Tudo tranquilo?', 'Fala, filho!', 'Opa, bom te ver!'],
    thanks: ['De nada!', 'Tranquilo 👍', 'Imagina'],
    question: ['Acho que dá sim. Vou ver aqui', 'Confirmo com sua mãe e te falo', 'Pode deixar, filho'],
    media: ['Ficou bom! 👍', 'Opa, gostei!', 'Show'],
    default: ['Beleza!', 'Combinado 👍', 'Boa', 'Vou ver aqui', 'Aham'],
  },
  julia: {
    greeting: ['Oii! Tudo bem? 😊', 'Oi! Tudo ótimo, e você?', 'Opa, oi!'],
    thanks: ['Por nada! ❤️', 'Imagina haha', 'Tamo junto'],
    question: ['Acho que sim! Depois te falo', 'Não sei, deixa eu ver com a mamãe', 'Sim, provavelmente 😄'],
    media: ['Amei! 😍', 'Que legal!', 'Hahaha adorei'],
    default: ['Hahaha sério?', 'Sim! ❤️', 'Nossa, que legal', 'Tô indo pra faculdade agora 😴', 'Beleza!'],
  },
};

function pickBotLine(bot, incoming) {
  const lines = BOT_LINES[bot.botStyle] || BOT_LINES.ana;
  const t = String(incoming.body || '').toLowerCase();
  const random = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (incoming.type && incoming.type !== 'text' && incoming.type !== 'call') return random(lines.media);
  if (/^(oi|ola|olá|opa|e ai|e aí|bom dia|boa tarde|boa noite|salve)\b/i.test(t)) return random(lines.greeting);
  if (/obrigad|valeu|vlw|agradec/i.test(t)) return random(lines.thanks);
  if (t.includes('?')) return random(lines.question);
  return random(lines.default);
}

function markDeliveredToConv(conv, userId) {
  const db = getDb();
  const changed = [];
  for (const msg of db.messages) {
    if (msg.conversationId !== conv.id) continue;
    if (msg.senderId === userId) continue;
    if (msg.deliveredTo.includes(userId)) continue;
    msg.deliveredTo.push(userId);
    changed.push(msg);
  }
  return changed;
}

function markReadToConv(conv, userId) {
  const db = getDb();
  const changed = [];
  for (const msg of db.messages) {
    if (msg.conversationId !== conv.id) continue;
    if (msg.senderId === userId) continue;
    if (!msg.deliveredTo.includes(userId)) msg.deliveredTo.push(userId);
    if (!msg.readBy.includes(userId)) {
      msg.readBy.push(userId);
      changed.push(msg);
    }
  }
  return changed;
}

function maybeAutoReply(conv, msg) {
  const db = getDb();
  if (!db.settings.autoReplies) return;
  if (!msg.senderId || msg.senderId === 'system') return;
  if (msg.type === 'call') return;

  let bot = null;
  if (conv.type === 'direct') {
    const other = otherMember(conv, msg.senderId);
    if (other && other.isBot) bot = other;
  } else {
    const bots = conversationMembers(conv)
      .map((id) => findUser(id))
      .filter((u) => u && u.isBot);
    if (!bots.length) return;
    const mentioned = bots.find((b) => String(msg.body || '').toLowerCase().includes(b.name.split(' ')[0].toLowerCase()));
    if (mentioned) bot = mentioned;
    else if (Math.random() < 0.55 && msg.type === 'text') {
      const lastBot = db.messages
        .filter((m) => m.conversationId === conv.id && m.senderId !== msg.senderId && findUser(m.senderId)?.isBot)
        .slice(-1)[0];
      if (!lastBot || Date.now() - lastBot.createdAt > 12_000) bot = bots[Math.floor(Math.random() * bots.length)];
    }
  }
  if (!bot) return;
  const key = `${conv.id}:${bot.id}`;
  if (botPending.has(key)) return;
  botPending.add(key);

  const typingDelay = 700 + Math.random() * 900;
  const replyDelay = 1500 + Math.random() * 2200;

  setTimeout(() => {
    const freshConv = findConversation(conv.id);
    if (!freshConv) {
      botPending.delete(key);
      return;
    }
    const delivered = markDeliveredToConv(freshConv, bot.id);
    save();
    for (const changed of delivered) {
      if (changed.senderId === 'system') continue;
      sendTo(changed.senderId, { type: 'message:update', message: serializeMessage(changed, changed.senderId) });
    }

    setBotActive(bot.id, 25_000);
    const until = Date.now() + 5000;
    typingState.set(`${conv.id}:${bot.id}`, { userId: bot.id, name: bot.name, until });
    for (const memberId of conversationMembers(freshConv)) {
      if (memberId === bot.id) continue;
      sendTo(memberId, { type: 'typing', conversationId: conv.id, userId: bot.id, name: bot.name, until });
    }
    broadcast(presenceSnapshot());

    const timer = setTimeout(() => {
      botPending.delete(key);
      const current = findConversation(conv.id);
      if (!current) return;
      const line = pickBotLine(bot, msg);
      const reply = {
        id: newId('m_'),
        conversationId: conv.id,
        senderId: bot.id,
        type: 'text',
        body: line,
        quotedId: conv.type === 'group' ? msg.id : null,
        createdAt: Date.now(),
        deliveredTo: [],
        readBy: [bot.id],
        deletedForMe: [],
        deletedForAll: false,
        reactions: {},
      };
      getDb().messages.push(reply);
      setBotActive(bot.id, 12_000);
      typingState.delete(`${conv.id}:${bot.id}`);
      saveNow();
      emitMessage(current, reply);

      const read = markReadToConv(current, bot.id);
      save();
      for (const changed of read) {
        if (changed.senderId === 'system') continue;
        sendTo(changed.senderId, { type: 'message:update', message: serializeMessage(changed, changed.senderId) });
      }
      typingState.delete(`${conv.id}:${bot.id}`);
      for (const memberId of conversationMembers(current)) {
        if (memberId === bot.id) continue;
        sendTo(memberId, { type: 'typing', conversationId: conv.id, userId: bot.id, name: bot.name, until: 0 });
      }
      setBotActive(bot.id, 6000);
      broadcast(presenceSnapshot());
    }, replyDelay);
    timer.unref?.();
  }, typingDelay).unref?.();
}

/* ------------------------------ provisionamento ------------------------------ */

function provisionUser(user) {
  const db = getDb();
  if (db.conversations.some((c) => isMember(c, user.id))) return;
  const now = Date.now();
  const firstName = user.name.split(/\s+/)[0];
  const direct = {
    id: newId('c_'),
    type: 'direct',
    memberIds: [user.id, 'u_ana'],
    createdBy: 'u_ana',
    createdAt: now,
    pinned: {},
    muted: {},
    archived: {},
    clearedAt: {},
  };
  const group = {
    id: newId('g_'),
    type: 'group',
    name: 'Boas-vindas 👋',
    memberIds: [user.id, 'u_ana', 'u_bruno', 'u_carla'],
    createdBy: 'u_ana',
    avatarColor: '#00a884',
    createdAt: now,
    pinned: {},
    muted: {},
    archived: {},
    clearedAt: {},
  };
  db.conversations.push(direct, group);
  const mk = (conversationId, senderId, body, offset) => ({
    id: newId('m_'),
    conversationId,
    senderId,
    type: 'text',
    body,
    createdAt: now - offset,
    deliveredTo: [user.id],
    readBy: senderId === user.id ? [] : [],
    deletedForMe: [],
    deletedForAll: false,
    reactions: {},
  });
  db.messages.push(
    mk(direct.id, 'u_ana', `Oi, ${firstName}! Tudo bem? 😊`, 4000),
    mk(direct.id, 'u_ana', 'Seja bem-vindo(a) ao WhatsApp Web demo! Me manda uma mensagem pra testar — eu respondo na hora.', 3000),
    mk(group.id, 'u_ana', `Gente, o ${firstName} entrou no grupo! 🎉`, 2000),
    mk(group.id, 'u_bruno', 'Bem-vindo(a)! Manda um "oi" que a gente testa junto 😄', 1000)
  );
  saveNow();
}

/* -------------------------------- estáticos -------------------------------- */

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: 0,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Rota não encontrada.' });
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[erro]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  WhatsApp Web demo rodando em http://localhost:${PORT}\n`);
  console.log('  Conta demo: Alex Moreira (+55 61 99999-0001)');
  console.log('  Dica: abra outra janela anônima, crie uma conta com outro número e converse entre as duas.\n');
});

process.on('SIGTERM', () => {
  try {
    saveNow();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

process.on('SIGINT', () => {
  try {
    saveNow();
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});

export { app, resetDb };
