/* =====================================================================
   PIXLECT Chat — js/store.js
   Real-time chat data. Firestore is the source of truth; localStorage
   only keeps a short render cache so reopening a room is instant.
   Contacts and direct-message rooms come from the PIXLECT Chat project.
   ===================================================================== */
(function () {
  'use strict';

  const CHANNELS = [
    { id: 'general', name: 'general', topic: 'Studio-wide announcements and hellos', type: 'channel' }
  ];

  const KEYS = {
    ui: 'pixlectchat:ui:v1'
  };

  const listeners = new Set();
  const cloud = window.PixlectCloud || null;

  let me = null;
  let ready = false;
  let contacts = [];
  let dmRooms = [];
  let dms = [];
  let unwatchRoom = null;
  let unwatchProfiles = null;
  let unwatchDms = null;
  let heartbeatTimer = null;
  const pendingDmPeers = new Set();
  let activeRoom = readActiveRoom();

  function createId() {
    const random = Math.random().toString(36).slice(2, 8);
    return 'm_' + Date.now().toString(36) + random;
  }

  const state = { rooms: {} };

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(); } catch (err) {}
    });
  }

  function readUi() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEYS.ui) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function readActiveRoom() {
    const ui = readUi();
    const stored = typeof ui.room === 'string' ? ui.room : 'general';
    if (stored.indexOf('dm_') === 0) return stored;
    return CHANNELS.some(function (item) { return item.id === stored; }) ? stored : 'general';
  }

  function presenceOf(person) {
    if (!person || !person.lastSeen) return 'away';
    return Date.now() - person.lastSeen < 5 * 60 * 1000 ? 'online' : 'away';
  }

  function profileFor(uid) {
    return contacts.find(function (person) { return person.uid === uid; }) || null;
  }

  function buildDm(room) {
    const peer = profileFor(room.peerUid);
    return {
      id: room.id,
      type: 'dm',
      name: peer ? peer.name : 'PIXLECT member',
      emoji: peer ? peer.emoji : '👤',
      color: peer ? peer.color : '#38bdf8',
      uid: room.peerUid,
      peerUid: room.peerUid,
      members: room.members,
      status: presenceOf(peer),
      lastMessage: room.lastMessage || '',
      lastMessageAt: room.lastMessageAt || 0
    };
  }

  function rebuildDms() {
    dms = dmRooms.map(buildDm);
    dms.sort(function (a, b) { return (b.lastMessageAt || 0) - (a.lastMessageAt || 0); });
  }

  function stopPersonalWatches() {
    if (unwatchProfiles) { try { unwatchProfiles(); } catch (err) {} unwatchProfiles = null; }
    if (unwatchDms) { try { unwatchDms(); } catch (err) {} unwatchDms = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  }

  function watchRoom(roomId) {
    if (!ready || !cloud) return;
    if (unwatchRoom) {
      try { unwatchRoom(); } catch (err) {}
      unwatchRoom = null;
    }
    unwatchRoom = cloud.watchRoom(roomId, function (messages) {
      if (!messages) return;
      state.rooms[roomId] = messages;
      if (roomId === activeRoom) notify();
    });
  }

  function flushPendingDms() {
    if (!me || !ready) return;
    pendingDmPeers.forEach(function (peerUid) {
      cloud.ensureDm(me.uid, peerUid).catch(function (error) {
        console.warn('[pixlect-chat] could not open conversation', peerUid, error);
      });
    });
    pendingDmPeers.clear();
  }

  function startPersonalWatches() {
    if (!cloud || !me || !ready) return;
    stopPersonalWatches();
    cloud.registerProfile(me).catch(function (error) {
      console.warn('[pixlect-chat] could not publish profile', error);
    });
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(function () {
      if (document.visibilityState === 'visible') {
        cloud.registerProfile(me).catch(function () {});
      }
    }, 120000);
    unwatchProfiles = cloud.watchProfiles(function (people) {
      if (!people) return;
      contacts = people.filter(function (person) { return person.uid !== me.uid; });
      rebuildDms();
      notify();
    });
    unwatchDms = cloud.watchDirectRooms(me.uid, function (rooms) {
      if (!rooms) return;
      dmRooms = rooms;
      rebuildDms();
      notify();
    });
    flushPendingDms();
  }

  function setMe(user) {
    me = user ? {
      uid: String(user.uid),
      name: String(user.name || user.username || 'PIXLECT member').slice(0, 32),
      emoji: String(user.emoji || '👤'),
      color: String(user.color || '#8b6cff'),
      lastSeen: Date.now()
    } : null;
    stopPersonalWatches();
    if (!me) {
      contacts = [];
      dmRooms = [];
      dms = [];
      notify();
      return;
    }
    startPersonalWatches();
    notify();
  }

  function room(roomId) {
    const channel = CHANNELS.find(function (item) { return item.id === roomId; });
    if (channel) return channel;
    const dm = dms.find(function (item) { return item.id === roomId; });
    if (dm) return dm;
    if (String(roomId).indexOf('dm_') === 0 && me) {
      const parts = String(roomId).slice(3).split('__');
      if (parts.length === 2) {
        const peerUid = parts[0] === me.uid ? parts[1] : parts[0];
        return buildDm({ id: roomId, peerUid: peerUid, members: parts, lastMessage: '', lastMessageAt: 0 });
      }
    }
    return null;
  }

  function rooms() {
    return CHANNELS.concat(dms);
  }

  function messages(roomId) {
    const list = state.rooms[roomId];
    return Array.isArray(list) ? list.slice() : [];
  }

  async function addMessage(roomId, author, text) {
    if (!cloud || !ready) throw new Error('Still connecting to PIXLECT Chat sync');
    const target = room(roomId);
    const message = {
      id: createId(),
      uid: author.uid,
      name: author.name,
      emoji: author.emoji,
      color: author.color,
      text: text,
      ts: Date.now(),
      reactions: {}
    };
    await cloud.sendMessage(roomId, message, {
      type: target ? target.type : 'channel',
      members: target && target.members ? target.members : []
    });
    return message;
  }

  async function toggleReaction(roomId, messageId, emoji, userId) {
    if (!cloud || !ready) throw new Error('Still connecting to PIXLECT Chat sync');
    const list = state.rooms[roomId];
    if (!Array.isArray(list)) return null;
    const message = list.find(function (item) { return item.id === messageId; });
    if (!message) return null;
    const users = (message.reactions && message.reactions[emoji]) || [];
    const add = users.indexOf(userId) === -1;
    await cloud.toggleReaction(roomId, messageId, emoji, userId, add);
    return message;
  }

  function startDm(contact) {
    if (!cloud || !me || !contact) return null;
    const peerUid = String(contact.uid);
    const id = cloud.dmRoomId(me.uid, peerUid);
    if (!dmRooms.some(function (item) { return item.id === id; })) {
      dmRooms = dmRooms.concat([{
        id: id,
        type: 'dm',
        members: [me.uid, peerUid].sort(),
        peerUid: peerUid,
        lastMessage: '',
        lastMessageAt: 0
      }]);
      rebuildDms();
    }
    if (ready) {
      cloud.ensureDm(me.uid, peerUid).catch(function (error) {
        console.warn('[pixlect-chat] could not create conversation', error);
      });
    } else {
      pendingDmPeers.add(peerUid);
    }
    notify();
    return id;
  }

  function getActiveRoom() {
    return activeRoom;
  }

  function setActiveRoom(roomId) {
    const changed = roomId !== activeRoom;
    activeRoom = roomId;
    const ui = readUi();
    ui.room = roomId;
    try { localStorage.setItem(KEYS.ui, JSON.stringify(ui)); } catch (err) {}
    if (changed || !unwatchRoom) watchRoom(roomId);
  }

  function subscribe(fn) {
    listeners.add(fn);
    return function () { listeners.delete(fn); };
  }

  function status() {
    if (cloud) return cloud.state();
    return { available: false, status: 'offline', detail: 'Firebase bridge did not load' };
  }

  function isReady() {
    return ready;
  }

  window.PixlectChatStore = {
    channels: CHANNELS,
    get dms() { return dms; },
    get contacts() { return contacts; },
    rooms: rooms,
    room: room,
    messages: messages,
    addMessage: addMessage,
    toggleReaction: toggleReaction,
    startDm: startDm,
    setMe: setMe,
    getActiveRoom: getActiveRoom,
    setActiveRoom: setActiveRoom,
    subscribe: subscribe,
    status: status,
    isReady: isReady
  };

  if (cloud) {
    cloud.onStatus(function () { notify(); });
    cloud.ready.then(function (ok) {
      ready = !!ok && cloud.state().available;
      if (!ready) { notify(); return; }
      watchRoom(activeRoom);
      if (me) startPersonalWatches();
      notify();
    });
  } else {
    notify();
  }
})();
