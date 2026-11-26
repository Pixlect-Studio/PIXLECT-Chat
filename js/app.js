/* =====================================================================
   PIXLECT Chat — js/app.js
   Renders the workspace shell, rooms, messages and composer, and ties
   the UI to the PIXLECT Sign In session. No framework, no build step.
   ===================================================================== */
(function () {
  'use strict';

  const store = window.PixlectChatStore;
  const $ = (selector, root) => (root || document).querySelector(selector);

  const QUICK_REACTIONS = ['👍', '🔥', '✨'];
  const EMOJIS = ['😀', '😂', '🥹', '😍', '😎', '🤔', '🙌', '👏', '👍', '🔥', '✨', '🚀', '🎉', '💜', '🩵', '👀', '✅', '💡', '📦', '🛠️', '🎨', '📈', '☕', '🌙'];
  const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

  const els = {};
  let me = null;
  let activeRoomId = store ? store.getActiveRoom() : 'general';
  let lastMessageId = null;
  let toastTimer = 0;
  let sending = false;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function safeColor(color, fallback) {
    const value = String(color || '');
    return /^#[0-9a-f]{3,8}$/i.test(value) ? value : (fallback || '#38bdf8');
  }

  function hexToRgba(hex, alpha) {
    const value = safeColor(hex).replace('#', '');
    const full = value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value.slice(0, 6);
    const int = parseInt(full, 16);
    const red = (int >> 16) & 255;
    const green = (int >> 8) & 255;
    const blue = int & 255;
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function icon(name, extraClass) {
    return `<svg class='icon${extraClass ? ' ' + extraClass : ''}' viewBox='0 0 24 24' aria-hidden='true' focusable='false'><use href='#icon-${name}'></use></svg>`;
  }

  function avatar(person, extraClass) {
    const color = safeColor(person.color, '#7c5cff');
    return `<span class='avatar${extraClass ? ' ' + extraClass : ''}' style='background:${hexToRgba(color, 0.16)};border-color:${hexToRgba(color, 0.38)};color:${color}'>${escapeHtml(person.emoji || '👤')}</span>`;
  }

  function normalizeMe(user) {
    return {
      uid: String(user.uid),
      name: String(user.username || 'PIXLECT member').slice(0, 32),
      emoji: (user.icon && user.icon.emoji) || '👤',
      color: safeColor(user.icon && user.icon.bg, '#8b6cff'),
      bot: false
    };
  }

  function formatTime(ts) {
    try {
      return timeFormatter.format(new Date(ts));
    } catch (_) {
      return '';
    }
  }

  function dayKey(ts) {
    const date = new Date(ts);
    return date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
  }

  function dayLabel(ts) {
    const date = new Date(ts);
    const now = new Date();
    const startOf = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const diff = Math.round((startOf(now) - startOf(date)) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    try {
      return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) {
      return date.toDateString();
    }
  }

  function isEmojiOnly(text) {
    const value = String(text || '').trim();
    if (!value || value.length > 12) return false;
    return !/[A-Za-z0-9]/.test(value);
  }

  function renderText(text) {
    const safe = escapeHtml(text);
    return safe
      .replace(/@([A-Za-z0-9_.-]{2,24})/g, `<span class='mention'>@$1</span>`)
      .replace(/(https?:\/\/[^\s<]+)/g, `<a href='$1' target='_blank' rel='noopener noreferrer'>$1</a>`);
  }

  function isAtBottom() {
    if (!els.messages) return true;
    return els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 120;
  }

  function scrollToBottom(smooth) {
    if (!els.messages) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.messages.scrollTo({
      top: els.messages.scrollHeight,
      behavior: smooth && !reduce ? 'smooth' : 'auto'
    });
  }

  function personStatus(person) {
    return person && person.lastSeen && Date.now() - person.lastSeen < 5 * 60 * 1000 ? 'online' : 'away';
  }

  function contactMarkup(person) {
    const status = personStatus(person);
    return `<button class='room room-contact' type='button' data-contact='${escapeHtml(person.uid)}' title='Message ${escapeHtml(person.name)}'>${avatar(person, 'avatar-sm')}<span class='room-name'>${escapeHtml(person.name)}</span><span class='presence ${status === 'away' ? 'is-away' : 'is-online'}' title='${status === 'away' ? 'Away' : 'Online'}'></span></button>`;
  }

  function roomMarkup(item) {
    const active = item.id === activeRoomId;
    const activeClass = active ? ' is-active' : '';
    const current = active ? " aria-current='page'" : '';
    const presence = item.status === 'away' ? 'is-away' : 'is-online';
    const presenceLabel = item.status === 'away' ? 'Away' : 'Online';
    if (item.type === 'dm') {
      return `<button class='room room-dm${activeClass}' type='button' data-room='${item.id}'${current}>${avatar(item, 'avatar-sm')}<span class='room-name'>${escapeHtml(item.name)}</span><span class='presence ${presence}' title='${presenceLabel}'></span></button>`;
    }
    return `<button class='room${activeClass}' type='button' data-room='${item.id}'${current}><span class='room-hash'>#</span><span class='room-name'>${escapeHtml(item.name)}</span></button>`;
  }

  function memberMarkup(person) {
    const isAway = personStatus(person) === 'away';
    const presence = isAway ? 'is-away' : 'is-online';
    const presenceLabel = isAway ? 'Away' : 'Online';
    const inner = `${avatar(person)}<span class='member-meta'><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.role || 'PIXLECT member')}</small></span><span class='presence ${presence}' title='${presenceLabel}'></span>`;
    return `<button class='member' type='button' data-dm-member='${person.uid}' title='Message ${escapeHtml(person.name)}'>${inner}</button>`;
  }

  function reactionsHtml(message) {
    const map = message.reactions || {};
    const entries = Object.keys(map).filter((emoji) => (map[emoji] || []).length);
    if (!entries.length) return '';
    const pills = entries.map((emoji) => {
      const users = map[emoji];
      const mine = me && users.indexOf(me.uid) !== -1;
      const label = users.length === 1 ? '1 reaction' : users.length + ' reactions';
      return `<button class='reaction${mine ? ' is-mine' : ''}' type='button' data-emoji='${emoji}' aria-pressed='${mine}' title='${label}'><span>${emoji}</span><b>${users.length}</b></button>`;
    }).join('');
    return `<div class='reactions'>${pills}</div>`;
  }

  function messageHtml(message, compact) {
    const color = safeColor(message.color, '#7c5cff');
    const time = formatTime(message.ts);
    const iso = new Date(message.ts).toISOString();
    const jumbo = isEmojiOnly(message.text) ? ' is-jumbo' : '';
    const actions = `<div class='msg-actions'>`
      + QUICK_REACTIONS.map((emoji) => `<button class='msg-action' type='button' data-emoji='${emoji}' title='React with ${emoji}' aria-label='React with ${emoji}'>${emoji}</button>`).join('')
      + `<button class='msg-action' type='button' data-copy='${escapeHtml(message.id)}' title='Copy message' aria-label='Copy message text'>${icon('copy')}</button>`
      + `</div>`;
    const avatarBlock = compact
      ? `<div class='msg-gutter'><time datetime='${iso}'>${time}</time></div>`
      : `<div class='msg-avatar' style='background:${hexToRgba(color, 0.16)};border-color:${hexToRgba(color, 0.4)};color:${color}'>${escapeHtml(message.emoji || '👤')}</div>`;
    const head = compact ? '' : `<div class='msg-head'><span class='msg-name' style='color:${color}'>${escapeHtml(message.name)}</span>${message.bot ? `<span class='bot-tag'>BOT</span>` : ''}<time class='msg-time' datetime='${iso}'>${time}</time></div>`;
    return `<article class='msg${compact ? ' is-compact' : ''}' data-id='${escapeHtml(message.id)}'>
      ${avatarBlock}
      <div class='msg-body'>${head}<div class='msg-text${jumbo}'>${renderText(message.text)}</div>${reactionsHtml(message)}</div>
      ${actions}
    </article>`;
  }

  function emptyRoomHtml(roomItem) {
    const isDm = roomItem.type === 'dm';
    const mark = isDm ? escapeHtml(roomItem.emoji) : '#';
    const title = isDm ? `Say hello to ${escapeHtml(roomItem.name)}` : `This is #${escapeHtml(roomItem.name)}`;
    const copy = isDm
      ? `This is the beginning of your conversation with ${escapeHtml(roomItem.name)}.`
      : escapeHtml(roomItem.topic || 'The start of something good.');
    return `<div class='empty-room'><div class='empty-mark'>${mark}</div><h3>${title}</h3><p>${copy}</p></div>`;
  }

  function renderSidebar() {
    if (!els.channelList) return;
    const term = (els.roomSearch.value || '').trim().toLowerCase();
    const matches = (item) => !term
      || item.name.toLowerCase().indexOf(term) !== -1
      || (item.topic || '').toLowerCase().indexOf(term) !== -1;
    const channels = store.channels.filter(matches);
    const dms = store.dms.filter(matches);
    const contacts = store.contacts.filter(matches);
    els.channelList.innerHTML = channels.length
      ? channels.map(roomMarkup).join('')
      : `<p class='room-empty'>No channels match that search.</p>`;
    els.dmList.innerHTML = dms.length
      ? dms.map(roomMarkup).join('')
      : `<p class='room-empty'>${term ? 'No conversations match that search.' : 'No conversations yet. Pick a contact to start one.'}</p>`;
    if (els.contactList) {
      els.contactList.innerHTML = contacts.length
        ? contacts.map(contactMarkup).join('')
        : `<p class='room-empty'>${term ? 'No contacts match that search.' : 'No contacts online yet. Invite a teammate to sign in with their PIXLECT Account.'}</p>`;
    }
    els.channelCount.textContent = String(store.channels.length);
    els.dmCount.textContent = String(store.dms.length);
    if (els.contactsCount) els.contactsCount.textContent = String(store.contacts.length);
  }

  function renderMembers() {
    if (!me || !els.memberList) {
      if (els.memberList) els.memberList.innerHTML = '';
      return;
    }
    const others = store.contacts;
    const online = others.filter((person) => personStatus(person) === 'online');
    const away = others.filter((person) => personStatus(person) !== 'online');
    const meRow = `<div class='member is-me'>${avatar(me)}<span class='member-meta'><strong>${escapeHtml(me.name)}</strong><small>You · PIXLECT Account</small></span><span class='presence is-online' title='Online'></span></div>`;
    let html = `<div class='member-group'><h4>Online — ${online.length + 1}</h4>${meRow}${online.map(memberMarkup).join('')}</div>`;
    if (away.length) {
      html += `<div class='member-group'><h4>Away — ${away.length}</h4>${away.map(memberMarkup).join('')}</div>`;
    }
    els.memberList.innerHTML = html;
    els.membersCount.textContent = String(online.length + 1 + away.length);
  }

  function renderMe() {
    if (!me) return;
    els.meAvatar.textContent = me.emoji;
    els.meAvatar.style.background = hexToRgba(me.color, 0.18);
    els.meAvatar.style.borderColor = hexToRgba(me.color, 0.42);
    els.meAvatar.style.color = me.color;
    els.meName.textContent = me.name;
    els.meStatus.textContent = 'PIXLECT Account';
  }

  function renderMessages(options) {
    const opts = options || {};
    if (!els.messages) return;
    const roomItem = store.room(activeRoomId);
    if (!roomItem) return;
    const previousTop = els.messages.scrollTop;
    const wasAtBottom = isAtBottom();
    const list = store.messages(activeRoomId);

    if (!list.length) {
      els.messages.innerHTML = emptyRoomHtml(roomItem);
      lastMessageId = null;
    } else {
      const parts = [];
      let previous = null;
      list.forEach((message) => {
        const day = dayKey(message.ts);
        if (!previous || previous.day !== day) {
          parts.push(`<div class='day-divider'><span>${escapeHtml(dayLabel(message.ts))}</span></div>`);
          previous = null;
        }
        const compact = !!previous && previous.uid === message.uid && message.ts - previous.ts < 300000;
        parts.push(messageHtml(message, compact));
        previous = { uid: message.uid, ts: message.ts, day: day };
      });
      els.messages.innerHTML = parts.join('');
      lastMessageId = list[list.length - 1].id;
    }

    els.jumpLatest.hidden = true;
    if (opts.forceScroll) {
      scrollToBottom();
    } else if (opts.preserve) {
      if (wasAtBottom) scrollToBottom();
      else els.messages.scrollTop = previousTop;
    } else if (wasAtBottom) {
      scrollToBottom();
    }
  }

  function updateRoomHeader(roomItem) {
    els.roomName.textContent = roomItem.name;
    els.roomIcon.textContent = roomItem.type === 'dm' ? roomItem.emoji : '#';
    els.roomIcon.classList.toggle('is-dm', roomItem.type === 'dm');
    els.roomIcon.style.background = roomItem.type === 'dm' ? hexToRgba(roomItem.color, 0.16) : '';
    els.roomIcon.style.color = roomItem.type === 'dm' ? roomItem.color : '';
    els.roomTopic.textContent = roomItem.type === 'dm'
      ? 'Direct message'
      : roomItem.topic || '';
    els.input.placeholder = roomItem.type === 'dm'
      ? `Message ${roomItem.name}`
      : `Message #${roomItem.name}`;
    document.title = `${roomItem.type === 'dm' ? '@' : '#'}${roomItem.name} · PIXLECT Chat`;
  }

  function openRoom(roomId, options) {
    const opts = options || {};
    const roomItem = store.room(roomId) || store.room('general');
    if (!roomItem) return;
    const changed = roomItem.id !== activeRoomId;
    activeRoomId = roomItem.id;
    store.setActiveRoom(activeRoomId);
    updateRoomHeader(roomItem);
    renderSidebar();
    renderMessages({ forceScroll: changed || opts.forceScroll });
    if (window.matchMedia('(max-width: 900px)').matches) {
      els.app.classList.remove('sidebar-open');
      els.app.classList.remove('members-open');
    }
  }

  function resizeInput() {
    if (!els.input) return;
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 168) + 'px';
  }

  function updateSendState() {
    if (!els.sendBtn) return;
    els.sendBtn.disabled = !me || sending || !els.input.value.trim();
  }

  async function submitMessage() {
    if (!me || sending) return;
    const text = els.input.value.trim();
    if (!text) return;
    if (!store.isReady()) {
      showToast('Still connecting to PIXLECT Chat sync. Try again in a moment.');
      return;
    }
    sending = true;
    els.input.value = '';
    resizeInput();
    updateSendState();
    els.emojiPop.hidden = true;
    els.emojiBtn.setAttribute('aria-expanded', 'false');
    try {
      await store.addMessage(activeRoomId, me, text);
    } catch (error) {
      els.input.value = text;
      resizeInput();
      showToast('Message not sent: ' + (error && error.message ? error.message : 'sync error'));
    } finally {
      sending = false;
      updateSendState();
      els.input.focus();
    }
  }

  function showToast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => els.toast.classList.remove('is-visible'), 2200);
  }

  function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (_) {
      copied = false;
    }
    textarea.remove();
    showToast(copied ? 'Message copied' : 'Copy is blocked in this browser');
  }

  function copyMessage(messageId) {
    const message = store.messages(activeRoomId).find((item) => item.id === messageId);
    if (!message) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(message.text)
        .then(() => showToast('Message copied'))
        .catch(() => fallbackCopy(message.text));
      return;
    }
    fallbackCopy(message.text);
  }

  function insertAtCursor(input, text) {
    const start = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const position = start + text.length;
    input.setSelectionRange(position, position);
    resizeInput();
  }

  function buildEmojiPicker() {
    if (!els.emojiPop) return;
    els.emojiPop.innerHTML = EMOJIS.map((emoji) => `<button class='emoji-choice' type='button' data-emoji-insert='${emoji}' aria-label='Insert ${emoji}'>${emoji}</button>`).join('');
  }

  function setGateHint(message, warn) {
    if (!els.gateHint) return;
    els.gateHint.textContent = message;
    els.gateHint.classList.toggle('is-warn', !!warn);
  }

  function setSyncStatus(info) {
    if (!els.syncChip) return;
    const available = !!(info && info.available);
    const status = available ? (info.status || 'connecting') : 'offline';
    const label = status === 'live' ? 'Live' : status === 'offline' ? 'Offline' : 'Connecting';
    els.syncChip.dataset.state = status;
    els.syncChip.title = status === 'live'
      ? 'Messages sync live with PIXLECT Chat on Firebase'
      : status === 'offline'
        ? 'Real-time sync is offline. Check your connection or Firestore access.'
        : 'Connecting to PIXLECT Chat sync';
    if (els.syncLabel) els.syncLabel.textContent = label;
  }

  function initCloudStatus() {
    if (!window.PixlectCloud) {
      setSyncStatus(null);
      return;
    }
    if (typeof window.PixlectCloud.onStatus === 'function') {
      window.PixlectCloud.onStatus(setSyncStatus);
    }
    if (typeof window.PixlectCloud.state === 'function') {
      setSyncStatus(window.PixlectCloud.state());
    }
  }

  function applyReadyState(authorized) {
    if (authorized) {
      setGateHint('Continue with Google or an email link on www.account.pixlect-studios.com · no password stored here.', false);
    } else {
      setGateHint('PIXLECT sign-in is not authorized for this address. Serve the app from localhost:8000 or a registered PIXLECT origin.', true);
    }
  }

  function handleAuth(user) {
    me = user ? normalizeMe(user) : null;
    if (me) {
      document.documentElement.dataset.auth = 'in';
      els.authGate.hidden = true;
      els.app.hidden = false;
      store.setMe(me);
      renderMe();
      renderMembers();
      renderSidebar();
      openRoom(activeRoomId, { forceScroll: true });
      updateSendState();
    } else {
      document.documentElement.dataset.auth = 'out';
      els.authGate.hidden = false;
      els.app.hidden = true;
      store.setMe(null);
      activeRoomId = 'general';
      store.setActiveRoom('general');
      els.input.value = '';
      els.userMenu.hidden = true;
      updateSendState();
    }
  }

  function initAuth() {
    if (!window.PixlectAuth) {
      els.authGate.hidden = false;
      setGateHint('PIXLECT Sign In did not load. Check that js/login.js is present.', true);
      return;
    }
    window.PixlectAuth.onChange(handleAuth);
    if (!window.PixlectAuth.user) handleAuth(null);
    if (window.PixlectAuth.discoveryAttempted) applyReadyState(window.PixlectAuth.authorized);
    window.addEventListener('pixlect:ready', (event) => {
      applyReadyState(!!(event.detail && event.detail.authorized));
    });
    window.addEventListener('pixlect:auth-error', (event) => {
      if (event.detail && event.detail.message) setGateHint(event.detail.message, true);
    });
    window.addEventListener('pixlect:auth-popup-opened', () => {
      if (window.PixlectAuth.user) return;
      setGateHint('Finish in the PIXLECT window. Using an email link? Keep that window open until you click the link.', false);
    });
    window.addEventListener('pixlect:auth-popup-closed', () => {
      if (window.PixlectAuth.user) return;
      setGateHint('If you signed in by email, click Sign in with PIXLECT Account again to finish. Keep the window open until the link opens.', false);
    });
  }

  function closeMobilePanels() {
    els.app.classList.remove('sidebar-open');
    if (window.matchMedia('(max-width: 1180px)').matches) {
      els.app.classList.remove('members-open');
      els.toggleMembers.setAttribute('aria-expanded', 'false');
    }
  }

  function cacheElements() {
    els.app = $('#app');
    els.authGate = $('#authGate');
    els.gateHint = $('#gateHint');
    els.sidebarScroll = $('#sidebarScroll');
    els.channelList = $('#channelList');
    els.dmList = $('#dmList');
    els.contactList = $('#contactList');
    els.roomSearch = $('#roomSearch');
    els.channelCount = $('#channelCount');
    els.dmCount = $('#dmCount');
    els.contactsCount = $('#contactsCount');
    els.membersCount = $('#membersCount');
    els.openSidebar = $('#openSidebar');
    els.closeSidebar = $('#closeSidebar');
    els.scrim = $('#scrim');
    els.syncChip = $('#syncChip');
    els.syncLabel = $('#syncLabel');
    els.userCard = $('#userCard');
    els.userMenu = $('#userMenu');
    els.signOutBtn = $('#signOutBtn');
    els.meAvatar = $('#meAvatar');
    els.meName = $('#meName');
    els.meStatus = $('#meStatus');
    els.roomIcon = $('#roomIcon');
    els.roomName = $('#roomName');
    els.roomTopic = $('#roomTopic');
    els.toggleMembers = $('#toggleMembers');
    els.messages = $('#messages');
    els.jumpLatest = $('#jumpLatest');
    els.composer = $('#composer');
    els.input = $('#messageInput');
    els.sendBtn = $('#sendBtn');
    els.emojiBtn = $('#emojiBtn');
    els.emojiPop = $('#emojiPop');
    els.memberList = $('#memberList');
    els.closeMembers = $('#closeMembers');
    els.toast = $('#toast');
  }

  function bindEvents() {
    els.sidebarScroll.addEventListener('click', (event) => {
      const target = event.target.closest('[data-room]');
      if (target) openRoom(target.dataset.room);
    });

    els.roomSearch.addEventListener('input', renderSidebar);

    els.openSidebar.addEventListener('click', () => {
      els.app.classList.add('sidebar-open');
      els.app.classList.remove('members-open');
      els.toggleMembers.setAttribute('aria-expanded', 'false');
    });
    els.closeSidebar.addEventListener('click', closeMobilePanels);
    els.scrim.addEventListener('click', closeMobilePanels);

    els.toggleMembers.addEventListener('click', () => {
      const open = !els.app.classList.contains('members-open');
      els.app.classList.toggle('members-open', open);
      els.toggleMembers.setAttribute('aria-expanded', String(open));
      if (open) els.app.classList.remove('sidebar-open');
    });
    els.closeMembers.addEventListener('click', closeMobilePanels);

    els.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      submitMessage();
    });

    els.input.addEventListener('input', () => {
      resizeInput();
      updateSendState();
    });

    els.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submitMessage();
      }
    });

    els.messages.addEventListener('click', (event) => {
      const reaction = event.target.closest('[data-emoji]');
      if (reaction) {
        const article = reaction.closest('.msg');
        if (article && me) {
          store.toggleReaction(activeRoomId, article.dataset.id, reaction.dataset.emoji, me.uid)
            .catch((error) => showToast('Reaction not saved: ' + (error && error.message ? error.message : 'sync error')));
        }
        return;
      }
      const copy = event.target.closest('[data-copy]');
      if (copy) copyMessage(copy.dataset.copy);
    });

    els.messages.addEventListener('scroll', () => {
      if (isAtBottom()) els.jumpLatest.hidden = true;
    });

    els.jumpLatest.addEventListener('click', () => {
      scrollToBottom(true);
      els.jumpLatest.hidden = true;
    });

    els.emojiBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = els.emojiPop.hidden;
      els.emojiPop.hidden = !open;
      els.emojiBtn.setAttribute('aria-expanded', String(open));
    });

    els.emojiPop.addEventListener('click', (event) => {
      event.stopPropagation();
      const choice = event.target.closest('[data-emoji-insert]');
      if (!choice) return;
      insertAtCursor(els.input, choice.dataset.emojiInsert);
      updateSendState();
      els.emojiPop.hidden = true;
      els.emojiBtn.setAttribute('aria-expanded', 'false');
      els.input.focus();
    });

    els.userCard.addEventListener('click', (event) => {
      event.stopPropagation();
      els.userMenu.hidden = !els.userMenu.hidden;
    });

    els.signOutBtn.addEventListener('click', () => {
      els.userMenu.hidden = true;
      if (window.PixlectAuth) window.PixlectAuth.logout();
    });

    els.memberList.addEventListener('click', (event) => {
      const target = event.target.closest('[data-dm-member]');
      if (!target) return;
      const uid = target.dataset.dmMember;
      const dm = store.dms.find((item) => item.uid === uid);
      if (dm) {
        openRoom(dm.id);
        return;
      }
      const contact = store.contacts.find((person) => person.uid === uid);
      const roomId = contact ? store.startDm(contact) : null;
      if (roomId) openRoom(roomId);
    });

    if (els.contactList) {
      els.contactList.addEventListener('click', (event) => {
        const target = event.target.closest('[data-contact]');
        if (!target) return;
        const contact = store.contacts.find((person) => person.uid === target.dataset.contact);
        if (!contact) return;
        const existing = store.dms.find((item) => item.uid === contact.uid);
        const roomId = existing ? existing.id : store.startDm(contact);
        if (roomId) openRoom(roomId);
      });
    }

    document.addEventListener('click', (event) => {
      if (!els.emojiPop.hidden && !event.target.closest('#emojiPop') && !event.target.closest('#emojiBtn')) {
        els.emojiPop.hidden = true;
        els.emojiBtn.setAttribute('aria-expanded', 'false');
      }
      if (!els.userMenu.hidden && !event.target.closest('#userCard') && !event.target.closest('#userMenu')) {
        els.userMenu.hidden = true;
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        els.emojiPop.hidden = true;
        els.emojiBtn.setAttribute('aria-expanded', 'false');
        els.userMenu.hidden = true;
        closeMobilePanels();
        return;
      }
      const active = document.activeElement;
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
      if (!typing && (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))) {
        event.preventDefault();
        els.roomSearch.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (window.matchMedia('(min-width: 1181px)').matches) {
        els.app.classList.remove('sidebar-open');
      }
    });

    store.subscribe(() => {
      if (!me) return;
      const roomItem = store.room(activeRoomId);
      if (roomItem) updateRoomHeader(roomItem);
      renderSidebar();
      renderMembers();
      const beforeId = lastMessageId;
      const wasAtBottom = isAtBottom();
      renderMessages({ preserve: true });
      if (lastMessageId !== beforeId && !wasAtBottom) els.jumpLatest.hidden = false;
    });
  }

  function init() {
    if (!store) {
      document.documentElement.dataset.auth = 'out';
      const hint = document.getElementById('gateHint');
      if (hint) {
        hint.textContent = 'The chat store did not load. Check that js/store.js is present.';
        hint.classList.add('is-warn');
      }
      return;
    }
    if (!window.PixlectAuth) {
      document.documentElement.dataset.auth = 'out';
      const hint = document.getElementById('gateHint');
      if (hint) {
        hint.textContent = 'PIXLECT Sign In did not load. Check that js/login.js is present.';
        hint.classList.add('is-warn');
      }
      return;
    }
    cacheElements();
    buildEmojiPicker();
    renderSidebar();
    renderMembers();
    updateSendState();
    bindEvents();
    initCloudStatus();
    if (window.matchMedia('(min-width: 1181px)').matches) {
      els.app.classList.add('members-open');
      els.toggleMembers.setAttribute('aria-expanded', 'true');
    }
    initAuth();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();