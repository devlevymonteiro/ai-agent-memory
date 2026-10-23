import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, 'uploads');

const DB_FILE = path.join(DATA_DIR, 'db.json');

export const newId = (prefix = '') => prefix + crypto.randomBytes(9).toString('hex');

const MIN = 60_000;
const now = Date.now();
const ago = (minutes) => now - Math.round(minutes * MIN);

const COLORS = ['#00a884', '#e17076', '#7bc862', '#a695e7', '#ee7aae', '#f5a623', '#65aadd', '#8e44ad', '#e67e22', '#1abc9c'];

const avatarText = (name) =>
  name
    .replace(/[^\p{L}\s]/gu, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

function user(id, name, phone, about, color, extra = {}) {
  return {
    id,
    name,
    phone,
    about,
    avatarText: avatarText(name),
    avatarColor: color,
    isBot: false,
    lastSeen: ago(Math.round(20 + Math.random() * 900)),
    ...extra,
  };
}

function buildSeed() {
  const users = [
    user('u_me', 'Alex Moreira', '5561999990001', 'Focado no projeto Phoenix 🚀', '#00a884', {
      lastSeen: Date.now(),
    }),
    user('u_ana', 'Ana Beatriz', '5561988881234', 'Café, código e café ☕', '#e17076', {
      isBot: true,
      botStyle: 'ana',
      lastSeen: ago(3),
    }),
    user('u_bruno', 'Bruno Carvalho', '5511977774321', 'Bora jogar bola ⚽', '#7bc862', {
      isBot: true,
      botStyle: 'bruno',
      lastSeen: ago(48),
    }),
    user('u_carla', 'Carla Menezes', '5521966668765', 'Design é detalhe ✨', '#a695e7', {
      isBot: true,
      botStyle: 'carla',
      lastSeen: ago(9),
    }),
    user('u_diego', 'Diego Ramos', '5511955559087', 'Debugando a vida 🐛', '#65aadd', {
      isBot: true,
      botStyle: 'diego',
      lastSeen: ago(120),
    }),
    user('u_lucia', 'Lúcia Moreira', '5561977770002', 'Deus é bom 🙏', '#ee7aae', {
      isBot: true,
      botStyle: 'lucia',
      lastSeen: ago(15),
    }),
    user('u_paulo', 'Paulo Moreira', '5561966660003', 'Churrasco no domingo? 🥩', '#f5a623', {
      isBot: true,
      botStyle: 'paulo',
      lastSeen: ago(35),
    }),
    user('u_julia', 'Júlia Moreira', '5561955550004', 'Faculdade + estágio 😴', '#8e44ad', {
      isBot: true,
      botStyle: 'julia',
      lastSeen: ago(5),
    }),
  ];

  const conversations = [
    {
      id: 'c_ana',
      type: 'direct',
      memberIds: ['u_me', 'u_ana'],
      createdAt: ago(60 * 24 * 33),
      pinned: {},
      muted: {},
      archived: {},
    },
    {
      id: 'c_bruno',
      type: 'direct',
      memberIds: ['u_me', 'u_bruno'],
      createdAt: ago(60 * 24 * 21),
      pinned: {},
      muted: {},
      archived: {},
    },
    {
      id: 'c_carla',
      type: 'direct',
      memberIds: ['u_me', 'u_carla'],
      createdAt: ago(60 * 24 * 12),
      pinned: {},
      muted: {},
      archived: {},
    },
    {
      id: 'c_diego',
      type: 'direct',
      memberIds: ['u_me', 'u_diego'],
      createdAt: ago(60 * 24 * 9),
      pinned: {},
      muted: {},
      archived: {},
    },
    {
      id: 'g_familia',
      type: 'group',
      name: 'Família Moreira 💛',
      avatarColor: '#e17076',
      memberIds: ['u_me', 'u_lucia', 'u_paulo', 'u_julia'],
      createdBy: 'u_lucia',
      createdAt: ago(60 * 24 * 210),
      pinned: { u_me: true },
      muted: {},
      archived: {},
    },
    {
      id: 'g_phoenix',
      type: 'group',
      name: 'Projeto Phoenix 🚀',
      avatarColor: '#65aadd',
      memberIds: ['u_me', 'u_ana', 'u_bruno', 'u_carla', 'u_diego'],
      createdBy: 'u_ana',
      createdAt: ago(60 * 24 * 47),
      pinned: { u_me: true },
      muted: {},
      archived: {},
    },
    {
      id: 'g_futebol',
      type: 'group',
      name: 'Futebol de Quarta ⚽',
      avatarColor: '#f5a623',
      memberIds: ['u_me', 'u_bruno', 'u_diego', 'u_paulo'],
      createdBy: 'u_bruno',
      createdAt: ago(60 * 24 * 70),
      pinned: {},
      muted: { u_me: true },
      archived: {},
    },
  ];

  const messages = [];
  const add = (conversationId, senderId, body, minutesAgo, extra = {}) => {
    messages.push({
      id: newId('m_'),
      conversationId,
      senderId,
      type: 'text',
      body,
      createdAt: ago(minutesAgo),
      deliveredTo: [],
      readBy: [],
      deletedForMe: [],
      deletedForAll: false,
      reactions: {},
      ...extra,
    });
  };

  // Ana — conversa principal
  add('c_ana', 'u_ana', 'Oi, Alex! Tudo bem? 😊', 55);
  add('c_ana', 'u_me', 'Oi, Ana! Tudo ótimo, e você?', 52);
  add('c_ana', 'u_ana', 'Tô bem! Conseguiu revisar o layout novo do app?', 50);
  add('c_ana', 'u_me', 'Consegui sim. Ficou muito bom, só ajustei uns espaçamentos no header e no card de saldo.', 47);
  add('c_ana', 'u_ana', 'Perfeito! Vou subir a versão final hoje à tarde então 🚀', 45);
  add('c_ana', 'u_ana', 'Ah, e a gente marcou o café amanhã às 10h, né?', 12);
  add('c_ana', 'u_ana', 'Me confirma depois! ☕', 11);

  // Bruno
  add('c_bruno', 'u_bruno', 'Cara, você viu o jogo ontem? 😱', 130);
  add('c_bruno', 'u_me', 'Vi! Que virada no final, inacreditável', 128);
  add('c_bruno', 'u_bruno', 'Melhor jogo do ano, sem dúvida nenhuma', 125);
  add('c_bruno', 'u_me', 'Bora no futebol de quarta?', 100);
  add('c_bruno', 'u_bruno', 'Tô dentro. Vou chamar o pessoal no grupo', 98);

  // Carla
  add('c_carla', 'u_me', 'Carla, mandei as referências no drive, dá uma olhada', 300);
  add('c_carla', 'u_carla', 'Recebi! Já comecei a montar o moodboard 🎨', 290);
  add('c_carla', 'u_carla', 'Depois te mostro as opções, acho que ficou bem na linha do que a gente falou', 280);

  // Diego
  add('c_diego', 'u_diego', 'Subi o fix do bug do login no staging', 1440);
  add('c_diego', 'u_me', 'Boa! Vou testar agora', 1430);
  add('c_diego', 'u_diego', 'Acho que resolve o loop de refresh. Se voltar, me manda o console', 1425);

  // Família
  add('g_familia', 'u_lucia', 'Bom dia, meus filhos! ☀️', 600);
  add('g_familia', 'u_julia', 'Bom dia, mãe! ❤️', 598);
  add('g_familia', 'u_me', 'Bom dia! 😄', 590);
  add('g_familia', 'u_paulo', 'Almoço no domingo tá confirmado? 🥩', 120);
  add('g_familia', 'u_lucia', 'Confirmadíssimo! Eu levo a sobremesa 🍰', 118);
  add('g_familia', 'u_julia', 'Eu levo o suco 🧃', 115);

  // Trabalho
  add('g_phoenix', 'u_ana', 'Pessoal, a daily mudou pra 9h30 a partir de amanhã', 400);
  add('g_phoenix', 'u_bruno', 'Anotado ✅', 398);
  add('g_phoenix', 'u_carla', 'Beleza!', 396);
  add('g_phoenix', 'u_diego', 'Tô no lab, entro pelo celular', 390);
  add('g_phoenix', 'u_me', 'Combinado, nos vemos lá', 380);
  add('g_phoenix', 'u_carla', 'Subi o protótipo novo no Figma, dá uma olhada quando puderem 👀', 60);
  add('g_phoenix', 'u_bruno', 'Olhei rápido, ficou show', 58);

  // Futebol
  add('g_futebol', 'u_bruno', 'Quarta 20h no campo de sempre, quem vai?', 220);
  add('g_futebol', 'u_diego', 'Eu vou ⚽', 215);
  add('g_futebol', 'u_paulo', 'Tô dentro', 210);
  add('g_futebol', 'u_me', 'Também vou!', 200);

  // Reação de exemplo
  const anaLast = messages.filter((m) => m.conversationId === 'c_ana').slice(-2);
  if (anaLast.length) anaLast[0].reactions = { u_me: '❤️' };

  // Recibos: mensagens antigas ficam entregues e lidas
  const convById = new Map(conversations.map((c) => [c.id, c]));
  const membersOf = (conv) => conv.memberIds || [];
  for (const msg of messages) {
    const conv = convById.get(msg.conversationId);
    for (const memberId of membersOf(conv)) {
      if (memberId === msg.senderId) continue;
      msg.deliveredTo.push(memberId);
      if (msg.createdAt < Date.now() - 20 * MIN) msg.readBy.push(memberId);
    }
  }

  // Deixa duas mensagens da Ana não lidas para o usuário demo (badge)
  for (const msg of messages.filter((m) => m.conversationId === 'c_ana' && m.senderId === 'u_ana').slice(-2)) {
    msg.readBy = msg.readBy.filter((id) => id !== 'u_me');
  }
  for (const msg of messages.filter((m) => m.conversationId === 'g_familia' && m.senderId === 'u_lucia').slice(-1)) {
    msg.readBy = msg.readBy.filter((id) => id !== 'u_me');
  }
  for (const msg of messages.filter((m) => m.conversationId === 'g_phoenix' && m.senderId === 'u_carla').slice(-1)) {
    msg.readBy = msg.readBy.filter((id) => id !== 'u_me');
  }

  // Mensagens minhas recentes: uma entregue (✓✓) e uma apenas enviada (✓)
  const brunoMine = messages.filter((m) => m.conversationId === 'c_bruno' && m.senderId === 'u_me').slice(-1)[0];
  if (brunoMine) {
    brunoMine.readBy = [];
    brunoMine.deliveredTo = brunoMine.deliveredTo.filter((id) => id !== 'u_bruno');
  }
  const familiaMine = messages.filter((m) => m.conversationId === 'g_familia' && m.senderId === 'u_me').slice(-1)[0];
  if (familiaMine) familiaMine.readBy = familiaMine.readBy.filter((id) => id === 'u_julia');

  return {
    version: 1,
    users,
    conversations,
    messages,
    media: [],
    calls: [],
    sessions: {},
    settings: { autoReplies: true },
    meta: { createdAt: now },
  };
}

let db = null;
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.users) && Array.isArray(parsed.messages)) return parsed;
    }
  } catch (err) {
    console.warn('[db] falha ao ler banco, recriando:', err.message);
  }
  return null;
}

