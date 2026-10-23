/* ==========================================================================
   WhatsApp Web — Demo funcional
   Cliente SPA em JS puro: SSE, recibos, presença, mídia, áudio, grupos, busca.
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------- helpers ------------------------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const escapeHTML = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  const TIME_FMT = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const DATE_FMT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const WEEKDAY_FMT = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const timeHM = (ts) => TIME_FMT.format(new Date(ts));

  function chatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    if (sameDay(d, now)) return timeHM(ts);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return 'Ontem';
    if (now - d < 6 * 24 * 60 * 60 * 1000) {
      const w = WEEKDAY_FMT.format(d);
      return w.charAt(0).toUpperCase() + w.slice(1, 3);
    }
    return DATE_FMT.format(d).slice(0, 5);
  }

  function dateLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (sameDay(d, now)) return 'Hoje';
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return 'Ontem';
    if (now - d < 7 * 24 * 60 * 60 * 1000) {
      const w = WEEKDAY_FMT.format(d);
      return w.charAt(0).toUpperCase() + w.slice(1);
    }
    return DATE_FMT.format(d);
  }

  function lastSeenText(ts) {
    if (!ts) return 'visto por último recentemente';
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'visto por último agora há pouco';
    if (diff < 60 * 60_000) {
      const min = Math.max(1, Math.round(diff / 60_000));
      return `visto por último há ${min} min`;
    }
    const d = new Date(ts);
    const now = new Date();
    if (sameDay(d, now)) return `visto por último hoje às ${timeHM(ts)}`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (sameDay(d, yesterday)) return `visto por último ontem às ${timeHM(ts)}`;
    return `visto por último em ${DATE_FMT.format(d)}`;
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function formatSize(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function formatPhone(value) {
    const d = String(value || '').replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 12 && d.startsWith('55')) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    return value ? `+${d}` : '';
  }

  const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

  const foldText = (value) =>
    String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

  const AUTHOR_COLORS = ['#53bdeb', '#ffa97a', '#7bc862', '#f5a623', '#c8a8ff', '#ff8fa3', '#4fd1c5', '#e5c07b'];
  const colorFor = (id) => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return AUTHOR_COLORS[h % AUTHOR_COLORS.length];
  };

  const toHHMMSS = (s) => {
    const d = Math.max(0, Math.floor(s));
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const sec = d % 60;
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  };

  /* ------------------------------- estado ------------------------------- */

  /* Armazenamento tolerante a iframes/previews que bloqueiam localStorage.
     Sem isso, um SecurityError no topo do script travaria a tela em "Conectando...". */
  const store = (() => {
    const memory = new Map();
    let backing = null;
    try {
      const probe = '__wam_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      backing = window.localStorage;
    } catch {
      backing = null;
    }
    return {
      get available() {
        return Boolean(backing);
      },
      getItem(key) {
        try {
          if (backing) return backing.getItem(key);
        } catch {
          /* storage bloqueado no meio da sessão */
        }
        return memory.has(key) ? memory.get(key) : null;
      },
      setItem(key, value) {
        const str = String(value);
        memory.set(key, str);
        try {
          if (backing) backing.setItem(key, str);
        } catch {
          /* mantém só em memória */
        }
      },
      removeItem(key) {
        memory.delete(key);
        try {
          if (backing) backing.removeItem(key);
        } catch {
          /* ignore */
        }
      },
    };
  })();

  const TOKEN_KEY = 'wam_token';
  const savedToken = store.getItem(TOKEN_KEY) || '';

  const PREFS = {
    theme: store.getItem('wam_theme') || 'dark',
    sound: store.getItem('wam_sound') !== '0',
    notifications: store.getItem('wam_notifications') === '1',
  };

  const state = {
    token: savedToken,
    me: null,
    settings: { autoReplies: true },
    convs: [],
    activeId: null,
    messages: new Map(),
    hasMore: new Map(),
    details: new Map(),
    filter: 'all',
    searchQuery: '',
    searchResults: null,
    searchToken: 0,
    online: new Set(),
    typing: new Map(),
    typingTimers: new Map(),
    replyTo: null,
    connected: false,
    unseenWhileAway: 0,
    events: null,
    readyOnce: false,
    loadingOlder: false,
    record: null,
    call: null,
    activeAudio: null,
    lastTypingSent: 0,
    chatSearch: '',
    notification: null,
  };

  const getConv = (id) => state.convs.find((c) => c.id === id);
  const activeConv = () => getConv(state.activeId);

  /* ------------------------------- api ------------------------------- */

  async function api(path, options = {}) {
    const opts = { credentials: 'same-origin', ...options };
    opts.headers = { ...(opts.headers || {}) };
    if (state.token) opts.headers.Authorization = `Bearer ${state.token}`;
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      if (typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || `Erro ${res.status}` };
    }
    if (!res.ok) {
      if (res.status === 401 && state.me) handleLoggedOut();
      throw new Error(data.error || `Erro ${res.status}`);
    }
    return data;
  }

  function handleLoggedOut() {
    if (!state.me) return;
    state.me = null;
    state.token = '';
    store.removeItem(TOKEN_KEY);
    if (state.events) state.events.close();
    state.events = null;
    showLogin();
    toast('Sua sessão expirou. Entre novamente.', true);
  }

  /* ------------------------------- toast / som ------------------------------- */

  let toastTimer = null;
  function toast(message, isError = false, ms = 3200) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, ms);
  }

  let audioCtx = null;
  function primeAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch {
      /* ignore */
    }
  }

  function playSound(kind) {
    if (!PREFS.sound) return;
    try {
      primeAudio();
      if (!audioCtx) return;
      const t0 = audioCtx.currentTime;
      const notes = kind === 'receive' ? [[880, 0], [1244, 0.1]] : [[659, 0]];
      for (const [freq, delay] of notes) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + delay);
        gain.gain.exponentialRampToValueAtTime(0.055, t0 + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 0.18);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + delay);
        osc.stop(t0 + delay + 0.2);
      }
    } catch {
      /* ignore */
    }
  }

  /* ------------------------------- tema / avatar ------------------------------- */

  function applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    PREFS.theme = t;
    store.setItem('wam_theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#111b21' : '#f0f2f5');
  }

  function avatarHTML(data, opts = {}) {
    const { size = '', online = false, group = false, id = '' } = opts;
    return `<span class="avatar ${size} ${online ? 'online' : ''}" ${id ? `id="${id}"` : ''} style="--avatar-bg:${escapeHTML(data.avatarColor || '#6b7c85')}">${escapeHTML(data.avatarText || '?')}${
      online ? '<i class="dot"></i>' : ''
    }${group ? `<span class="group-mark">${icon('users')}</span>` : ''}</span>`;
  }

  function paintAvatar(el, data, opts = {}) {
    if (!el) return;
    const keep = ['avatar', 'sm', 'xs', 'lg', 'xl'].filter((c) => el.classList.contains(c)).join(' ');
    el.className = keep || 'avatar';
    el.style.setProperty('--avatar-bg', data?.avatarColor || '#6b7c85');
    el.innerHTML = `${escapeHTML(data?.avatarText || '?')}${opts.online ? '<i class="dot"></i>' : ''}${
      opts.group ? `<span class="group-mark">${icon('users')}</span>` : ''
    }`;
    el.classList.toggle('online', Boolean(opts.online));
  }

  function myAvatar() {
    return { avatarText: state.me?.avatarText || '?', avatarColor: state.me?.avatarColor || '#6b7c85' };
  }

  function renderMe() {
    if (!state.me) return;
    paintAvatar($('#railAvatar'), myAvatar());
    $('#footMe').textContent = state.me.name;
    const input = $('#messageInput');
    if (input) input.placeholder = 'Digite uma mensagem';
  }

  /* ------------------------------- boot / login ------------------------------- */

  function showLogin() {
    $('#appView').hidden = true;
    $('#chatView').hidden = true;
    $('#emptyState').hidden = false;
    $('#loginView').hidden = false;
    document.querySelectorAll('.drawer, .modal-backdrop').forEach((el) => el.remove());
    $('#drawerBackdrop').hidden = true;
    $('#loginError').textContent = '';
    setTimeout(() => $('#loginPhone')?.focus(), 120);
  }

  async function boot() {
    applyTheme(PREFS.theme);
    bindStaticEvents();
    const savedPhone = store.getItem('wam_phone');
    if (savedPhone) $('#loginPhone').value = savedPhone;
    try {
      const data = await api('/api/me');
      state.me = data.user;
      state.settings = data.settings;
      await enterApp();
    } catch {
      showLogin();
    } finally {
      const bootEl = $('#boot');
      if (bootEl) {
        bootEl.classList.add('hide');
        setTimeout(() => bootEl.remove(), 420);
      }
    }
  }

  async function enterApp() {
    $('#loginView').hidden = true;
    $('#appView').hidden = false;
    $('#appView').classList.remove('chat-open');
    renderMe();
    await loadConversations();
    connectEvents();
    updateBadges();
    const last = store.getItem('wam_last_conv');
    const wantOpen = window.innerWidth > 900 && last && getConv(last);
    if (wantOpen) {
      await openConversation(last);
    } else {
      $('#chatView').hidden = true;
      $('#emptyState').hidden = false;
      renderChatList();
    }
    renderChatHeader();
  }

  async function doDemoLogin(button) {
    button.disabled = true;
    $('#loginError').textContent = '';
    try {
      const data = await api('/api/demo', { method: 'POST' });
      state.me = data.user;
      state.token = data.token || state.token;
      if (state.token) store.setItem(TOKEN_KEY, state.token);
      state.settings = data.settings;
      await enterApp();
    } catch (err) {
      $('#loginError').textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  async function doLogin(form) {
    const btn = $('#loginSubmit');
    const errorEl = $('#loginError');
    errorEl.textContent = '';
    const phone = $('#loginPhone').value.trim();
    const name = $('#loginName').value.trim();
    if (!phone) {
      errorEl.textContent = 'Informe seu número de telefone.';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Entrando…';
    try {
      const data = await api('/api/login', { method: 'POST', body: { phone, name } });
      store.setItem('wam_phone', phone);
      state.me = data.user;
      state.token = data.token || state.token;
      if (state.token) store.setItem(TOKEN_KEY, state.token);
      state.settings = data.settings;
      await enterApp();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar / criar conta';
    }
  }

  /* ------------------------------- conversas / lista ------------------------------- */

  function sortConvs() {
    state.convs.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return (b.lastActivity || 0) - (a.lastActivity || 0);
    });
  }

  async function loadConversations() {
    try {
      const data = await api('/api/conversations');
      state.convs = data.conversations || [];
      sortConvs();
      renderChatList();
      updateBadges();
    } catch (err) {
      if (state.me) toast(err.message, true);
    }
  }

  function upsertConv(conv, opts = {}) {
    if (!conv) return;
    const idx = state.convs.findIndex((c) => c.id === conv.id);
    const previous = idx >= 0 ? state.convs[idx] : null;
    if (previous && previous.lastActivity === conv.lastActivity && previous.unread === conv.unread && previous.pinned === conv.pinned && previous.archived === conv.archived && previous.muted === conv.muted) {
      // mantém a referência estável mas atualiza estado online/typing
      Object.assign(previous, conv);
    } else if (idx >= 0) state.convs[idx] = conv;
    else state.convs.push(conv);
    sortConvs();
    if (!opts.silent) {
      renderChatList();
      updateBadges();
    }
    if (conv.id === state.activeId) renderChatHeader();
  }

  function typingFor(conv) {
    const map = state.typing.get(conv.id);
    if (!map) return [];
    const now = Date.now();
    return Array.from(map.entries())
      .filter(([, v]) => v.until > now)
      .map(([id, v]) => ({ id, name: v.name }));
  }

  function previewText(conv) {
    const last = conv.lastMessage;
    if (!last) return 'Nenhuma mensagem ainda';
    return last.preview || '';
  }

  function chatItemHTML(conv) {
    const typing = typingFor(conv);
    const last = conv.lastMessage;
    let preview = '';
    if (typing.length) {
      preview = `<span class="chat-preview typing">${typing.length > 1 ? 'vários digitando…' : 'digitando…'}</span>`;
    } else {
      let ticks = '';
      if (last?.outgoing && last.type !== 'system') {
        ticks = `<span class="ticks ${last.status === 'read' ? 'read' : ''}">${tickMarkup(last.status)}</span>`;
      }
      const senderPrefix = conv.isGroup && last && !last.outgoing && last.type !== 'system' ? `<em>${escapeHTML(firstName(last.senderName))}:</em> ` : '';
      preview = `<span class="chat-preview">${ticks}${senderPrefix}<span class="preview-text">${escapeHTML(previewText(conv))}</span></span>`;
    }
    const flags = [];
    if (conv.pinned) flags.push(`<span class="pin-flag" title="Fixada">${icon('pin')}</span>`);
    if (conv.muted) flags.push(`<span title="Silenciada">${icon('bell-off')}</span>`);
    if (conv.unread > 0) flags.push(`<span class="unread-badge">${conv.unread > 99 ? '99+' : conv.unread}</span>`);

    return `<button class="chat-item ${conv.id === state.activeId ? 'active' : ''} ${conv.pinned ? 'pinned' : ''} ${conv.unread > 0 ? 'has-unread' : ''}"
        data-conv-id="${conv.id}" role="listitem" aria-label="Conversa com ${escapeHTML(conv.title)}">
        ${avatarHTML(conv, { online: !conv.isGroup && (conv.online || state.online.has(conv.contact?.id)), group: conv.isGroup })}
        <span class="chat-info">
          <span class="chat-row">
            <span class="chat-name">${escapeHTML(conv.title)}</span>
            <time class="chat-time">${chatTime(last?.createdAt || conv.createdAt)}</time>
          </span>
          <span class="chat-row chat-preview-row">
            ${preview}
            <span class="chat-flags">${flags.join('')}</span>
          </span>
        </span>
      </button>`;
  }

  function filterMatch(conv, filter) {
    switch (filter) {
      case 'unread':
        return conv.unread > 0 && !conv.archived;
      case 'pinned':
        return conv.pinned && !conv.archived;
      case 'archived':
        return conv.archived;
      default:
        return !conv.archived;
    }
  }

  function renderChatList() {
    const list = $('#chatList');
    if (!list) return;
    const query = foldText(state.searchQuery.trim());
    let convs = state.convs.filter((c) => filterMatch(c, state.filter));
    if (query && !state.searchResults) {
      convs = convs.filter((c) => foldText(c.title).includes(query) || foldText(previewText(c)).includes(query));
    }
    list.innerHTML = convs.map(chatItemHTML).join('');
    const empty = $('#chatListEmpty');
    if (empty) {
      empty.hidden = convs.length > 0;
      const p = empty.querySelector('p');
      if (p) {
        p.textContent =
          state.filter === 'archived'
            ? 'Nenhuma conversa arquivada.'
            : state.filter === 'unread'
              ? 'Tudo em dia! Nenhuma mensagem não lida.'
              : state.filter === 'pinned'
                ? 'Nenhuma conversa fixada.'
                : query
                  ? 'Nenhuma conversa encontrada.'
                  : 'Nenhuma conversa por aqui.';
      }
    }
    updateChipCounts();
  }

  function updateChipCounts() {
    const counts = {
      all: state.convs.filter((c) => !c.archived).length,
      unread: state.convs.filter((c) => c.unread > 0 && !c.archived).length,
      pinned: state.convs.filter((c) => c.pinned && !c.archived).length,
      archived: state.convs.filter((c) => c.archived).length,
    };
    $$('#filterChips .chip').forEach((chip) => {
      const key = chip.dataset.filter;
      let countEl = chip.querySelector('.count');
      if (key === 'all' || counts[key] === 0) {
        countEl?.remove();
        return;
      }
      if (!countEl) {
        countEl = document.createElement('span');
        countEl.className = 'count';
        chip.appendChild(countEl);
      }
      countEl.textContent = counts[key];
    });
  }

  function updateBadges() {
    const total = state.convs.reduce((sum, c) => sum + (c.archived ? 0 : c.unread || 0), 0);
    const badge = $('#railBadge');
    if (badge) {
      badge.hidden = total === 0;
      badge.textContent = total > 99 ? '99+' : String(total);
    }
    document.title = total > 0 ? `(${total}) WhatsApp Web — Demo` : 'WhatsApp Web — Demo';
  }

  function setFilter(filter) {
    state.filter = filter;
    $$('#filterChips .chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === filter));
    $$('.rail-btn[data-rail]').forEach((btn) => {
      const map = { chats: 'all', pinned: 'pinned', archived: 'archived' };
      btn.classList.toggle('active', map[btn.dataset.rail] === filter);
    });
    renderChatList();
  }

  /* ------------------------------- cabeçalho do chat ------------------------------- */

  function renderChatHeader() {
    const conv = activeConv();
    const bar = $('#chatView');
    if (!conv || !bar || bar.hidden) return;
    $('#chatTitle').textContent = conv.title;
    paintAvatar($('#chatAvatar'), conv, { online: !conv.isGroup && conv.online, group: conv.isGroup });

    const typing = typingFor(conv);
    const sub = $('#chatSubtitle');
    sub.className = '';
    if (typing.length) {
      sub.textContent = conv.isGroup
        ? typing.length > 1
          ? 'vários participantes digitando…'
          : `${firstName(typing[0].name)} está digitando…`
        : 'digitando…';
      sub.classList.add('typing');
    } else if (conv.isGroup) {
      const details = state.details.get(conv.id);
      if (details?.members?.length) {
        sub.textContent = details.members.map((m) => (m.isMe ? 'Você' : firstName(m.name))).join(', ');
      } else {
        sub.textContent = `${conv.memberCount} participantes`;
      }
    } else if (conv.online || state.online.has(conv.contact?.id)) {
      sub.textContent = 'online';
      sub.classList.add('online');
    } else {
      sub.textContent = lastSeenText(conv.lastSeen);
    }
  }

  /* ------------------------------- abrir conversa ------------------------------- */

  async function openConversation(id, opts = {}) {
    const conv = getConv(id);
    if (!conv) return;
    if (state.record) stopRecording(false);
    if (state.activeAudio) resetActiveAudioUI();
    closeCtxMenu();
    closeReactionBar();
    closeDrawers(false);
    $('#emojiPicker').hidden = true;
    $('#attachMenu').hidden = true;
    $('#chatSearchBar').hidden = true;
    $('#chatSearchInput').value = '';
    $('#chatSearchCount').textContent = '';
    state.chatSearch = '';
    state.activeId = id;
    store.setItem('wam_last_conv', id);
    state.replyTo = null;
    state.unseenWhileAway = 0;
    renderReply();
    $('#emptyState').hidden = true;
    $('#chatView').hidden = false;
    $('#appView').classList.add('chat-open');
    renderChatList();
    renderChatHeader();
    updateScrollButton();

    if (!state.messages.has(id) || opts.force) {
      $('#messages').innerHTML = '<div class="messages-loading">Carregando mensagens…</div>';
      try {
        const [msgs, details] = await Promise.all([
          api(`/api/conversations/${id}/messages?limit=50`),
          api(`/api/conversations/${id}`),
        ]);
        if (state.activeId !== id) return;
        state.messages.set(id, msgs.messages);
        state.hasMore.set(id, msgs.hasMore);
        state.details.set(id, details);
        upsertConv(details.conversation, { silent: true });
        renderChatList();
        renderMessages({ scroll: 'bottom' });
        markRead(id);
      } catch (err) {
        toast(err.message, true);
      }
    } else {
      renderMessages({ scroll: 'bottom' });
      markRead(id);
    }
    if (window.innerWidth > 900) setTimeout(() => $('#messageInput')?.focus({ preventScroll: true }), 60);
  }

  function dropConversation(id) {
    state.convs = state.convs.filter((c) => c.id !== id);
    state.messages.delete(id);
    state.details.delete(id);
    state.hasMore.delete(id);
    if (state.activeId === id) closeChat();
    renderChatList();
    updateBadges();
  }

  function closeChat() {
    if (state.record) stopRecording(false);
    if (state.activeAudio) resetActiveAudioUI();
    state.activeId = null;
    store.removeItem('wam_last_conv');
    $('#chatView').hidden = true;
    $('#emptyState').hidden = false;
    $('#appView').classList.remove('chat-open');
    renderChatList();
    $('#chatSearchBar').hidden = true;
  }

  /* ------------------------------- mensagens ------------------------------- */

  function isNearBottom() {
    const box = $('#messages');
    if (!box) return true;
    return box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  }

  function scrollToBottom(smooth = false) {
    const box = $('#messages');
    if (!box) return;
    try {
      box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    } catch {
      box.scrollTop = box.scrollHeight;
    }
    state.unseenWhileAway = 0;
    updateScrollButton();
  }

  function updateScrollButton() {
    const btn = $('#scrollBottom');
    if (!btn) return;
    btn.hidden = isNearBottom() || !state.activeId;
    const badge = $('#newMsgBadge');
    if (badge) {
      badge.hidden = state.unseenWhileAway === 0;
      badge.textContent = state.unseenWhileAway > 9 ? '9+' : String(state.unseenWhileAway);
    }
  }

  function tickMarkup(status) {
    if (status === 'read') return icon('checks');
    if (status === 'delivered') return icon('checks');
    if (status === 'sent') return icon('check');
    return '';
  }

  function richText(text) {
    const escaped = escapeHTML(text);
    return escaped
      .replace(/(https?:\/\/[^\s<]+)/g, (m) => {
        const href = m.replace(/"/g, '%22');
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${m}</a>`;
      })
      .replace(/(^|[\s(])(www\.[^\s<]+)/g, (all, pre, m) => `${pre}<a href="https://${m.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  }

  function isEmojiOnly(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.length > 14) return false;
    try {
      return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\uFE0F|\u200D|\s)+$/u.test(trimmed);
    } catch {
      return false;
    }
  }

  function waveBars(seed, count = 32) {
    let h = 2166136261;
    for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const out = [];
    for (let i = 0; i < count; i++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      out.push(4 + (h % 17));
    }
    return out;
  }

  function docIcon(name = '', mime = '') {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf' || mime.includes('pdf')) return { label: 'PDF', cls: '' };
    if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: ext.toUpperCase().slice(0, 3), cls: 'xls' };
    if (['zip', 'rar', '7z'].includes(ext)) return { label: 'ZIP', cls: 'zip' };
    if (['txt', 'md'].includes(ext)) return { label: 'TXT', cls: 'txt' };
    return { label: ext ? ext.slice(0, 3).toUpperCase() : 'DOC', cls: 'doc' };
  }

  function quotedHTML(quoted) {
    if (!quoted) return '';
    return `<div class="quoted" data-msg-action="jump" data-target="${quoted.id}">
      <strong>${escapeHTML(firstName(quoted.senderName))}</strong>
      <span>${escapeHTML(quoted.body || 'Mensagem')}</span>
    </div>`;
  }

  function messageContent(msg) {
    if (msg.deleted) {
      return `<div class="msg-text muted"><em>🚫 Esta mensagem foi apagada</em></div>`;
    }
    switch (msg.type) {
      case 'image': {
        const media = msg.media;
        const caption = msg.body ? `<div class="msg-text ${isEmojiOnly(msg.body) ? 'msg-emoji-only' : ''}">${richText(msg.body)}</div>` : '';
        return `<div class="msg-media" data-msg-action="lightbox" data-src="${escapeHTML(media?.url || '')}" data-kind="image" role="button" tabindex="0" aria-label="Abrir foto">
            <img src="${escapeHTML(media?.url || '')}" alt="${escapeHTML(media?.name || 'Foto')}" loading="lazy" />
            <span class="media-badge">${icon('image')} Foto</span>
          </div>${caption}`;
      }
      case 'video': {
        const caption = msg.body ? `<div class="msg-text">${richText(msg.body)}</div>` : '';
        return `<div class="msg-media"><video src="${escapeHTML(msg.media?.url || '')}" controls preload="metadata" playsinline></video></div>${caption}`;
      }
      case 'audio': {
        const bars = waveBars(msg.id)
          .map((h) => `<i style="height:${h}px"></i>`)
          .join('');
        return `<div class="audio-msg" data-audio-wrap data-duration="${msg.duration || 0}">
            <audio src="${escapeHTML(msg.media?.url || '')}" preload="metadata"></audio>
            <button class="audio-play" data-audio-action="play" aria-label="Reproduzir áudio">${icon('play')}</button>
            <div class="audio-body">
              <div class="wave" data-audio-action="seek">${bars}</div>
              <div class="audio-foot">
                <span class="audio-time">${formatDuration(msg.duration || 0)}</span>
                <button class="audio-speed" data-audio-action="speed" title="Velocidade">1x</button>
              </div>
            </div>
          </div>
          <div class="msg-meta">${msg.isMine ? `<span>${timeHM(msg.createdAt)}</span><span class="ticks ${msg.status === 'read' ? 'read' : ''}">${tickMarkup(msg.status)}</span>` : `<span>${timeHM(msg.createdAt)}</span>`}</div>`;
      }
      case 'document': {
        const d = docIcon(msg.media?.name, msg.media?.mime);
        return `<a class="doc-msg" href="${escapeHTML(msg.media?.url || '#')}" download="${escapeHTML(msg.media?.name || 'arquivo')}" target="_blank" rel="noopener">
            <span class="doc-ico ${d.cls}">${escapeHTML(d.label)}</span>
            <span class="doc-info"><strong>${escapeHTML(msg.media?.name || 'Documento')}</strong><small>${formatSize(msg.media?.size)}</small></span>
            ${icon('download')}
          </a>${msg.body ? `<div class="msg-text">${richText(msg.body)}</div>` : ''}`;
      }
      case 'call': {
        const call = msg.call || {};
        const kindLabel = call.kind === 'video' ? 'Chamada de vídeo' : 'Chamada de voz';
        const detail = call.status === 'missed' ? 'Perdida' : call.status === 'answered' ? `Atendida · ${formatDuration(call.duration)}` : 'Sem resposta';
        return `<div class="call-msg"><span class="call-ico">${icon(call.kind === 'video' ? 'video' : 'phone')}</span><span class="call-txt"><strong>${kindLabel}</strong><small>${detail}${msg.isMine ? ' · saída' : ''}</small></span></div>`;
      }
      default: {
        const text = msg.body || '';
        return `<div class="msg-text ${isEmojiOnly(text) ? 'msg-emoji-only' : ''}">${richText(text)}</div>`;
      }
    }
  }

  function reactionsHTML(msg) {
    const reactions = msg.reactions || {};
    const counts = new Map();
    for (const emoji of Object.values(reactions)) {
      if (!emoji) continue;
      counts.set(emoji, (counts.get(emoji) || 0) + 1);
    }
    if (!counts.size) return '';
    const items = Array.from(counts.entries())
      .map(([emoji, count]) => `<span>${escapeHTML(emoji)}${count > 1 ? `<small>${count}</small>` : ''}</span>`)
      .join('');
    return `<div class="reactions" data-msg-action="react">${items}</div>`;
  }

  function messageHTML(msg, conv, opts = {}) {
    if (msg.type === 'system') {
      return `<div class="system-msg" data-id="${msg.id}" data-sender="system"><span>${escapeHTML(msg.body)}</span></div>`;
    }
    const out = msg.isMine;
    const showAuthor = Boolean(opts.showAuthor) && conv?.isGroup && !out;
    const author = showAuthor
      ? `<div class="msg-author" style="color:${colorFor(msg.senderId)}">${escapeHTML(msg.senderName)}</div>`
      : '';
    const quoted = quotedHTML(msg.quoted);
    const content = messageContent(msg);
    const hasOwnMeta = !msg.deleted && msg.type === 'audio';
    const meta = hasOwnMeta
      ? ''
      : `<div class="msg-meta"><span>${timeHM(msg.createdAt)}</span>${
          out ? `<span class="ticks ${msg.status === 'read' ? 'read' : ''}">${tickMarkup(msg.status)}</span>` : ''
        }</div>`;
    const actions = `<div class="msg-actions">
        <button data-msg-action="react" data-id="${msg.id}" title="Reagir" aria-label="Reagir">${icon('smile')}</button>
        <button data-msg-action="reply" data-id="${msg.id}" title="Responder" aria-label="Responder">${icon('reply')}</button>
        <button data-msg-action="menu" data-id="${msg.id}" title="Mais opções" aria-label="Mais opções">${icon('more')}</button>
      </div>`;
    return `<div class="msg-row ${out ? 'out' : 'in'}" data-id="${msg.id}" data-sender="${msg.senderId}">
        <div class="bubble">
          ${actions}
          ${author}
          ${quoted}
          ${content}
          ${meta}
        </div>
        ${reactionsHTML(msg)}
      </div>`;
  }

  function messageListHTML(list, conv) {
    if (!list.length) {
      return `<div class="messages-loading">Nenhuma mensagem ainda. Diga oi! 👋</div>`;
    }
    let html = '';
    if (state.hasMore.get(conv.id)) {
      html += `<button class="load-more" data-action="load-older">Carregar mensagens anteriores</button>`;
    }
    let lastDay = '';
    let lastSender = '';
    let lastTs = 0;
    let unreadBoundary = false;
    for (const msg of list) {
      const day = new Date(msg.createdAt).toDateString();
      if (day !== lastDay) {
        html += `<div class="date-divider"><span>${escapeHTML(dateLabel(msg.createdAt))}</span></div>`;
        lastDay = day;
        lastSender = '';
      }
      if (!unreadBoundary && !msg.isMine && !msg.seen) {
        html += `<div class="unread-divider"><span>Mensagens não lidas</span></div>`;
        unreadBoundary = true;
      }
      const showAuthor = conv.isGroup && !msg.isMine && msg.type !== 'system' && (msg.senderId !== lastSender || msg.createdAt - lastTs > 5 * 60_000);
      html += messageHTML(msg, conv, { showAuthor });
      lastSender = msg.senderId;
      lastTs = msg.createdAt;
    }
    return html;
  }

  function renderMessages(options = {}) {
    const conv = activeConv();
    const box = $('#messages');
    if (!conv || !box) return;
    const list = state.messages.get(conv.id) || [];
    const beforeHeight = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const atBottom = isNearBottom();
    box.innerHTML = messageListHTML(list, conv);
    const stickBottom = options.scroll === 'bottom' || (options.scroll !== 'keep' && options.scroll !== 'prepend' && atBottom);
    if (stickBottom) {
      scrollToBottom(false);
      box.querySelectorAll('img, video').forEach((el) => {
        const settle = () => {
          if (isNearBottom()) scrollToBottom(false);
        };
        el.addEventListener('load', settle, { once: true });
        el.addEventListener('loadedmetadata', settle, { once: true });
      });
    } else if (options.scroll === 'prepend') {
      box.scrollTop = box.scrollHeight - beforeHeight + beforeTop;
    } else {
      box.scrollTop = beforeTop;
    }
    updateScrollButton();
  }

  function findMsg(id) {
    const list = state.messages.get(state.activeId);
    return list ? list.find((m) => m.id === id) : null;
  }

  function patchMessageNode(msg) {
    const node = document.querySelector(`.msg-row[data-id="${msg.id}"]`);
    if (!node) return;
    const conv = activeConv();
    const hadAuthor = Boolean(node.querySelector('.msg-author'));
    node.outerHTML = messageHTML(msg, conv, { showAuthor: conv?.isGroup && !msg.isMine && hadAuthor });
  }

  function addMessageToActive(msg) {
    const conv = activeConv();
    if (!conv || msg.conversationId !== conv.id) return;
    const list = state.messages.get(conv.id);
    if (!list) return;
    const existingIndex = list.findIndex((m) => m.id === msg.id);
    if (existingIndex >= 0) {
      list[existingIndex] = msg;
      patchMessageNode(msg);
      return;
    }
    const wasAtBottom = isNearBottom();
    const last = list[list.length - 1];
    list.push(msg);
    const box = $('#messages');
    if (!box) return;
    const loading = box.querySelector('.messages-loading');
    if (loading) loading.remove();
    let html = '';
    if (!last || new Date(last.createdAt).toDateString() !== new Date(msg.createdAt).toDateString()) {
      html += `<div class="date-divider"><span>${escapeHTML(dateLabel(msg.createdAt))}</span></div>`;
    }
    const showAuthor = conv.isGroup && !msg.isMine && msg.type !== 'system' && (!last || last.senderId !== msg.senderId || msg.createdAt - last.createdAt > 5 * 60_000);
    html += messageHTML(msg, conv, { showAuthor });
    box.insertAdjacentHTML('beforeend', html);
    if (wasAtBottom || msg.isMine) scrollToBottom(true);
    else {
      state.unseenWhileAway += 1;
      updateScrollButton();
    }
    // remove divisor de não lidas antigo se a conversa foi lida
    if (!document.hidden && msg.isMine === false) {
      const divider = box.querySelector('.unread-divider');
      if (divider && state.convs.find((c) => c.id === conv.id)?.unread === 0) divider.remove();
    }
  }

  async function loadOlder(convId = state.activeId) {
    if (!convId || state.loadingOlder || !state.hasMore.get(convId)) return;
    const list = state.messages.get(convId);
    if (!list?.length) return;
    state.loadingOlder = true;
    const box = $('#messages');
    try {
      const data = await api(`/api/conversations/${convId}/messages?before=${list[0].createdAt}&limit=40`);
      if (!state.messages.has(convId)) return;
      state.messages.set(convId, [...data.messages, ...state.messages.get(convId)]);
      state.hasMore.set(convId, data.hasMore);
      if (state.activeId === convId) {
        renderMessages({ scroll: 'prepend' });
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      state.loadingOlder = false;
    }
  }

  /* ------------------------------- recibos / leitura ------------------------------- */

  const readTimers = new Map();

  function markReadSoon(convId, delay = 220) {
    clearTimeout(readTimers.get(convId));
    readTimers.set(
      convId,
      setTimeout(() => markRead(convId), delay)
    );
  }

  async function markRead(convId) {
    const conv = getConv(convId);
    if (!conv) return;
    const list = state.messages.get(convId) || [];
    const unseen = list.some((m) => !m.isMine && !m.seen);
    if (conv.unread === 0 && !unseen) return;
    conv.unread = 0;
    for (const m of list) if (!m.isMine) m.seen = true;
    renderChatList();
    updateBadges();
    try {
      const { conversation } = await api(`/api/conversations/${convId}/read`, { method: 'POST' });
      upsertConv(conversation);
    } catch {
      /* silencioso */
    }
  }

  /* ------------------------------- eventos SSE ------------------------------- */

  function connectEvents() {
    if (state.events) state.events.close();
    const url = state.token ? `/api/events?token=${encodeURIComponent(state.token)}` : '/api/events';
    const es = new EventSource(url);
    state.events = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      handleEvent(data);
    };
  }

  function setConnected(online) {
    state.connected = online;
    const dot = $('#connDot');
    const label = $('#connLabel');
    if (dot) dot.classList.toggle('off', !online);
    if (label) label.textContent = online ? 'Conectado' : 'Reconectando…';
  }

  function handleEvent(data) {
    switch (data.type) {
      case 'ready': {
        setConnected(true);
        state.online = new Set(data.online || []);
        if (state.readyOnce) {
          loadConversations();
          if (state.activeId) openConversation(state.activeId, { force: true });
        }
        state.readyOnce = true;
        renderChatHeader();
        renderChatList();
        break;
      }
      case 'message':
        receiveMessage(data.message, data.conversation);
        break;
      case 'message:update': {
        const msg = data.message;
        const list = state.messages.get(msg.conversationId);
        if (list) {
          const idx = list.findIndex((m) => m.id === msg.id);
          if (idx >= 0) {
            list[idx] = msg;
            if (msg.conversationId === state.activeId) patchMessageNode(msg);
          }
        }
        if (data.conversation) upsertConv(data.conversation);
        break;
      }
      case 'message:remove': {
        const list = state.messages.get(data.conversationId);
        if (list) {
          const idx = list.findIndex((m) => m.id === data.messageId);
          if (idx >= 0) list.splice(idx, 1);
        }
        document.querySelector(`.msg-row[data-id="${data.messageId}"]`)?.remove();
        break;
      }
      case 'conv:update':
      case 'conv:new':
        if (data.conversation) {
          const cached = state.details.get(data.conversation.id);
          if (cached && cached.members?.length !== data.conversation.memberCount) {
            state.details.delete(data.conversation.id);
          }
          upsertConv(data.conversation);
        }
        break;
      case 'conv:leave': {
        const conv = getConv(data.conversationId);
        dropConversation(data.conversationId);
        const title = data.title || conv?.title || 'grupo';
        toast(data.self ? `Você saiu de "${title}".` : `Você foi removido(a) de "${title}".`);
        break;
      }
      case 'typing':
        setTyping(data.conversationId, data.userId, data.name, data.until);
        break;
      case 'presence': {
        state.online = new Set((data.users || []).filter((u) => u.online).map((u) => u.id));
        for (const u of data.users || []) {
          if (!u.online && u.lastSeen) {
            for (const c of state.convs) {
              if (c.contact?.id === u.id) c.lastSeen = u.lastSeen;
            }
          }
        }
        renderChatList();
        renderChatHeader();
        break;
      }
      case 'user:update':
        if (data.user?.id === state.me?.id) {
          state.me = data.user;
          renderMe();
        }
        break;
      default:
        break;
    }
  }

  function receiveMessage(msg, convSummary) {
    if (!msg) return;
    const isActive = msg.conversationId === state.activeId;
    const conv = getConv(msg.conversationId) || convSummary;
    if (convSummary) {
      if (isActive && !document.hidden && convSummary.unread > 0) convSummary.unread = 0;
      upsertConv(convSummary);
    }
    if (isActive) {
      addMessageToActive(msg);
      renderChatHeader();
    }
    renderChatList();
    updateBadges();
    if (!msg.isMine) {
      const muted = conv?.muted;
      if (!muted) playSound('receive');
      if (document.hidden || !isActive) {
        notifyMessage(convSummary || conv, msg);
      }
      if (isActive && !document.hidden) markReadSoon(msg.conversationId, 400);
    }
  }

  function setTyping(convId, userId, name, until) {
    if (!state.typing.has(convId)) state.typing.set(convId, new Map());
    const map = state.typing.get(convId);
    if (until <= Date.now()) map.delete(userId);
    else map.set(userId, { name, until });
    const key = `${convId}:${userId}`;
    clearTimeout(state.typingTimers.get(key));
    if (until > Date.now()) {
      state.typingTimers.set(
        key,
        setTimeout(() => {
          map.delete(userId);
          renderChatHeader();
          renderChatList();
        }, Math.max(300, until - Date.now() + 150))
      );
    }
    renderChatHeader();
    renderChatList();
  }

  /* ------------------------------- notificações ------------------------------- */

  function notifyMessage(conv, msg) {
    if (!PREFS.notifications || !document.hidden) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (conv?.muted) return;
    const preview = previewText(conv || { lastMessage: { preview: msg.body } });
    try {
      const title = conv?.isGroup ? conv.title : msg.senderName || 'Nova mensagem';
      const body = conv?.isGroup ? `${firstName(msg.senderName)}: ${preview}` : preview;
      const n = new Notification(title, { body, icon: '/favicon.svg', tag: conv?.id || msg.conversationId, silent: true });
      n.onclick = () => {
        window.focus();
        if (conv?.id) openConversation(conv.id);
        n.close();
      };
      state.notification = n;
    } catch {
      /* ignore */
    }
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      toast('Este navegador não suporta notificações.', true);
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      toast('As notificações estão bloqueadas nas permissões do navegador.', true);
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast('Permissão de notificação não concedida.', true);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /* ------------------------------- busca ------------------------------- */

  function setSearch(value) {
    state.searchQuery = value;
    const clear = $('#searchClear');
    if (clear) clear.hidden = !value;
    clearTimeout(state.searchTimer);
    if (!value.trim()) {
      state.searchResults = null;
      $('#searchResults').hidden = true;
      renderChatList();
      return;
    }
    renderChatList();
    if (value.trim().length < 2) {
      state.searchResults = null;
      $('#searchResults').hidden = true;
      return;
    }
    state.searchTimer = setTimeout(() => runSearch(value.trim()), 220);
  }

  async function runSearch(q) {
    const token = ++state.searchToken;
    try {
      const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
      if (token !== state.searchToken) return;
      state.searchResults = data.results || [];
      renderSearchResults(q);
    } catch (err) {
      if (token === state.searchToken) toast(err.message, true);
    }
  }

  function highlight(text, q) {
    const escaped = escapeHTML(text || '');
    if (!q) return escaped;
    try {
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      return escaped.replace(re, '<mark>$1</mark>');
    } catch {
      return escaped;
    }
  }

  function renderSearchResults(q) {
    const box = $('#searchResults');
    if (!box) return;
    box.hidden = false;
    const results = state.searchResults || [];
    if (!results.length) {
      box.innerHTML = `<div class="search-empty">Nenhuma mensagem encontrada para <strong>“${escapeHTML(q)}”</strong>.</div>`;
      return;
    }
    box.innerHTML =
      `<div class="search-results-head">${results.length} resultado${results.length > 1 ? 's' : ''}</div>` +
      results
        .map((r) => {
          const m = r.message;
          const c = r.conversation;
          const text = m.body || m.media?.name || m.type;
          return `<button class="search-result" data-search-conv="${c.id}" data-search-msg="${m.id}">
            ${avatarHTML(c, { group: c.isGroup, size: 'sm' })}
            <span class="sr-body">
              <span class="sr-title"><span>${escapeHTML(c.title)}</span><time>${chatTime(m.createdAt)}</time></span>
              <span class="sr-text">${escapeHTML(firstName(m.senderName))}: ${highlight(text, q)}</span>
            </span>
          </button>`;
        })
        .join('');
  }

  async function jumpToMessage(convId, messageId) {
    await openConversation(convId);
    let list = state.messages.get(convId) || [];
    let guard = 0;
    while (!list.some((m) => m.id === messageId) && state.hasMore.get(convId) && guard < 8) {
      await loadOlder(convId);
      list = state.messages.get(convId) || [];
      guard++;
    }
    const node = document.querySelector(`.msg-row[data-id="${messageId}"], .system-msg[data-id="${messageId}"]`);
    if (node) {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      node.classList.add('highlight');
      setTimeout(() => node.classList.remove('highlight'), 1800);
    } else {
      toast('Mensagem não está mais disponível.');
    }
  }

  function applyChatSearch(q) {
    state.chatSearch = q;
    $$('#messages .msg-row').forEach((el) => el.classList.remove('highlight'));
    const countEl = $('#chatSearchCount');
    if (!q.trim()) {
      if (countEl) countEl.textContent = '';
      return;
    }
    const ql = foldText(q.trim());
    const list = state.messages.get(state.activeId) || [];
    const matches = list.filter(
      (m) => !m.deleted && (foldText(m.body).includes(ql) || foldText(m.quoted?.body).includes(ql))
    );
    if (countEl) countEl.textContent = matches.length ? `${matches.length} encontrada${matches.length > 1 ? 's' : ''}` : 'nenhuma';
    let first = null;
    for (const m of matches) {
      const node = document.querySelector(`.msg-row[data-id="${m.id}"]`);
      if (node) {
        node.classList.add('highlight');
        if (!first) first = node;
      }
    }
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ------------------------------- envio ------------------------------- */

  function autosize() {
    const input = $('#messageInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    toggleSendMic();
  }

  function toggleSendMic() {
    const input = $('#messageInput');
    const hasText = Boolean(input?.value.trim());
    const send = $('#sendBtn');
    const mic = $('#micBtn');
    if (send) send.hidden = !hasText || Boolean(state.record);
    if (mic) mic.hidden = hasText || Boolean(state.record);
  }

  function sendTyping() {
    if (!state.activeId) return;
    const now = Date.now();
    if (now - state.lastTypingSent < 2300) return;
    state.lastTypingSent = now;
    api(`/api/conversations/${state.activeId}/typing`, { method: 'POST' }).catch(() => {});
  }

  async function sendText() {
    const input = $('#messageInput');
    if (!input) return;
    const text = input.value.trim();
    if (!text || !state.activeId) return;
    const convId = state.activeId;
    const quotedId = state.replyTo?.id || null;
    input.value = '';
    autosize();
    setReply(null);
    try {
      const data = await api(`/api/conversations/${convId}/messages`, {
        method: 'POST',
        body: { type: 'text', body: text, quotedId },
      });
      receiveMessage(data.message, data.conversation);
      playSound('send');
    } catch (err) {
      input.value = text;
      autosize();
      toast(err.message, true);
    }
    input.focus();
  }

  async function sendMediaMessage(media, caption, duration, convId = state.activeId) {
    if (!convId) return;
    const type = media.kind === 'image' || media.kind === 'video' || media.kind === 'audio' ? media.kind : 'document';
    const data = await api(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      body: {
        type,
        body: caption || '',
        mediaId: media.id,
        duration: duration || undefined,
        quotedId: state.replyTo?.id || undefined,
      },
    });
    setReply(null);
    receiveMessage(data.message, data.conversation);
    if (type !== 'audio') playSound('send');
  }

  async function uploadFile(file, extra = {}) {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name || 'Arquivo');
    for (const [key, value] of Object.entries(extra)) form.append(key, String(value));
    const data = await api('/api/upload', { method: 'POST', body: form });
    return data.media;
  }

  function pickFiles(accept = '', capture = '') {
    return new Promise((resolve) => {
      const input = $('#fileInput');
      input.value = '';
      input.accept = accept;
      input.multiple = true;
      if (capture) input.setAttribute('capture', capture);
      else input.removeAttribute('capture');
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  }

  async function handleSelectedFiles(files, convId = state.activeId) {
    if (!files.length || !convId) return;
    const tooBig = files.find((f) => f.size > 25 * 1024 * 1024);
    if (tooBig) {
      toast(`"${tooBig.name}" passa do limite de 25 MB.`, true);
      return;
    }
    const mediaFiles = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (mediaFiles.length) {
      openMediaPreview(mediaFiles, convId);
      return;
    }
    for (const file of files) {
      try {
        toast(`Enviando ${file.name}…`, false, 1600);
        const media = await uploadFile(file);
        await sendMediaMessage(media, '', undefined, convId);
      } catch (err) {
        toast(err.message, true);
      }
    }
  }

  function openMediaPreview(files, convId = state.activeId) {
    const first = files[0];
    const isVideo = first.type.startsWith('video/');
    const url = URL.createObjectURL(first);
    const body = `<div class="media-preview">${
      isVideo ? `<video src="${url}" controls autoplay muted playsinline></video>` : `<img src="${url}" alt="Pré-visualização" />`
    }</div>
      <div class="preview-files">${files
        .map(
          (f) => `<span class="preview-file">${f.type.startsWith('video/') ? icon('video') : icon('image')} ${escapeHTML(f.name || 'arquivo')} · ${formatSize(f.size)}</span>`
        )
        .join('')}</div>
      <label class="field"><span>Legenda</span><input id="mediaCaption" type="text" maxlength="1024" placeholder="Adicione uma legenda (opcional)" /></label>`;
    const close = openModal({
      title: files.length > 1 ? `Enviar ${files.length} arquivos` : isVideo ? 'Enviar vídeo' : 'Enviar foto',
      body,
      footer: `<button class="btn btn-secondary" data-modal-close>Cancelar</button><button class="btn btn-primary" id="sendMediaBtn">Enviar</button>`,
      wide: true,
      onClose: () => URL.revokeObjectURL(url),
      onMount: (modal) => {
        const btn = modal.querySelector('#sendMediaBtn');
        const caption = modal.querySelector('#mediaCaption');
        caption?.focus();
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = 'Enviando…';
          const text = caption?.value.trim() || '';
          try {
            for (let i = 0; i < files.length; i++) {
              const media = await uploadFile(files[i]);
              await sendMediaMessage(media, i === 0 ? text : '', undefined, convId);
            }
            close();
            URL.revokeObjectURL(url);
          } catch (err) {
            toast(err.message, true);
            btn.disabled = false;
            btn.textContent = 'Enviar';
          }
        });
      },
      onClose: () => URL.revokeObjectURL(url),
    });
  }

  /* ------------------------------- gravação de áudio ------------------------------- */

  function pickAudioMime() {
    if (!window.MediaRecorder) return '';
    const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return options.find((type) => {
      try {
        return MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    }) || '';
  }

  async function startRecording() {
    if (state.record || !state.activeId) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Gravação de áudio não é suportada neste navegador.', true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = pickAudioMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const rec = {
        recorder,
        stream,
        chunks: [],
        startedAt: Date.now(),
        timer: null,
        shouldSend: false,
        duration: 0,
        convId: state.activeId,
      };
      state.record = rec;
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) rec.chunks.push(event.data);
      };
      recorder.onstop = async () => {
        clearInterval(rec.timer);
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.max(1, Math.round((Date.now() - rec.startedAt) / 1000));
        const blob = new Blob(rec.chunks, { type: recorder.mimeType || 'audio/webm' });
        const shouldSend = rec.shouldSend;
        state.record = null;
        $('#recordBar').hidden = true;
        $('#composer').hidden = false;
        toggleSendMic();
        if (!shouldSend) return;
        if (blob.size < 500) {
          toast('Áudio muito curto.', true);
          return;
        }
        try {
          const file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type });
          toast('Enviando áudio…', false, 1600);
          const media = await uploadFile(file, { duration });
          await sendMediaMessage(media, '', duration, rec.convId);
        } catch (err) {
          toast(err.message, true);
        }
      };
      recorder.start(250);
      $('#recordBar').hidden = false;
      $('#composer').hidden = true;
      $('#recordTime').textContent = '0:00';
      rec.timer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - rec.startedAt) / 1000);
        $('#recordTime').textContent = toHHMMSS(elapsed);
        if (elapsed >= 300) stopRecording(true);
      }, 500);
      playSound('send');
    } catch (err) {
      const message = err?.name === 'NotAllowedError' ? 'Permissão de microfone negada.' : `Não foi possível gravar: ${err.message || err}`;
      toast(message, true);
      state.record = null;
      $('#recordBar').hidden = true;
      $('#composer').hidden = false;
    }
  }

  function stopRecording(send) {
    const rec = state.record;
    if (!rec) return;
    rec.shouldSend = Boolean(send);
    try {
      rec.recorder.stop();
    } catch {
      state.record = null;
      $('#recordBar').hidden = true;
      $('#composer').hidden = false;
      toggleSendMic();
    }
  }

  /* ------------------------------- áudio recebido ------------------------------- */

  function resetActiveAudioUI() {
    if (!state.activeAudio) return;
    const { btn, el, bars } = state.activeAudio;
    if (btn) {
      btn.innerHTML = icon('play');
      btn.classList.remove('playing');
    }
    if (bars) bars.forEach((b) => b.classList.remove('on'));
    if (el) el.pause();
    state.activeAudio = null;
  }

  function setupAudioControls(container) {
    container.addEventListener('click', (event) => {
      const action = event.target.closest('[data-audio-action]');
      if (!action) return;
      const wrap = action.closest('[data-audio-wrap]');
      if (!wrap) return;
      const audio = wrap.querySelector('audio');
      const playBtn = wrap.querySelector('.audio-play');
      const wave = wrap.querySelector('.wave');
      const timeEl = wrap.querySelector('.audio-time');
      const speedBtn = wrap.querySelector('.audio-speed');
      if (!audio) return;

      const rows = Array.from(wave?.children || []);
      const knownDuration = () =>
        Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number(wrap.dataset.duration) || 0;
      const paint = (fraction) => {
        rows.forEach((bar, i) => bar.classList.toggle('on', i / rows.length <= fraction));
      };
      const bind = () => {
        if (audio.dataset.bound === '1') return;
        audio.dataset.bound = '1';
        audio.addEventListener('timeupdate', () => {
          const total = knownDuration();
          if (!total) return;
          paint(audio.currentTime / total);
          if (timeEl) timeEl.textContent = formatDuration(audio.currentTime);
        });
        audio.addEventListener('ended', () => {
          paint(0);
          if (timeEl) timeEl.textContent = formatDuration(knownDuration());
          if (playBtn) {
            playBtn.innerHTML = icon('play');
            playBtn.classList.remove('playing');
          }
          state.activeAudio = null;
        });
      };

      const kind = action.dataset.audioAction;
      if (kind === 'play') {
        if (state.activeAudio && state.activeAudio.el !== audio) resetActiveAudioUI();
        if (audio.paused) {
          audio.play().then(() => {
            if (playBtn) {
              playBtn.innerHTML = icon('pause');
              playBtn.classList.add('playing');
            }
            state.activeAudio = { el: audio, btn: playBtn, bars: rows, wrap };
            bind();
          }).catch(() => toast('Não foi possível reproduzir o áudio.', true));
        } else {
          audio.pause();
          if (playBtn) {
            playBtn.innerHTML = icon('play');
            playBtn.classList.remove('playing');
          }
          state.activeAudio = null;
        }
      } else if (kind === 'seek') {
        const total = knownDuration();
        if (!total) return;
        const rect = wave.getBoundingClientRect();
        const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        audio.currentTime = fraction * total;
        paint(fraction);
      } else if (kind === 'speed') {
        const speeds = [1, 1.5, 2];
        const current = Number(speedBtn.dataset.speed || 1);
        const next = speeds[(speeds.indexOf(current) + 1) % speeds.length];
        speedBtn.dataset.speed = String(next);
        speedBtn.textContent = `${next}x`;
        audio.playbackRate = next;
      }
    });
  }

  /* ------------------------------- menus / reações ------------------------------- */

  function openCtxMenu(x, y, items) {
    $('#emojiPicker').hidden = true;
    $('#attachMenu').hidden = true;
    closeReactionBar();
    const menu = $('#ctxMenu');
    menu.innerHTML = items
      .map((item, idx) =>
        item.separator
          ? '<div class="ctx-sep"></div>'
          : item.title
            ? `<div class="ctx-title">${escapeHTML(item.title)}</div>`
            : `<button data-ctx="${idx}" class="${item.danger ? 'danger' : ''}">${item.icon ? icon(item.icon) : ''}<span>${escapeHTML(item.label)}</span></button>`
      )
      .join('');
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 10);
    const top = Math.min(y, window.innerHeight - rect.height - 10);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.onclick = (event) => {
      const btn = event.target.closest('[data-ctx]');
      if (!btn) return;
      const item = items[Number(btn.dataset.ctx)];
      closeCtxMenu();
      if (item?.action) item.action();
    };
  }

  function closeCtxMenu() {
    const menu = $('#ctxMenu');
    if (menu) menu.hidden = true;
  }

  function openReactionBar(anchor, msg) {
    $('#emojiPicker').hidden = true;
    $('#attachMenu').hidden = true;
    closeCtxMenu();
    const bar = $('#reactionBar');
    const emojis = ['❤️', '😂', '😮', '😢', '🙏', '👍'];
    bar.innerHTML = emojis.map((e) => `<button data-emoji="${e}" aria-label="Reagir com ${e}">${e}</button>`).join('');
    bar.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - barRect.width / 2;
    let top = rect.top - barRect.height - 10;
    left = Math.min(Math.max(8, left), window.innerWidth - barRect.width - 8);
    if (top < 8) top = rect.bottom + 10;
    bar.style.left = `${left}px`;
    bar.style.top = `${top}px`;
    bar.onclick = async (event) => {
      const btn = event.target.closest('[data-emoji]');
      if (!btn) return;
      closeReactionBar();
      try {
        await api(`/api/conversations/${msg.conversationId}/messages/${msg.id}/react`, {
          method: 'POST',
          body: { emoji: btn.dataset.emoji },
        });
      } catch (err) {
        toast(err.message, true);
      }
    };
  }

  function closeReactionBar() {
    const bar = $('#reactionBar');
    if (bar) bar.hidden = true;
  }

  function openMessageMenu(msg, x, y) {
    const items = [];
    items.push({ label: 'Responder', icon: 'reply', action: () => setReply(msg) });
    items.push({ label: 'Reagir', icon: 'smile', action: () => {
      const node = document.querySelector(`.msg-row[data-id="${msg.id}"] .bubble`);
      if (node) openReactionBar(node, msg);
    } });
    if (msg.body && !msg.deleted) {
      items.push({
        label: 'Copiar texto',
        icon: 'copy',
        action: async () => {
          try {
            await navigator.clipboard.writeText(msg.body);
            toast('Texto copiado.');
          } catch {
            toast('Não foi possível copiar.', true);
          }
        },
      });
    }
    if (msg.media) {
      items.push({
        label: 'Baixar arquivo',
        icon: 'download',
        action: () => window.open(msg.media.url, '_blank', 'noopener'),
      });
    }
    items.push({ separator: true });
    items.push({
      label: 'Apagar para mim',
      icon: 'trash',
      danger: true,
      action: () => deleteMessage(msg, 'me'),
    });
    if (msg.isMine && !msg.deleted) {
      items.push({
        label: 'Apagar para todos',
        icon: 'trash',
        danger: true,
        action: () => deleteMessage(msg, 'all'),
      });
    }
    openCtxMenu(x, y, items);
  }

  async function deleteMessage(msg, scope) {
    const verb = scope === 'all' ? 'para todos' : 'para mim';
    const ok = await confirmDialog('Apagar mensagem', `Tem certeza que deseja apagar esta mensagem ${verb}?`, 'Apagar', true);
    if (!ok) return;
    try {
      await api(`/api/conversations/${msg.conversationId}/messages/${msg.id}?scope=${scope}`, { method: 'DELETE' });
      if (scope === 'all') {
        const list = state.messages.get(msg.conversationId);
        const found = list?.find((m) => m.id === msg.id);
        if (found) {
          found.deleted = true;
          found.body = '';
          found.media = null;
          patchMessageNode(found);
        }
      } else {
        const list = state.messages.get(msg.conversationId);
        if (list) {
          const idx = list.findIndex((m) => m.id === msg.id);
          if (idx >= 0) list.splice(idx, 1);
        }
        document.querySelector(`.msg-row[data-id="${msg.id}"]`)?.remove();
      }
    } catch (err) {
      toast(err.message, true);
    }
  }

  function setReply(msg) {
    state.replyTo = msg;
    renderReply();
    $('#messageInput')?.focus({ preventScroll: true });
  }

  function renderReply() {
    const bar = $('#replyBar');
    if (!bar) return;
    if (!state.replyTo) {
      bar.hidden = true;
      return;
    }
    const msg = state.replyTo;
    $('.reply-name', bar).textContent = msg.isMine ? 'Você' : msg.senderName;
    $('.reply-text', bar).textContent = msg.body || (msg.type === 'audio' ? 'Mensagem de voz' : msg.deleted ? 'Mensagem apagada' : 'Mídia');
    bar.hidden = false;
  }

  /* ------------------------------- lightbox ------------------------------- */

  function openLightbox(src, kind = 'image') {
    const stage = $('#lbStage');
    if (!stage || !src) return;
    stage.innerHTML = kind === 'video' ? `<video src="${escapeHTML(src)}" controls autoplay playsinline></video>` : `<img src="${escapeHTML(src)}" alt="Mídia" />`;
    const dl = $('#lbDownload');
    if (dl) dl.href = src;
    $('#lightbox').hidden = false;
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    const stage = $('#lbStage');
    if (stage) {
      stage.querySelector('video')?.pause();
      stage.innerHTML = '';
    }
  }

  /* ------------------------------- modais / drawer ------------------------------- */

  let drawerToken = 0;

  function openDrawer(html) {
    closeDrawers(true);
    const root = $('#drawerRoot');
    root.innerHTML = `<div class="drawer" role="dialog" aria-modal="true">${html}</div>`;
    const drawer = root.firstElementChild;
    $('#drawerBackdrop').hidden = false;
    requestAnimationFrame(() => drawer.classList.add('open'));
    drawer.querySelectorAll('[data-drawer-close]').forEach((btn) => btn.addEventListener('click', () => closeDrawers()));
  }

  function closeDrawers(immediate = true) {
    const root = $('#drawerRoot');
    const drawer = root?.querySelector('.drawer');
    $('#drawerBackdrop').hidden = true;
    if (!drawer) return;
    drawerToken++;
    if (immediate) {
      root.innerHTML = '';
      return;
    }
    drawer.classList.remove('open');
    const token = drawerToken;
    setTimeout(() => {
      if (token === drawerToken) root.innerHTML = '';
    }, 230);
  }

  function openModal({ title, body, footer = '', wide = false, onMount = null, onClose = null, closable = true }) {
    closeModal();
    const root = $('#modalRoot');
    root.innerHTML = `<div class="modal-backdrop">
        <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title || '')}">
          <div class="modal-head"><h3>${escapeHTML(title || '')}</h3>${
            closable ? `<button class="icon-btn" data-modal-close aria-label="Fechar">${icon('x')}</button>` : ''
          }</div>
          <div class="modal-body">${body || ''}</div>
          ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
        </div>
      </div>`;
    const backdrop = root.firstElementChild;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      root.innerHTML = '';
      if (onClose) onClose();
    };
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop && closable) close();
    });
    root.querySelectorAll('[data-modal-close]').forEach((btn) => btn.addEventListener('click', close));
    modalCloseRef = close;
    if (onMount) onMount(root.querySelector('.modal'), close);
    return close;
  }

  let modalCloseRef = null;

  function closeModal() {
    const root = $('#modalRoot');
    if (!root) return;
    if (modalCloseRef) {
      const fn = modalCloseRef;
      modalCloseRef = null;
      fn();
    } else {
      root.innerHTML = '';
    }
  }

  function confirmDialog(title, message, confirmLabel = 'Confirmar', danger = false) {
    return new Promise((resolve) => {
      let result = false;
      const close = openModal({
        title,
        body: `<p style="margin:0;font-size:14px;line-height:1.55;color:var(--text-2)">${escapeHTML(message)}</p>`,
        footer: `<button class="btn btn-secondary" data-modal-close>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="confirmAction">${escapeHTML(confirmLabel)}</button>`,
        onMount: (modal, closeFn) => {
          modal.querySelector('#confirmAction').addEventListener('click', () => {
            result = true;
            closeFn();
          });
        },
        onClose: () => resolve(result),
      });
      void close;
    });
  }

  function contactRowHTML(user, opts = {}) {
    return `<button class="contact-row ${opts.selected ? 'selected' : ''}" data-user-id="${user.id}" data-name="${escapeHTML(user.name)}">
        ${avatarHTML(user, { size: 'sm', online: user.online })}
        <span class="c-txt"><strong>${escapeHTML(user.name)}</strong><small>${escapeHTML(user.about || formatPhone(user.phone))}</small></span>
        ${opts.withCheck ? `<span class="check">${icon('check')}</span>` : ''}
      </button>`;
  }

  async function openNewChat() {
    let users = [];
    try {
      users = (await api('/api/users')).users;
    } catch (err) {
      return toast(err.message, true);
    }
    const body = `<label class="field"><span>Pesquisar contato</span><input id="newChatSearch" placeholder="Nome ou número" /></label>
      <div class="contact-list" id="contactList">${users.map((u) => contactRowHTML(u)).join('') || '<p class="muted">Nenhum contato disponível.</p>'}</div>`;
    openModal({
      title: 'Nova conversa',
      body,
      footer: `<button class="btn btn-secondary" data-modal-close>Fechar</button><button class="btn btn-primary" id="goNewGroup">${icon('users')} Novo grupo</button>`,
      onMount: (modal, close) => {
        const search = modal.querySelector('#newChatSearch');
        search?.addEventListener('input', () => {
          const q = search.value.trim().toLowerCase();
          modal.querySelectorAll('.contact-row').forEach((row) => {
            row.style.display = row.dataset.name.toLowerCase().includes(q) ? '' : 'none';
          });
        });
        modal.querySelector('#contactList')?.addEventListener('click', async (event) => {
          const row = event.target.closest('[data-user-id]');
          if (!row) return;
          try {
            const { conversation } = await api('/api/conversations', { method: 'POST', body: { userId: row.dataset.userId } });
            close();
            upsertConv(conversation, { silent: true });
            await openConversation(conversation.id);
          } catch (err) {
            toast(err.message, true);
          }
        });
        modal.querySelector('#goNewGroup')?.addEventListener('click', () => {
          close();
          openNewGroup();
        });
      },
    });
  }

  async function openNewGroup() {
    let users = [];
    try {
      users = (await api('/api/users')).users;
    } catch (err) {
      return toast(err.message, true);
    }
    const selected = new Set();
    const body = `<label class="field"><span>Nome do grupo</span><input id="groupName" placeholder="Ex.: Time de Produto" maxlength="60" /></label>
      <div class="field" style="margin-bottom:4px"><span>Participantes</span></div>
      <div class="chip-list" id="selectedChips"></div>
      <div class="contact-list" id="groupContacts">${users.map((u) => contactRowHTML(u, { withCheck: true })).join('')}</div>`;
    const footer = `<button class="btn btn-secondary" data-modal-close>Cancelar</button><button class="btn btn-primary" id="createGroup" disabled>Criar grupo</button>`;
    openModal({
      title: 'Novo grupo',
      body,
      footer,
      onMount: (modal, close) => {
        const nameInput = modal.querySelector('#groupName');
        const createBtn = modal.querySelector('#createGroup');
        const chips = modal.querySelector('#selectedChips');
        const list = modal.querySelector('#groupContacts');
        const refresh = () => {
          chips.innerHTML = Array.from(selected)
            .map((id) => {
              const u = users.find((x) => x.id === id);
              if (!u) return '';
              return `<span class="member-chip">${avatarHTML(u)}${escapeHTML(firstName(u.name))}<button data-remove="${u.id}" aria-label="Remover">${icon('x')}</button></span>`;
            })
            .join('');
          createBtn.disabled = !nameInput.value.trim() || selected.size === 0;
          createBtn.classList.toggle('btn-primary', !createBtn.disabled);
        };
        nameInput.addEventListener('input', refresh);
        list.addEventListener('click', (event) => {
          const row = event.target.closest('[data-user-id]');
          if (!row) return;
          const id = row.dataset.userId;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          row.classList.toggle('selected', selected.has(id));
          refresh();
        });
        chips.addEventListener('click', (event) => {
          const btn = event.target.closest('[data-remove]');
          if (!btn) return;
          selected.delete(btn.dataset.remove);
          const row = list.querySelector(`[data-user-id="${btn.dataset.remove}"]`);
          row?.classList.remove('selected');
          refresh();
        });
        createBtn.addEventListener('click', async () => {
          createBtn.disabled = true;
          try {
            const { conversation } = await api('/api/conversations', {
              method: 'POST',
              body: { type: 'group', name: nameInput.value.trim(), memberIds: Array.from(selected) },
            });
            close();
            upsertConv(conversation, { silent: true });
            await openConversation(conversation.id);
            toast('Grupo criado!');
          } catch (err) {
            toast(err.message, true);
            createBtn.disabled = false;
          }
        });
        nameInput.focus();
        refresh();
      },
    });
  }

  /* ------------------------------- perfil / configurações ------------------------------- */

  function switchHTML(key, on, label, description) {
    return `<div class="settings-row">
        <div class="sr-txt"><strong>${escapeHTML(label)}</strong><small>${escapeHTML(description)}</small></div>
        <button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}" data-toggle="${key}" aria-label="${escapeHTML(label)}"></button>
      </div>`;
  }

  function openProfile(focusSettings = false) {
    if (!state.me) return;
    const body = `<div class="drawer-hero">
        ${avatarHTML(myAvatar(), { size: 'lg' })}
        <h2>${escapeHTML(state.me.name)}</h2>
        <p>${escapeHTML(formatPhone(state.me.phone))}</p>
      </div>
      <div class="drawer-section" id="profileSection">
        <h4>Seu perfil</h4>
        <div class="profile-edit">
          <label class="field" style="margin:0"><span>Nome</span><input id="profileName" maxlength="40" value="${escapeHTML(state.me.name)}" /></label>
          <label class="field" style="margin:0"><span>Recado</span><input id="profileAbout" maxlength="120" value="${escapeHTML(state.me.about || '')}" /></label>
          <button class="btn btn-primary" id="saveProfile" style="align-self:flex-start">Salvar perfil</button>
        </div>
      </div>
      <div class="drawer-section" id="settingsSection">
        <h4>Preferências</h4>
        ${switchHTML('theme', PREFS.theme === 'dark', 'Tema escuro', 'Alterna entre o modo escuro e o claro')}
        ${switchHTML('sound', PREFS.sound, 'Sons', 'Efeitos sonoros ao enviar e receber mensagens')}
        ${switchHTML('notifications', PREFS.notifications, 'Notificações', 'Avisos do navegador quando a aba está em segundo plano')}
        ${switchHTML('autoReplies', state.settings.autoReplies, 'Respostas automáticas', 'Contatos demo respondem às suas mensagens')}
      </div>
      <div class="drawer-section">
        <h4>Conta</h4>
        <button class="drawer-row danger" data-profile-action="logout">
          <span class="row-ico">${icon('logout')}</span>
          <span class="row-txt"><strong>Sair da conta</strong><small>Encerra a sessão neste navegador</small></span>
        </button>
      </div>
      <p class="drawer-note">
        Esta é uma demonstração funcional independente do WhatsApp. Mensagens, contas e arquivos ficam salvos no servidor local da demo.
      </p>`;
    openDrawer(
      `<div class="drawer-head"><h3>Perfil e configurações</h3><button class="icon-btn" data-drawer-close aria-label="Fechar">${icon('x')}</button></div>
       <div class="drawer-body">${body}</div>`
    );
    const drawer = $('#drawerRoot .drawer');
    drawer.querySelector('#saveProfile')?.addEventListener('click', async () => {
      const name = drawer.querySelector('#profileName').value.trim();
      const about = drawer.querySelector('#profileAbout').value.trim();
      if (name.length < 2) return toast('O nome precisa ter ao menos 2 caracteres.', true);
      try {
        const { user } = await api('/api/me', { method: 'PATCH', body: { name, about } });
        state.me = user;
        renderMe();
        toast('Perfil atualizado.');
      } catch (err) {
        toast(err.message, true);
      }
    });
    drawer.querySelector('[data-profile-action="logout"]')?.addEventListener('click', async () => {
      const ok = await confirmDialog('Sair da conta', 'Você vai precisar entrar novamente com seu telefone.', 'Sair', true);
      if (!ok) return;
      try {
        await api('/api/logout', { method: 'POST' });
      } catch {
        /* ignore */
      }
      state.token = '';
      store.removeItem(TOKEN_KEY);
      if (state.events) state.events.close();
      location.reload();
    });
    drawer.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.toggle;
        if (key === 'theme') {
          const next = PREFS.theme === 'dark' ? 'light' : 'dark';
          applyTheme(next);
          btn.classList.toggle('on', next === 'dark');
          btn.setAttribute('aria-checked', String(next === 'dark'));
          return;
        }
        if (key === 'sound') {
          PREFS.sound = !PREFS.sound;
          store.setItem('wam_sound', PREFS.sound ? '1' : '0');
          if (PREFS.sound) playSound('receive');
        } else if (key === 'notifications') {
          if (!PREFS.notifications) {
            const granted = await enableNotifications();
            if (!granted) return;
            PREFS.notifications = true;
          } else {
            PREFS.notifications = false;
          }
          store.setItem('wam_notifications', PREFS.notifications ? '1' : '0');
        } else if (key === 'autoReplies') {
          try {
            const settings = await api('/api/settings', { method: 'PATCH', body: { autoReplies: !state.settings.autoReplies } });
            state.settings = settings;
            toast(settings.autoReplies ? 'Respostas automáticas ativadas.' : 'Respostas automáticas desativadas.');
          } catch (err) {
            toast(err.message, true);
            return;
          }
        }
        const on = key === 'theme' ? PREFS.theme === 'dark' : key === 'sound' ? PREFS.sound : key === 'notifications' ? PREFS.notifications : state.settings.autoReplies;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', String(on));
      });
    });
    if (focusSettings) setTimeout(() => drawer.querySelector('#settingsSection')?.scrollIntoView({ block: 'start' }), 320);
  }

  /* ------------------------------- informações da conversa ------------------------------- */

  async function openInfo() {
    const conv = activeConv();
    if (!conv) return;
    let details = state.details.get(conv.id);
    if (!details) {
      try {
        details = await api(`/api/conversations/${conv.id}`);
        state.details.set(conv.id, details);
      } catch (err) {
        return toast(err.message, true);
      }
    }
    renderInfoDrawer(details);
  }

  function renderInfoDrawer(details) {
    const conv = getConv(details.conversation.id) || details.conversation;
    const isGroup = conv.isGroup;
    const contact = conv.contact;
    const members = details.members || [];
    const subtitle = isGroup
      ? `Grupo · ${members.length} participantes`
      : conv.online || state.online.has(contact?.id)
        ? 'online'
        : lastSeenText(conv.lastSeen);
    const about = isGroup
      ? `Criado em ${DATE_FMT.format(new Date(details.stats.createdAt || conv.createdAt))}`
      : contact?.about || 'Disponível';

    const actionRows = `
      <button class="drawer-row" data-info-action="mute">
        <span class="row-ico">${icon(conv.muted ? 'bell' : 'bell-off')}</span>
        <span class="row-txt"><strong>${conv.muted ? 'Reativar notificações' : 'Silenciar conversa'}</strong><small>${conv.muted ? 'Voltar a receber avisos' : 'Não receber avisos e sons'}</small></span>
      </button>
      <button class="drawer-row" data-info-action="pin">
        <span class="row-ico">${icon('pin')}</span>
        <span class="row-txt"><strong>${conv.pinned ? 'Desafixar conversa' : 'Fixar conversa'}</strong><small>${conv.pinned ? 'Remover do topo' : 'Manter no topo da lista'}</small></span>
      </button>
      <button class="drawer-row" data-info-action="archive">
        <span class="row-ico">${icon('archive')}</span>
        <span class="row-txt"><strong>${conv.archived ? 'Desarquivar conversa' : 'Arquivar conversa'}</strong><small>${conv.archived ? 'Voltar para a lista principal' : 'Mover para conversas arquivadas'}</small></span>
      </button>
      <button class="drawer-row danger" data-info-action="clear">
        <span class="row-ico">${icon('trash')}</span>
        <span class="row-txt"><strong>Limpar conversa</strong><small>Apagar o histórico para você</small></span>
      </button>`;

    const iAmAdmin = Boolean(members.find((m) => m.isMe)?.isAdmin);
    const memberRows = members
      .map(
        (m) => `<div class="member-row">
          ${avatarHTML(m, { size: 'sm', online: m.online })}
          <span class="m-name">${escapeHTML(m.name)}${m.isMe ? ' (você)' : ''}</span>
          ${m.isAdmin ? '<span class="m-tag">admin</span>' : ''}
          ${
            isGroup && iAmAdmin && !m.isMe
              ? `<button class="icon-btn m-remove" data-remove-member="${m.id}" title="Remover participante" aria-label="Remover ${escapeHTML(m.name)}">${icon('x')}</button>`
              : ''
          }
        </div>`
      )
      .join('');

    const directRows = `<div class="drawer-section">
        <h4>Telefone</h4>
        <p class="about-text">${escapeHTML(formatPhone(contact?.phone))}</p>
      </div>
      <div class="drawer-section">
        <h4>Sobre</h4>
        <p class="about-text">${escapeHTML(about)}</p>
      </div>`;

    const body = `<div class="drawer-hero">
        ${avatarHTML(conv, { size: 'lg', online: conv.online, group: isGroup })}
        <h2>${escapeHTML(conv.title)}</h2>
        <p>${escapeHTML(subtitle)}</p>
      </div>
      <div class="drawer-section">
        <h4>Na conversa</h4>
        <div class="stat-grid">
          <div class="stat-card"><strong>${details.stats.messages}</strong><small>mensagens</small></div>
          <div class="stat-card"><strong>${details.stats.media}</strong><small>mídias</small></div>
          <div class="stat-card"><strong>${DATE_FMT.format(new Date(details.stats.createdAt || conv.createdAt)).slice(0, 5)}</strong><small>início</small></div>
        </div>
      </div>
      ${
        isGroup
          ? `<div class="drawer-section"><div class="section-head"><h4>Participantes (${members.length})</h4><button class="link-btn" data-info-action="add-members">Adicionar</button></div>${memberRows}</div>`
          : directRows
      }
      ${isGroup ? `<div class="drawer-section"><h4>Grupo</h4><button class="drawer-row danger" data-info-action="leave"><span class="row-ico">${icon('logout')}</span><span class="row-txt"><strong>Sair do grupo</strong><small>Você deixa de receber as mensagens deste grupo</small></span></button></div>` : ''}
      <div class="drawer-section"><h4>Ações</h4>${actionRows}</div>
      <p class="drawer-note">Mensagens e mídias desta demonstração ficam armazenadas no servidor local.</p>`;

    openDrawer(
      `<div class="drawer-head"><button class="icon-btn" data-drawer-close aria-label="Fechar">${icon('x')}</button><h3>Dados da conversa</h3></div>
       <div class="drawer-body">${body}</div>`
    );

    $('#drawerRoot').querySelectorAll('[data-remove-member]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const memberId = btn.dataset.removeMember;
        const member = members.find((m) => m.id === memberId);
        if (!member) return;
        const ok = await confirmDialog('Remover participante', `Remover ${member.name} do grupo?`, 'Remover', true);
        if (!ok) return;
        try {
          await api(`/api/conversations/${details.conversation.id}/participants/${memberId}`, { method: 'DELETE' });
          const fresh = await api(`/api/conversations/${details.conversation.id}`);
          state.details.set(fresh.conversation.id, fresh);
          upsertConv(fresh.conversation, { silent: true });
          renderInfoDrawer(fresh);
          toast(`${member.name} foi removido(a) do grupo.`);
        } catch (err) {
          toast(err.message, true);
        }
      });
    });

    $('#drawerRoot').querySelectorAll('[data-info-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.infoAction;
        const current = getConv(details.conversation.id);
        if (!current) return;
        try {
          if (action === 'mute' || action === 'pin' || action === 'archive') {
            const field = action === 'mute' ? 'muted' : action === 'pin' ? 'pinned' : 'archived';
            const { conversation } = await api(`/api/conversations/${current.id}`, {
              method: 'PATCH',
              body: { [field]: !current[field] },
            });
            upsertConv(conversation);
            details.conversation = conversation;
            if (action === 'archive') {
              closeDrawers();
              if (conversation.archived) {
                closeChat();
                toast('Conversa arquivada.');
              } else {
                toast('Conversa desarquivada.');
                openConversation(conversation.id);
              }
              return;
            }
            renderInfoDrawer(details);
            toast(action === 'mute' ? (conversation.muted ? 'Conversa silenciada.' : 'Notificações reativadas.') : conversation.pinned ? 'Conversa fixada.' : 'Conversa desafixada.');
          } else if (action === 'add-members') {
          openAddParticipants(details);
        } else if (action === 'leave') {
          const ok = await confirmDialog('Sair do grupo', `Você vai sair de "${current.title}". As mensagens deixarão de aparecer para você.`, 'Sair do grupo', true);
          if (!ok) return;
          await api(`/api/conversations/${current.id}/participants/${state.me.id}`, { method: 'DELETE' });
          closeDrawers();
          dropConversation(current.id);
          toast('Você saiu do grupo.');
        } else if (action === 'clear') {
            const ok = await confirmDialog('Limpar conversa', 'Todas as mensagens serão apagadas apenas para você. Esta ação não pode ser desfeita.', 'Limpar', true);
            if (!ok) return;
            await api(`/api/conversations/${current.id}/clear`, { method: 'POST' });
            state.messages.set(current.id, []);
            state.hasMore.set(current.id, false);
            closeDrawers();
            renderMessages({ scroll: 'bottom' });
            toast('Conversa limpa.');
          }
        } catch (err) {
          toast(err.message, true);
        }
      });
    });
  }

  async function openAddParticipants(details) {
    const conv = details.conversation;
    let users = [];
    try {
      users = (await api('/api/users')).users;
    } catch (err) {
      return toast(err.message, true);
    }
    const inGroup = new Set((details.members || []).map((m) => m.id));
    const candidates = users.filter((u) => !inGroup.has(u.id));
    if (!candidates.length) return toast('Todos os seus contatos já estão neste grupo.');

    openModal({
      title: 'Adicionar participantes',
      body: `<p class="modal-hint">Escolha um ou mais contatos para entrar no grupo.</p>
        <div class="contact-list" data-add-list>${candidates.map((u) => contactRowHTML(u, { withCheck: true })).join('')}</div>`,
      footer: `<button class="btn btn-secondary" data-modal-close>Cancelar</button><button class="btn btn-primary" id="confirmAddMembers" disabled>Adicionar</button>`,
      onMount: (modal, close) => {
        const selected = new Set();
        const confirmBtn = modal.querySelector('#confirmAddMembers');
        const refresh = () => {
          confirmBtn.disabled = selected.size === 0;
          confirmBtn.textContent = selected.size > 1 ? `Adicionar ${selected.size}` : 'Adicionar';
        };
        modal.querySelector('[data-add-list]')?.addEventListener('click', (event) => {
          const row = event.target.closest('[data-user-id]');
          if (!row) return;
          const id = row.dataset.userId;
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          row.classList.toggle('selected', selected.has(id));
          refresh();
        });
        confirmBtn.addEventListener('click', async () => {
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'Adicionando…';
          try {
            for (const userId of selected) {
              await api(`/api/conversations/${conv.id}/participants`, { method: 'POST', body: { userId } });
            }
            const fresh = await api(`/api/conversations/${conv.id}`);
            state.details.set(fresh.conversation.id, fresh);
            upsertConv(fresh.conversation, { silent: true });
            close();
            renderInfoDrawer(fresh);
            toast(selected.size > 1 ? `${selected.size} participantes entraram no grupo.` : 'Participante adicionado ao grupo.');
          } catch (err) {
            toast(err.message, true);
            refresh();
          }
        });
      },
    });
  }

  /* ------------------------------- chamadas ------------------------------- */

  function startCall(kind) {
    const conv = activeConv();
    if (!conv || state.call) return;
    const call = {
      convId: conv.id,
      kind,
      startedAt: Date.now(),
      connectedAt: null,
      timer: null,
      connectTimer: null,
    };
    state.call = call;
    $('#callOverlay').hidden = false;
    paintAvatar($('#callAvatar'), conv, { group: conv.isGroup });
    $('#callName').textContent = conv.title;
    $('#callStatus').textContent = kind === 'video' ? 'Chamando vídeo…' : 'Chamando…';
    $('#callMute').classList.remove('active');
    $('#callCam').classList.remove('active');
    playSound('send');

    call.connectTimer = setTimeout(() => {
      if (!state.call || state.call !== call) return;
      call.connectedAt = Date.now();
      const tick = () => {
        if (!state.call || state.call !== call) return;
        const elapsed = Math.floor((Date.now() - call.connectedAt) / 1000);
        $('#callStatus').textContent = `Conectada · ${toHHMMSS(elapsed)}`;
      };
      tick();
      call.timer = setInterval(tick, 1000);
    }, 2400);
  }

  async function endCall() {
    const call = state.call;
    if (!call) return;
    clearTimeout(call.connectTimer);
    clearInterval(call.timer);
    state.call = null;
    $('#callOverlay').hidden = true;
    const duration = call.connectedAt ? Math.max(1, Math.round((Date.now() - call.connectedAt) / 1000)) : 0;
    const status = call.connectedAt ? 'answered' : 'missed';
    try {
      await api('/api/calls', { method: 'POST', body: { conversationId: call.convId, kind: call.kind, duration, status } });
      toast(call.connectedAt ? `Chamada encerrada · ${toHHMMSS(duration)}` : 'Chamada não atendida.');
    } catch (err) {
      toast(err.message, true);
    }
  }

  /* ------------------------------- eventos estáticos ------------------------------- */

  function bindStaticEvents() {
    // login
    $('#demoLoginBtn')?.addEventListener('click', (event) => doDemoLogin(event.currentTarget));
    $('#loginForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      doLogin(event.currentTarget);
    });
    $('#loginPhone')?.addEventListener('input', (event) => {
      const digits = event.target.value.replace(/\D/g, '');
      if (digits.length === 11) {
        event.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
      } else if (digits.length === 13 && digits.startsWith('55')) {
        event.target.value = `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
      }
    });

    // sidebar
    $('#chatList')?.addEventListener('click', (event) => {
      const item = event.target.closest('[data-conv-id]');
      if (item) openConversation(item.dataset.convId);
    });
    $('#filterChips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-filter]');
      if (chip) setFilter(chip.dataset.filter);
    });
    $$('.rail-btn[data-rail]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const rail = btn.dataset.rail;
        if (rail === 'new') return openNewChat();
        setFilter(rail === 'chats' ? 'all' : rail);
        if (window.innerWidth > 900) $$('.rail-btn[data-rail]').forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    $('#searchInput')?.addEventListener('input', (event) => setSearch(event.target.value));
    $('#searchClear')?.addEventListener('click', () => {
      $('#searchInput').value = '';
      setSearch('');
      $('#searchInput').focus();
    });
    $('#searchResults')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-search-msg]');
      if (!btn) return;
      const convId = btn.dataset.searchConv;
      const msgId = btn.dataset.searchMsg;
      $('#searchInput').value = '';
      setSearch('');
      jumpToMessage(convId, msgId);
    });

    // ações genéricas (delegação global)
    document.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      const action = actionEl?.dataset.action;
      if (action) {
        const actions = {
          'open-profile': () => openProfile(),
          'open-settings': () => openProfile(true),
          'new-chat': () => openNewChat(),
          'new-group': () => openNewGroup(),
          'sidebar-menu': (el) => openSidebarMenu(el),
          back: () => closeChat(),
          'open-info': () => openInfo(),
          'call-audio': () => startCall('audio'),
          'call-video': () => startCall('video'),
          'toggle-emoji': () => toggleEmoji(),
          'toggle-attach': () => toggleAttach(),
          send: () => sendText(),
          'start-recording': () => startRecording(),
          'cancel-recording': () => stopRecording(false),
          'send-recording': () => stopRecording(true),
          'cancel-reply': () => setReply(null),
          'chat-search': () => openChatSearch(),
          'chat-search-close': () => closeChatSearch(),
          'load-older': () => loadOlder(),
          'lb-close': () => closeLightbox(),
        };
        if (actions[action]) {
          if (action !== 'send') event.preventDefault();
          actions[action](actionEl, event);
          return;
        }
      }
      // fecha popovers abertos (sem fechar o que acabou de ser aberto)
      const popoverOrigin = event.target.closest(
        '[data-ctx], [data-emoji], [data-action="toggle-emoji"], [data-action="toggle-attach"], [data-action="sidebar-menu"], [data-msg-action="menu"], [data-msg-action="react"]'
      );
      if (!popoverOrigin) {
        $('#emojiPicker').hidden = true;
        $('#attachMenu').hidden = true;
        closeCtxMenu();
        closeReactionBar();
      }
    });

    // composer
    const input = $('#messageInput');
    input?.addEventListener('input', () => {
      autosize();
      if (input.value.trim()) sendTyping();
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendText();
      }
    });
    input?.addEventListener('blur', () => autosize());

    // mensagens (ações, mídia, áudio, reações)
    const messagesEl = $('#messages');
    messagesEl?.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-msg-action]');
      if (!actionEl) {
        const touchLike = window.matchMedia?.('(hover: none)').matches;
        if (touchLike && !event.target.closest('video, audio, a, [data-audio-action], [data-msg-action]')) {
          const row = event.target.closest('.msg-row');
          if (row) {
            const open = row.classList.contains('show-actions');
            $$('#messages .msg-row.show-actions').forEach((r) => r.classList.remove('show-actions'));
            if (!open) row.classList.add('show-actions');
          }
        }
        return;
      }
      const row = actionEl.closest('[data-id]');
      const msg = row ? findMsg(row.dataset.id) : null;
      const kind = actionEl.dataset.msgAction;
      if (kind === 'lightbox') {
        const src = actionEl.dataset.src;
        openLightbox(src, actionEl.dataset.kind || 'image');
        return;
      }
      if (!msg) return;
      if (kind === 'reply') setReply(msg);
      else if (kind === 'react') {
        const bubble = row.querySelector('.bubble');
        openReactionBar(bubble || row, msg);
      } else if (kind === 'menu') openMessageMenu(msg, event.clientX, event.clientY);
      else if (kind === 'jump') {
        const target = actionEl.dataset.target;
        const node = document.querySelector(`.msg-row[data-id="${target}"]`);
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' });
          node.classList.add('highlight');
          setTimeout(() => node.classList.remove('highlight'), 1600);
        } else toast('Mensagem original não carregada.');
      }
    });
    if (messagesEl) setupAudioControls(messagesEl);
    messagesEl?.addEventListener('scroll', () => {
      if (messagesEl.scrollTop < 70) loadOlder();
      if (isNearBottom()) state.unseenWhileAway = 0;
      updateScrollButton();
    });
    $('#scrollBottom')?.addEventListener('click', () => scrollToBottom(true));

    // chat search
    $('#chatSearchInput')?.addEventListener('input', (event) => applyChatSearch(event.target.value));

    // attch/emoji menus
    $('#attachMenu')?.addEventListener('click', async (event) => {
      const btn = event.target.closest('[data-attach]');
      if (!btn) return;
      $('#attachMenu').hidden = true;
      const kind = btn.dataset.attach;
      if (kind === 'image') {
        const files = await pickFiles('image/*,video/*');
        if (files.length) handleSelectedFiles(files);
      } else if (kind === 'document') {
        const files = await pickFiles('');
        if (files.length) handleSelectedFiles(files);
      } else if (kind === 'camera') {
        const files = await pickFiles('image/*', 'environment');
        if (files.length) handleSelectedFiles(files);
      }
    });
    $('#emojiPicker')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-emoji]');
      if (!btn) return;
      insertEmoji(btn.dataset.emoji);
    });
    $('#emojiPicker')?.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true });

    // drawer
    $('#drawerBackdrop')?.addEventListener('click', () => closeDrawers());

    // lightbox
    $('#lightbox')?.addEventListener('click', (event) => {
      if (event.target.id === 'lightbox') closeLightbox();
    });

    // call
    $('#callEnd')?.addEventListener('click', endCall);
    $('#callMute')?.addEventListener('click', (event) => event.currentTarget.classList.toggle('active'));
    $('#callCam')?.addEventListener('click', (event) => event.currentTarget.classList.toggle('active'));

    // drag & drop
    let dragDepth = 0;
    const showDrag = () => {
      if (!state.activeId) return;
      $('#dragOverlay').hidden = false;
    };
    const hideDrag = () => {
      dragDepth = 0;
      $('#dragOverlay').hidden = true;
    };
    document.addEventListener('dragenter', (event) => {
      if (!state.activeId) return;
      if (!event.dataTransfer?.types?.includes('Files')) return;
      dragDepth++;
      showDrag();
    });
    document.addEventListener('dragover', (event) => {
      if (state.activeId) event.preventDefault();
    });
    document.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDrag();
    });
    document.addEventListener('drop', (event) => {
      if (!state.activeId) return;
      event.preventDefault();
      hideDrag();
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) handleSelectedFiles(files);
    });

    // teclado global
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!$('#lightbox').hidden) closeLightbox();
        else if (!$('#modalRoot').firstElementChild) {
          closeCtxMenu();
          closeReactionBar();
          closeDrawers();
          $('#emojiPicker').hidden = true;
          $('#attachMenu').hidden = true;
          if (!$('#chatSearchBar').hidden) closeChatSearch();
        } else closeModal();
        if (!$('#callOverlay').hidden) endCall();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('#searchInput')?.focus();
      }
    });

    // atualiza leitura ao voltar para a aba
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && state.activeId) markReadSoon(state.activeId, 300);
      if (document.title.includes('(') && !document.hidden) updateBadges();
    });

    // primeiro gesto libera áudio
    document.addEventListener('pointerdown', primeAudio, { once: true });

    // presença periódica local (atualiza "visto por último")
    setInterval(() => {
      if (state.activeId) renderChatHeader();
    }, 60_000);

    window.addEventListener('resize', () => {
      const app = $('#appView');
      if (!app) return;
      if (window.innerWidth > 900 && state.activeId) app.classList.add('chat-open');
      if (!state.activeId) app.classList.remove('chat-open');
    });
  }

  function openSidebarMenu(anchor) {
    const rect = anchor.getBoundingClientRect();
    openCtxMenu(rect.right - 6, rect.bottom + 6, [
      { title: 'WhatsApp Web' },
      { label: 'Meu perfil', icon: 'info', action: () => openProfile() },
      { label: 'Configurações', icon: 'gear', action: () => openProfile(true) },
      { label: PREFS.theme === 'dark' ? 'Tema claro' : 'Tema escuro', icon: PREFS.theme === 'dark' ? 'sun' : 'moon', action: toggleTheme },
      { label: 'Novo grupo', icon: 'users', action: () => openNewGroup() },
      { separator: true },
      { label: 'Sair da conta', icon: 'logout', danger: true, action: logout },
    ]);
  }

  function toggleTheme() {
    const next = PREFS.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    const drawer = $('#drawerRoot .drawer');
    const sw = drawer?.querySelector('[data-toggle="theme"]');
    if (sw) {
      sw.classList.toggle('on', next === 'dark');
      sw.setAttribute('aria-checked', String(next === 'dark'));
    }
  }

  async function logout() {
    const ok = await confirmDialog('Sair da conta', 'Você vai precisar entrar novamente com seu telefone.', 'Sair', true);
    if (!ok) return;
    try {
      await api('/api/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    state.token = '';
    store.removeItem(TOKEN_KEY);
    if (state.events) state.events.close();
    location.reload();
  }

  function openChatSearch() {
    $('#chatSearchBar').hidden = false;
    const input = $('#chatSearchInput');
    input.value = '';
    state.chatSearch = '';
    input.focus();
  }

  function closeChatSearch() {
    $('#chatSearchBar').hidden = true;
    $('#chatSearchCount').textContent = '';
    applyChatSearch('');
  }

  /* ------------------------------- emoji picker ------------------------------- */

  const EMOJIS = {
    'Carinhas': ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥳', '🤩', '🥺', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕'],
    'Gestos': ['👋', '🤚', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾', '✍️', '💅', '🤳', '👀', '🧠', '👶', '🧑', '👩', '👨', '🧓', '👮', '🕵️', '💃', '🕺', '👯', '🤷', '🤦'],
    'Corações': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '💌', '💋', '😻', '🥰', '😍', '♨️', '💯', '💢', '💥', '💫', '💦', '💨', '🔥', '✨', '⭐', '🌟', '🌈', '☀️', '🌙', '☁️', '⚡', '🌹', '🌻', '🌸', '🌼', '🌷', '🌺', '🌴', '🌵'],
    'Comida': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🥦', '🥕', '🌽', '🌶️', '🥒', '🧄', '🧅', '🍄', '🥜', '🍞', '🥐', '🥖', '🥨', '🧀', '🍳', '🥞', '🧇', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯', '🍝', '🍣', '🍤', '🍦', '🍰', '🎂', '🍫', '🍬', '🍭', '🍿', '☕', '🍵', '🧃', '🥤', '🍺', '🍷', '🥂', '🧊'],
    'Objetos': ['📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '💾', '💿', '📀', '🎧', '📷', '📹', '🎥', '📞', '☎️', '📠', '📺', '📻', '⏰', '⌚', '💡', '🔋', '🔌', '💰', '💳', '💎', '🔧', '🔨', '⚙️', '🧲', '🔫', '💉', '💊', '🩹', '🔑', '🔒', '🔓', '📦', '📫', '📮', '📝', '✏️', '🖊️', '📚', '📖', '📅', '📌', '📎', '✂️', '🎁', '🎉', '🎊', '🎈', '🎯', '🏆', '🥇', '⚽', '🏀', '🏈', '🎾', '🏐', '🎱', '🏓', '🥊', '🎮', '🎲', '🧩'],
    'Símbolos': ['✅', '❌', '❗', '❓', '‼️', '⁉️', '💤', '💬', '💭', '🗯️', '♻️', '🔱', '📶', '🔔', '🔕', '🎵', '🎶', '➡️', '⬅️', '⬆️', '⬇️', '🔄', '▶️', '⏸️', '⏹️', '⏪', '⏩', '🆗', '🆒', '🆕', '🔝', '🔙', '🔚', '🔛', '🔜', '©️', '®️', '™️', '💲', '➕', '➖', '➗', '✖️', '💯', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪'],
  };

  function buildEmojiPicker() {
    const picker = $('#emojiPicker');
    if (!picker || picker.dataset.built) return;
    picker.dataset.built = '1';
    picker.innerHTML = Object.entries(EMOJIS)
      .map(
        ([cat, list]) =>
          `<div class="emoji-cat">${escapeHTML(cat)}</div><div class="emoji-grid">${list
            .map((e) => `<button type="button" data-emoji="${e}" aria-label="${e}">${e}</button>`)
            .join('')}</div>`
      )
      .join('');
  }

  function toggleEmoji() {
    buildEmojiPicker();
    const picker = $('#emojiPicker');
    const willShow = picker.hidden;
    picker.hidden = !willShow;
    $('#attachMenu').hidden = true;
    if (willShow) picker.querySelector('button')?.focus();
  }

  function insertEmoji(emoji) {
    const input = $('#messageInput');
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    autosize();
    sendTyping();
  }

  function toggleAttach() {
    const menu = $('#attachMenu');
    const willShow = menu.hidden;
    menu.hidden = !willShow;
    $('#emojiPicker').hidden = true;
  }

  /* ------------------------------- start ------------------------------- */

  boot();
})();
