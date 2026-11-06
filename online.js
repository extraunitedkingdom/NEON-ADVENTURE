/* NEON ADVENTURE ONLINE — Room system phase 1
 * Firebase Web SDK CDN / Spark plan only.
 * Client-side room capacity is best-effort; do not treat it as cheat-proof.
 */
(() => {
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyArd_QTG7sNmdbTvfpyyc2XvxG0lJB_T6c",
    authDomain: "neon-adventure-online.firebaseapp.com",
    databaseURL: "https://neon-adventure-online-default-rtdb.firebaseio.com",
    projectId: "neon-adventure-online",
    storageBucket: "neon-adventure-online.firebasestorage.app",
    messagingSenderId: "712573357034",
    appId: "1:712573357034:web:627b225400f28952e9c093"
  };

  const SDK_VERSION = "13.2.0";
  const MAX_PLAYERS = 16;
  let state = {
    ready: true, connected: false, authenticated: false, connecting: false,
    networkStarted: false, uid: null, reason: "接続テストの準備ができています。"
  };
  let modules = null, app = null, auth = null, database = null;
  let connectedUnsubscribe = null, roomUnsubscribe = null, currentRoom = null;
  let roomBusy = false;

  function el(id) { return document.getElementById(id); }
  function setMessage(message) {
    state.reason = message;
    const status = el("onlineStatusText");
    if (status) status.textContent = message;
  }
  function updateUI(message) {
    const status = el("onlineStatusText");
    const button = el("onlineConnectTest");
    if (status) status.textContent = message || state.reason;
    if (button) {
      button.disabled = state.connecting;
      button.textContent = state.connecting ? "接続中..." :
        (state.connected && state.authenticated ? "接続確認済み" : "接続テスト");
    }
    renderCurrentRoom();
  }
  async function loadFirebase() {
    if (modules) return modules;
    const base = "https://www.gstatic.com/firebasejs/" + SDK_VERSION + "/";
    const [appSdk, authSdk, dbSdk] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-database.js")
    ]);
    modules = { ...appSdk, ...authSdk, ...dbSdk };
    app = modules.initializeApp(firebaseConfig);
    auth = modules.getAuth(app);
    database = modules.getDatabase(app);
    return modules;
  }
  async function connect() {
    if (state.connecting) return { ok: false, reason: "接続処理中です。" };
    if (state.connected && state.authenticated) return { ok: true, ...state };
    state.connecting = true;
    state.networkStarted = true;
    state.reason = "Firebase SDKを読み込んでいます...";
    updateUI(state.reason);
    try {
      const sdk = await loadFirebase();
      state.reason = "匿名認証を確認しています...";
      updateUI(state.reason);
      const credential = auth.currentUser ? { user: auth.currentUser } : await sdk.signInAnonymously(auth);
      state.authenticated = true;
      state.uid = credential.user.uid;
      state.reason = "Realtime Databaseへの接続を確認しています...";
      updateUI(state.reason);
      if (connectedUnsubscribe) connectedUnsubscribe();
      await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) { settled = true; reject(new Error("接続確認がタイムアウトしました。")); }
        }, 12000);
        connectedUnsubscribe = sdk.onValue(sdk.ref(database, ".info/connected"), snapshot => {
          const isConnected = snapshot.val() === true;
          state.connected = isConnected;
          if (isConnected && !settled) { settled = true; clearTimeout(timeout); resolve(); }
          if (!isConnected) { state.reason = "Firebaseとの接続が切れています。"; updateUI(state.reason); }
          else { state.reason = "Firebase接続・匿名認証を確認しました。"; updateUI(state.reason); }
        }, error => {
          if (!settled) { settled = true; clearTimeout(timeout); reject(error); }
        });
      });
      state.reason = "Firebase接続・匿名認証を確認しました。ルーム機能を利用できます。";
      return { ok: true, ...state };
    } catch (error) {
      state.connected = false;
      state.reason = "接続できませんでした: " + (error?.message || String(error));
      return { ok: false, ...state };
    } finally {
      state.connecting = false;
      updateUI(state.reason);
    }
  }
  function requireConnection() {
    if (!state.connected || !state.authenticated || !database || !modules) {
      throw new Error("先に「接続テスト」を行ってください。");
    }
  }
  function cleanName(value) {
    const name = String(value || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 16);
    return name || "PLAYER";
  }
  function getPlayerInfo() {
    return {
      uid: state.uid,
      name: cleanName(el("playerNameInput")?.value),
      character: "boy",
      joinedAt: modules.serverTimestamp ? modules.serverTimestamp() : Date.now(),
      online: true
    };
  }
  function makeRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(8);
    if (window.crypto?.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => chars[b % chars.length]).join("");
  }
  function renderRoomList(rooms) {
    const list = el("onlineRoomList");
    if (!list) return;
    list.textContent = "";
    if (!rooms.length) {
      const empty = document.createElement("p");
      empty.className = "online-note";
      empty.textContent = "公開ルームはまだありません。";
      list.appendChild(empty);
      return;
    }
    rooms.forEach(room => {
      const row = document.createElement("div");
      row.className = "online-room-row";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = room.name || "PLAYER ROOM";
      const detail = document.createElement("small");
      detail.textContent = (room.players || 0) + "/" + MAX_PLAYERS + " 人 ・ 公開ルーム";
      info.append(title, detail);
      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "参加";
      join.disabled = !!currentRoom || room.players >= MAX_PLAYERS;
      join.addEventListener("click", () => joinRoom(room.id).catch(showError));
      row.append(info, join);
      list.appendChild(row);
    });
  }
  async function refreshRooms() {
    requireConnection();
    const snapshot = await modules.get(modules.ref(database, "publicRooms"));
    const index = snapshot.val() || {};
    const rooms = [];
    for (const [id, entry] of Object.entries(index)) {
      try {
        const roomSnap = await modules.get(modules.ref(database, "rooms/" + id));
        const data = roomSnap.val();
        if (!data || !data.meta || data.meta.visibility !== "public") continue;
        const count = data.players ? Object.keys(data.players).length : 0;
        if (count < MAX_PLAYERS) rooms.push({ id, name: entry.name || data.meta.name || "PLAYER ROOM", players: count });
      } catch (_) {}
    }
    renderRoomList(rooms);
    return rooms;
  }
  function watchCurrentRoom(roomId) {
    if (roomUnsubscribe) roomUnsubscribe();
    roomUnsubscribe = modules.onValue(modules.ref(database, "rooms/" + roomId), snapshot => {
      const data = snapshot.val();
      if (!data) {
        currentRoom = null;
        if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
        setMessage("ルームが閉じられました。");
        renderCurrentRoom();
        refreshRooms().catch(() => {});
        return;
      }
      currentRoom = { id: roomId, meta: data.meta || {}, players: data.players || {} };
      renderCurrentRoom();
    }, error => showError(error));
  }
  function renderCurrentRoom() {
    const panel = el("onlineCurrentRoom");
    const details = el("onlineCurrentRoomDetails");
    const leave = el("onlineLeaveRoom");
    if (!panel) return;
    panel.style.display = currentRoom ? "block" : "none";
    if (leave) leave.style.display = currentRoom ? "inline-block" : "none";
    if (details && currentRoom) {
      const players = Object.values(currentRoom.players || {});
      details.textContent = (currentRoom.meta.name || "PLAYER ROOM") + " / " +
        players.length + "/" + MAX_PLAYERS + "人\n参加者: " +
        players.map(p => cleanName(p.name)).join("、");
    }
  }
  async function createRoom(visibility) {
    requireConnection();
    if (roomBusy) throw new Error("ルーム処理中です。");
    if (currentRoom) throw new Error("すでにルームに参加しています。");
    roomBusy = true;
    try {
      const code = makeRoomCode();
      const roomRef = modules.ref(database, "rooms/" + code);
      const playerRef = modules.ref(database, "rooms/" + code + "/players/" + state.uid);
      const name = cleanName(el("onlineRoomName")?.value || getPlayerInfo().name + "のルーム").slice(0, 20);
      const room = {
        meta: { name, visibility, ownerUid: state.uid, createdAt: Date.now(), maxPlayers: MAX_PLAYERS },
        players: { [state.uid]: getPlayerInfo() }
      };
      await modules.onDisconnect(playerRef).remove();
      const writes = { ["rooms/" + code]: room };
      if (visibility === "public") {
        writes["publicRooms/" + code] = { name, ownerUid: state.uid, createdAt: Date.now() };
      }
      await modules.update(modules.ref(database), writes);
      currentRoom = { id: code, meta: room.meta, players: room.players };
      watchCurrentRoom(code);
      setMessage(visibility === "public" ?
        "公開ルームを作成しました。" : "プライベートルームを作成しました。参加コード: " + code);
      const codeOut = el("onlineRoomCode");
      if (codeOut) codeOut.textContent = code;
      await refreshRooms().catch(() => {});
      return { ok: true, code };
    } finally { roomBusy = false; renderCurrentRoom(); }
  }
  async function joinRoom(code) {
    requireConnection();
    if (roomBusy) throw new Error("ルーム処理中です。");
    if (currentRoom) throw new Error("先に現在のルームから退出してください。");
    const roomCode = String(code || "").trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{8}$/.test(roomCode)) throw new Error("参加コードは8文字で入力してください。");
    roomBusy = true;
    try {
      const roomRef = modules.ref(database, "rooms/" + roomCode);
      const playerRef = modules.ref(database, "rooms/" + roomCode + "/players/" + state.uid);
      let data = null;
      let canReadBeforeJoin = true;
      try {
        const snapshot = await modules.get(roomRef);
        data = snapshot.val();
      } catch (_) {
        canReadBeforeJoin = false;
      }
      if (canReadBeforeJoin && (!data || !data.meta)) throw new Error("ルームが見つかりません。");
      if (data?.players?.[state.uid]) throw new Error("すでに参加しています。");
      if (canReadBeforeJoin && Object.keys(data.players || {}).length >= MAX_PLAYERS) throw new Error("このルームは満員です。");
      await modules.onDisconnect(playerRef).remove();
      await modules.set(playerRef, getPlayerInfo());
      if (!data) {
        const joinedSnapshot = await modules.get(roomRef);
        data = joinedSnapshot.val();
      }
      if (!data || !data.meta) {
        await modules.onDisconnect(playerRef).cancel();
        await modules.remove(playerRef);
        throw new Error("ルームが見つからないか、参加コードが違います。");
      }
      const players = data.players || {};
      if (Object.keys(players).length > MAX_PLAYERS) {
        await modules.onDisconnect(playerRef).cancel();
        await modules.remove(playerRef);
        throw new Error("このルームは満員です。");
      }
      currentRoom = { id: roomCode, meta: data.meta, players };
      watchCurrentRoom(roomCode);
      setMessage("ルームに参加しました。");
      await refreshRooms().catch(() => {});
      return { ok: true, roomId: roomCode };
    } finally { roomBusy = false; renderCurrentRoom(); }
  }
  async function leaveRoom() {
    requireConnection();
    if (!currentRoom) return { ok: true };
    const room = currentRoom;
    if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
    const roomRef = modules.ref(database, "rooms/" + room.id);
    try {
      const ownPlayerRef = modules.ref(database, "rooms/" + room.id + "/players/" + state.uid);
      await modules.onDisconnect(ownPlayerRef).cancel();
      if (room.meta.ownerUid === state.uid) {
        await modules.update(modules.ref(database), {
          ["rooms/" + room.id]: null,
          ["publicRooms/" + room.id]: null
        });
        setMessage("ホストが退出したため、ルームを閉じました。");
      } else {
        await modules.remove(modules.ref(database, "rooms/" + room.id + "/players/" + state.uid));
        setMessage("ルームから退出しました。");
      }
    } finally {
      currentRoom = null;
      renderCurrentRoom();
      await refreshRooms().catch(() => {});
    }
    return { ok: true };
  }
  function showError(error) {
    const message = error?.message || String(error);
    setMessage(message.includes("PERMISSION_DENIED") ?
      "データベースのルールが未設定です。案内されたルールを設定してください。" : "エラー: " + message);
  }
  function disconnect() {
    if (connectedUnsubscribe) { connectedUnsubscribe(); connectedUnsubscribe = null; }
    if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
    state.connected = false;
    state.reason = "接続監視を停止しました。";
    updateUI(state.reason);
    return { ok: true, ...state };
  }
  function getStatus() {
    return { ...state, provider: "Firebase", allowedPlan: "Spark", maxPlayers: MAX_PLAYERS,
      roomId: currentRoom?.id || null };
  }
  window.NEON_ONLINE = Object.freeze({
    getStatus, connect, disconnect, createRoom, joinRoom, leaveRoom, refreshRooms
  });
  function bind(id, handler) {
    const node = el(id);
    if (node && node.dataset.onlineBound !== "true") {
      node.dataset.onlineBound = "true";
      node.addEventListener("click", () => Promise.resolve().then(handler).catch(showError));
    }
  }
  function initializeOnlineUI() {
    bind("onlineConnectTest", connect);
    bind("onlineCreatePublic", () => createRoom("public"));
    bind("onlineCreatePrivate", () => createRoom("private"));
    bind("onlineRefreshRooms", refreshRooms);
    bind("onlineJoinByCode", () => joinRoom(el("onlineJoinCode")?.value));
    bind("onlineLeaveRoom", leaveRoom);
    updateUI(state.reason);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOnlineUI, { once: true });
  } else initializeOnlineUI();
})();