export function getDb() {
  if (!db) {
    db = load() || buildSeed();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    saveNow();
  }
  return db;
}

export function saveNow() {
  if (!db) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      saveNow();
    } catch (err) {
      console.warn('[db] falha ao salvar:', err.message);
    }
  }, 250);
}

export function resetDb() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  db = buildSeed();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  saveNow();
  return db;
}

/* ------------------------------- helpers ------------------------------- */

export const findUser = (id) => getDb().users.find((u) => u.id === id);
export const findConversation = (id) => getDb().conversations.find((c) => c.id === id);

export function conversationMembers(conv) {
  return conv && Array.isArray(conv.memberIds) ? conv.memberIds : [];
}

export function otherMember(conv, viewerId) {
  if (!conv || conv.type !== 'direct') return null;
  const otherId = conversationMembers(conv).find((id) => id !== viewerId);
  return otherId ? findUser(otherId) : null;
}

export function isMember(conv, userId) {
  return conversationMembers(conv).includes(userId);
}

export function conversationTitle(conv, viewerId) {
  if (conv.type === 'group') return conv.name;
  const other = otherMember(conv, viewerId);
  return other ? other.name : 'Contato';
}

export function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

export function avatarFor(user) {
  return { avatarText: user.avatarText, avatarColor: user.avatarColor };
}

export function conversationAvatar(conv, viewerId) {
  if (conv.type === 'group') {
    return { avatarText: conv.avatarText || avatarText(conv.name || 'Grupo'), avatarColor: conv.avatarColor || '#6b7c85' };
  }
  const other = otherMember(conv, viewerId);
  return other ? avatarFor(other) : { avatarText: '?', avatarColor: '#6b7c85' };
}

export { COLORS, avatarText };
