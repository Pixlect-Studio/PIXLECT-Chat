/* =====================================================================
   PIXLECT Chat — js/cloud.js
   Firebase Firestore bridge for live profiles, contacts, conversations
   and messages. The account itself comes from the PIXLECT Account
   portal on www.account.pixlect-studios.com; this file only talks to
   the PIXLECT Chat Firebase project.
   ===================================================================== */
(function () {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyAfToztTW7Tft_0NakVcir2vswRYR96XJ8",
    authDomain: "pixlect-chat.firebaseapp.com",
    projectId: "pixlect-chat",
    storageBucket: "pixlect-chat.firebasestorage.app",
    messagingSenderId: "814253134090",
    appId: "1:814253134090:web:42c3c537c961a037daeaf3",
    measurementId: "G-L7FQ42L7QV"
  };

  const SDK = "https://www.gstatic.com/firebasejs/13.4.0";
  const listeners = new Set();

  const state = {
    available: false,
    status: "connecting",
    detail: "",
    projectId: firebaseConfig.projectId
  };

  let appModule = null;
  let app = null;
  let db = null;
  let firestore = null;
  let unsubscribeRoom = null;

  function currentState() {
    return {
      available: state.available,
      status: state.status,
      detail: state.detail,
      projectId: state.projectId
    };
  }

  function emit() {
    const snapshot = currentState();
    listeners.forEach(function (fn) {
      try { fn(snapshot); } catch (err) {}
    });
  }

  function setStatus(status, detail) {
    if (state.status === status && state.detail === (detail || "")) return;
    state.status = status;
    state.detail = detail || "";
    emit();
  }

  function onStatus(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.add(fn);
    fn(currentState());
    return function () { listeners.delete(fn); };
  }

  function stampMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value === "number") return value;
    return 0;
  }

  function firestoreMessage(docSnap) {
    const data = docSnap.data() || {};
    return {
      id: docSnap.id,
      uid: String(data.uid || ""),
      name: String(data.name || "PIXLECT member"),
      emoji: String(data.emoji || "👤"),
      color: String(data.color || "#38bdf8"),
      text: String(data.text || ""),
      ts: Number(data.ts) || Date.now(),
      reactions: data.reactions && typeof data.reactions === "object" ? data.reactions : {}
    };
  }

  function messagePayload(message) {
    return {
      uid: message.uid,
      name: message.name,
      emoji: message.emoji,
      color: message.color,
      text: message.text,
      ts: message.ts,
      reactions: message.reactions || {}
    };
  }

  function profileFromDoc(docSnap) {
    const data = docSnap.data() || {};
    return {
      uid: String(data.uid || docSnap.id),
      name: String(data.username || data.name || "PIXLECT member"),
      emoji: String(data.emoji || "👤"),
      color: String(data.color || "#38bdf8"),
      lastSeen: stampMillis(data.lastSeen)
    };
  }

  async function connect() {
    try {
      const loaded = await Promise.all([
        import(SDK + "/firebase-app.js"),
        import(SDK + "/firebase-firestore.js")
      ]);
      appModule = loaded[0];
      firestore = loaded[1];
      app = appModule.initializeApp(firebaseConfig);
      db = firestore.initializeFirestore(app, {
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: false
      });
      state.available = true;
      state.status = "connecting";
      state.detail = "";
      emit();

      try {
        const analytics = await import(SDK + "/firebase-analytics.js");
        if (await analytics.isSupported()) analytics.getAnalytics(app);
      } catch (err) {
        /* Analytics is optional and frequently blocked. */
      }
      return true;
    } catch (error) {
      state.available = false;
      setStatus("offline", error && error.message ? error.message : "Firebase could not initialize");
      console.error("[pixlect-chat] Firebase failed to initialize", error);
      return false;
    }
  }

  function watchRoom(roomId, onMessages) {
    if (!state.available || !db || !firestore) return null;
    if (unsubscribeRoom) {
      try { unsubscribeRoom(); } catch (err) {}
      unsubscribeRoom = null;
    }

    const messagesRef = firestore.collection(db, "rooms", roomId, "messages");
    const liveQuery = firestore.query(
      messagesRef,
      firestore.orderBy("ts", "asc"),
      firestore.limit(300)
    );

    unsubscribeRoom = firestore.onSnapshot(liveQuery, function (snapshot) {
      const messages = snapshot.docs.map(firestoreMessage);
      setStatus("live", "");
      onMessages(messages, { fromCache: !!(snapshot.metadata && snapshot.metadata.fromCache) });
    }, function (error) {
      console.warn("[pixlect-chat] room listener failed", roomId, error);
      setStatus("offline", error && error.code ? error.code : "messages could not sync");
      onMessages(null, { error: error });
    });

    return function stopWatching() {
      if (unsubscribeRoom) {
        try { unsubscribeRoom(); } catch (err) {}
        unsubscribeRoom = null;
      }
    };
  }

  async function registerProfile(profile) {
    if (!state.available || !db || !firestore) throw new Error("Firebase is not connected");
    const ref = firestore.doc(db, "users", profile.uid);
    await firestore.setDoc(ref, {
      uid: profile.uid,
      username: profile.name,
      emoji: profile.emoji,
      color: profile.color,
      lastSeen: firestore.serverTimestamp()
    }, { merge: true });
    return true;
  }

  function watchProfiles(onProfiles) {
    if (!state.available || !db || !firestore) return function () {};
    const profilesRef = firestore.collection(db, "users");
    const profilesQuery = firestore.query(profilesRef, firestore.limit(200));
    return firestore.onSnapshot(profilesQuery, function (snapshot) {
      const people = snapshot.docs.map(profileFromDoc);
      people.sort(function (a, b) { return (b.lastSeen || 0) - (a.lastSeen || 0); });
      onProfiles(people);
    }, function (error) {
      console.warn("[pixlect-chat] contacts listener failed", error);
      onProfiles(null);
    });
  }

  function dmRoomId(firstUid, secondUid) {
    return "dm_" + [String(firstUid), String(secondUid)].sort().join("__");
  }

  async function ensureDm(meUid, otherUid) {
    if (!state.available || !db || !firestore) throw new Error("Firebase is not connected");
    const members = [String(meUid), String(otherUid)].sort();
    const id = dmRoomId(members[0], members[1]);
    const ref = firestore.doc(db, "rooms", id);
    const existing = await firestore.getDoc(ref);
    if (!existing.exists()) {
      await firestore.setDoc(ref, {
        type: "dm",
        members: members,
        createdAt: firestore.serverTimestamp(),
        updatedAt: firestore.serverTimestamp(),
        lastMessage: "",
        lastMessageAt: null
      });
    }
    return { id: id, members: members };
  }

  function watchDirectRooms(meUid, onRooms) {
    if (!state.available || !db || !firestore) return function () {};
    const roomsRef = firestore.collection(db, "rooms");
    const roomsQuery = firestore.query(roomsRef, firestore.where("members", "array-contains", String(meUid)));
    return firestore.onSnapshot(roomsQuery, function (snapshot) {
      const rooms = [];
      snapshot.docs.forEach(function (docSnap) {
        const data = docSnap.data() || {};
        if (data.type !== "dm") return;
        const members = Array.isArray(data.members) ? data.members.map(String) : [];
        const peerUid = members.find(function (uid) { return uid !== String(meUid); });
        if (!peerUid) return;
        rooms.push({
          id: docSnap.id,
          type: "dm",
          members: members,
          peerUid: peerUid,
          lastMessage: String(data.lastMessage || ""),
          lastMessageAt: stampMillis(data.lastMessageAt) || stampMillis(data.updatedAt)
        });
      });
      rooms.sort(function (a, b) { return (b.lastMessageAt || 0) - (a.lastMessageAt || 0); });
      onRooms(rooms);
    }, function (error) {
      console.warn("[pixlect-chat] conversation listener failed", error);
      onRooms(null);
    });
  }

  async function sendMessage(roomId, message, roomMeta) {
    if (!state.available || !db || !firestore) throw new Error("Firebase is not connected");
    const messageRef = firestore.doc(db, "rooms", roomId, "messages", message.id);
    const roomRef = firestore.doc(db, "rooms", roomId);
    const batch = firestore.writeBatch(db);
    batch.set(messageRef, messagePayload(message));
    batch.set(roomRef, {
      type: (roomMeta && roomMeta.type) || "channel",
      members: (roomMeta && roomMeta.members) || [],
      updatedAt: firestore.serverTimestamp(),
      lastMessage: String(message.text || "").slice(0, 160),
      lastMessageAt: message.ts
    }, { merge: true });
    await batch.commit();
    setStatus("live", "");
    return true;
  }

  async function toggleReaction(roomId, messageId, emoji, userId, add) {
    if (!state.available || !db || !firestore) throw new Error("Firebase is not connected");
    const ref = firestore.doc(db, "rooms", roomId, "messages", messageId);
    const update = {};
    update["reactions." + emoji] = add ? firestore.arrayUnion(userId) : firestore.arrayRemove(userId);
    await firestore.updateDoc(ref, update);
    return true;
  }

  const ready = connect();

  window.PixlectCloud = {
    config: firebaseConfig,
    state: currentState,
    ready: ready,
    onStatus: onStatus,
    registerProfile: registerProfile,
    watchProfiles: watchProfiles,
    dmRoomId: dmRoomId,
    ensureDm: ensureDm,
    watchDirectRooms: watchDirectRooms,
    watchRoom: watchRoom,
    sendMessage: sendMessage,
    toggleReaction: toggleReaction
  };
})();
