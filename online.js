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
  let playerSyncHandler = null;
  let chatUnsubscribe = null, chatRoomId = null;
  let lastPositionSentAt = 0;
  let lastChatSentAt = 0;

  function el(id) { return document.getElementById(id); }
  // ゲストの再接続情報はタブを閉じても残るよう localStorage に保存する。
  // ホストは切断時にルームを閉じる仕様なので、自動再接続の対象にはしない。
  function saveRoomSession(roomId, isHost) {
    try {
      localStorage.setItem("neonOnlineRoomId", roomId);
      localStorage.setItem("neonOnlineRoomHost", isHost ? "1" : "0");
    } catch (_) {}
  }
  function clearRoomSession() {
    try {
      localStorage.removeItem("neonOnlineRoomId");
      localStorage.removeItem("neonOnlineRoomHost");
    } catch (_) {}
  }
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
      const restoredUser = await new Promise((resolve, reject) => {
        let unsubscribe = null;
        unsubscribe = sdk.onAuthStateChanged(auth, user => {
          if (unsubscribe) unsubscribe();
          resolve(user);
        }, error => {
          if (unsubscribe) unsubscribe();
          reject(error);
        });
      });
      const credential = restoredUser ? { user: restoredUser } : await sdk.signInAnonymously(auth);
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
      let savedRoomId = null;
      try {
        savedRoomId = localStorage.getItem("neonOnlineRoomId");
      } catch (_) {}
      if (savedRoomId) {
        try {
          await joinRoom(savedRoomId, true);
          setMessage("前回参加していたルームに再接続しました。オンラインでスタートしてください。");
        } catch (reconnectError) {
          clearRoomSession();
          setMessage("前回のルームに再接続できませんでした。ルームが終了した可能性があります。");
        }
      }
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
    const position = typeof window.NEON_GAME_POSITION === "function"
      ? window.NEON_GAME_POSITION() : {};
    return {
      uid: state.uid,
      name: cleanName(el("playerNameInput")?.value),
      x: Number.isFinite(Number(position.x)) ? Number(position.x) : 80,
      y: Number.isFinite(Number(position.y)) ? Number(position.y) : 200,
      facing: Number(position.facing) < 0 ? -1 : 1,
      world: Math.max(1, Math.min(4, Math.floor(Number(position.world) || 1))),
      skin: /^#[0-9a-f]{6}$/i.test(String(position.skin || "")) ? position.skin : "#9b8aff",
      character: String(position.character || "boy").slice(0, 16),
      admin: typeof window.NEON_GAME_ADMIN_BADGE === "function"
        ? !!window.NEON_GAME_ADMIN_BADGE()
        : !!window.NEON_GAME_ADMIN?.(),
      joinedAt: Date.now(),
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
        clearRoomSession();
        if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
        chatRoomId = null;
        renderChatMessages({});
        notifyPlayerSync({});
        if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
        setMessage("ルームが閉じられました。");
        renderCurrentRoom();
        refreshRooms().catch(() => {});
        return;
      }
      currentRoom = { id: roomId, meta: data.meta || {}, players: data.players || {} };
      watchChat(roomId);
      notifyPlayerSync(currentRoom.players);
      renderCurrentRoom();
    }, error => showError(error));
  }
  function notifyPlayerSync(players) {
    if (typeof playerSyncHandler !== "function") return;
    const ownUid = state.uid || auth?.currentUser?.uid || null;
    const remote = Object.entries(players || {})
      .filter(([uid, p]) => p && uid !== ownUid && p.uid !== ownUid)
      .map(([uid, p]) => ({ ...p, uid: uid }));
    try { playerSyncHandler(remote); } catch (error) { console.error("Player sync handler:", error); }
  }
  function setPlayerSyncHandler(handler) {
    playerSyncHandler = typeof handler === "function" ? handler : null;
    if (currentRoom) notifyPlayerSync(currentRoom.players);
    else if (playerSyncHandler) playerSyncHandler([]);
    return true;
  }
  function publishPosition(position) {
    if (!currentRoom || !state.connected || !modules || !position) return false;
    const now = Date.now();
    if (now - lastPositionSentAt < 100) return false;
    const x = Number(position.x), y = Number(position.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    lastPositionSentAt = now;
    const payload = {
      uid: state.uid,
      name: cleanName(el("playerNameInput")?.value),
      online: true,
      x, y,
      facing: Number(position.facing) < 0 ? -1 : 1,
      world: Math.max(1, Math.min(4, Math.floor(Number(position.world) || 1))),
      skin: /^#[0-9a-f]{6}$/i.test(String(position.skin || "")) ? position.skin : "#9b8aff",
      character: String(position.character || "boy").slice(0, 16),
      // 管理者状態はゲーム本体の現在値を優先して送信する。
      admin: typeof window.NEON_GAME_ADMIN_BADGE === "function"
        ? !!window.NEON_GAME_ADMIN_BADGE()
        : (typeof window.NEON_GAME_ADMIN === "function"
          ? !!window.NEON_GAME_ADMIN()
          : !!position.admin)
    };
    const playerRef = modules.ref(database, "rooms/" + currentRoom.id + "/players/" + state.uid);
    modules.update(playerRef, payload).catch(showError);
    return true;
  }
  function renderChatMessages(messages) {
    const list = el("onlineChatMessages");
    if (!list) return;
    list.textContent = "";
    const entries = Object.values(messages || {}).sort((a, b) =>
      Number(a?.createdAt || 0) - Number(b?.createdAt || 0)
    ).slice(-60);
    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "online-chat-empty";
      empty.textContent = "まだメッセージはありません。";
      list.appendChild(empty);
      return;
    }
    entries.forEach(message => {
      if (!message || typeof message.text !== "string") return;
      const row = document.createElement("div");
      row.className = "online-chat-message";
      const heading = document.createElement("div");
      heading.className = "online-chat-heading";
      const name = document.createElement("strong");
      name.textContent = cleanName(message.name);
      heading.appendChild(name);
      if (message.admin) {
        const admin = document.createElement("span");
        admin.className = "online-chat-admin";
        admin.textContent = "ADMIN";
        heading.appendChild(admin);
      }
      const body = document.createElement("div");
      body.className = "online-chat-text";
      body.textContent = message.text;
      row.append(heading, body);
      list.appendChild(row);
    });
    list.scrollTop = list.scrollHeight;
  }
  function watchChat(roomId) {
    if (chatUnsubscribe && chatRoomId === roomId) return;
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    chatRoomId = roomId;
    const chatRef = modules.ref(database, "rooms/" + roomId + "/chat");
    chatUnsubscribe = modules.onValue(chatRef, snapshot => {
      renderChatMessages(snapshot.val() || {});
    }, error => showError(error));
  }
  async function sendChatMessage() {
    requireConnection();
    if (!currentRoom) throw new Error("先にルームへ参加してください。");
    const input = el("onlineChatInput");
    const text = String(input?.value || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (now - lastChatSentAt < 700) return;
    lastChatSentAt = now;
    const message = {
      senderUid: state.uid,
      name: cleanName(el("playerNameInput")?.value),
      text,
      admin: typeof window.NEON_GAME_ADMIN_BADGE === "function"
        ? !!window.NEON_GAME_ADMIN_BADGE()
        : !!window.NEON_GAME_ADMIN?.(),
      createdAt: now
    };
    await modules.set(modules.push(modules.ref(database, "rooms/" + currentRoom.id + "/chat")), message);
    if (input) input.value = "";
  }
  function renderCurrentRoom() {
    const panel = el("onlineCurrentRoom");
    const details = el("onlineCurrentRoomDetails");
    const leave = el("onlineLeaveRoom");
    const chatDock = el("onlineChatDock");
    if (!panel) return;
    panel.style.display = currentRoom ? "block" : "none";
    if (chatDock) chatDock.style.display = currentRoom ? "block" : "none";
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
      const writes = { ["rooms/" + code]: room };
      if (visibility === "public") {
        writes["publicRooms/" + code] = { name, ownerUid: state.uid, createdAt: Date.now() };
      }
      await modules.update(modules.ref(database), writes);
      try {
        // ホストがページを離れてもルームは維持し、ホスト本人の参加状態だけを解除する。
        await modules.onDisconnect(playerRef).remove();
      } catch (presenceError) {
        const cleanup = { ["rooms/" + code]: null };
        if (visibility === "public") cleanup["publicRooms/" + code] = null;
        await modules.update(modules.ref(database), cleanup);
        throw presenceError;
      }
      currentRoom = { id: code, meta: room.meta, players: room.players };
      saveRoomSession(code, true);
      watchCurrentRoom(code);
      setMessage(visibility === "public" ?
        "公開ルームを作成しました。" : "プライベートルームを作成しました。参加コード: " + code);
      const codeOut = el("onlineRoomCode");
      if (codeOut) codeOut.textContent = code;
      await refreshRooms().catch(() => {});
      return { ok: true, code };
    } finally { roomBusy = false; renderCurrentRoom(); }
  }
  async function joinRoom(code, isReconnect = false) {
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
      if (data?.players?.[state.uid] && !isReconnect) throw new Error("すでに参加しています。");
      const existingPlayerCount = Object.keys(data?.players || {}).filter(uid => uid !== state.uid).length;
      if (canReadBeforeJoin && existingPlayerCount >= MAX_PLAYERS) throw new Error("このルームは満員です。");
      await modules.onDisconnect(playerRef).remove();
      await modules.set(playerRef, getPlayerInfo());
      // 参加者を書き込んだ後に必ず最新のルーム全体を読み直す。
      // 参加前の古い players 一覧を保持すると、開始位置や表示人数がずれる。
      const joinedSnapshot = await modules.get(roomRef);
      data = joinedSnapshot.val();
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
      const isRoomHost = data.meta.ownerUid === state.uid;
      saveRoomSession(roomCode, isRoomHost);
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
    const ownPlayerRef = modules.ref(database, "rooms/" + room.id + "/players/" + state.uid);
    // ホストも参加者も、自分の参加情報だけを削除する。ルーム本体と公開一覧は維持する。
    await modules.remove(ownPlayerRef);
    await modules.onDisconnect(ownPlayerRef).cancel().catch(() => {});
    setMessage(room.meta.ownerUid === state.uid
      ? "ホストとして退出しました。ルームはそのまま残ります。"
      : "ルームから退出しました。");
    if (roomUnsubscribe) { roomUnsubscribe(); roomUnsubscribe = null; }
    currentRoom = null;
    clearRoomSession();
    if (chatUnsubscribe) { chatUnsubscribe(); chatUnsubscribe = null; }
    chatRoomId = null;
    renderChatMessages({});
    notifyPlayerSync({});
    renderCurrentRoom();
    await refreshRooms().catch(() => {});
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
    notifyPlayerSync({});
    state.reason = "接続監視を停止しました。";
    updateUI(state.reason);
    return { ok: true, ...state };
  }
  function getStatus() {
    return { ...state, uid: state.uid || auth?.currentUser?.uid || null,
      provider: "Firebase", allowedPlan: "Spark", maxPlayers: MAX_PLAYERS,
      roomId: currentRoom?.id || null };
  }
  function getRoomPlayers() {
    if (!currentRoom) return [];
    const players = Object.entries(currentRoom.players || {}).map(([uid, player]) => ({ ...player, uid }));
    // joinRoom直後の初回スナップショット前でも、自分を参加者一覧に含める。
    if (state.uid && !players.some(player => player.uid === state.uid)) {
      players.push({ ...getPlayerInfo(), uid: state.uid });
    }
    return players;
  }
  window.NEON_ONLINE = Object.freeze({
    getStatus, getRoomPlayers, connect, disconnect, createRoom, joinRoom, leaveRoom, refreshRooms,
    setPlayerSyncHandler, publishPosition, sendChatMessage
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
    bind("onlineChatSend", sendChatMessage);
    const chatInput = el("onlineChatInput");
    if (chatInput && chatInput.dataset.chatBound !== "true") {
      chatInput.dataset.chatBound = "true";
      chatInput.addEventListener("keydown", event => {
        if (event.key === "Enter") { event.preventDefault(); sendChatMessage().catch(showError); }
      });
    }
    updateUI(state.reason);
    // ページ復帰時に認証を復元し、ゲストなら前回のルームへ自動再参加。
    connect().catch(showError);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOnlineUI, { once: true });
  } else initializeOnlineUI();
})();
