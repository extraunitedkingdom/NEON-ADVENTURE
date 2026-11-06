/* NEON ADVENTURE ONLINE — Firebase Spark connection foundation
 * Uses Firebase Web SDK via CDN. No paid services or billing setup.
 * Database writes are intentionally disabled in this phase.
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
  let state = {
    ready: true,
    connected: false,
    authenticated: false,
    connecting: false,
    networkStarted: false,
    uid: null,
    reason: "接続テストの準備ができています。"
  };
  let modules = null;
  let app = null;
  let auth = null;
  let database = null;
  let connectedUnsubscribe = null;

  function updateUI(message) {
    const status = document.getElementById("onlineStatusText");
    const button = document.getElementById("onlineConnectTest");
    if (status) status.textContent = message || state.reason;
    if (button) {
      button.disabled = state.connecting;
      button.textContent = state.connecting ? "接続中..." :
        (state.connected && state.authenticated ? "接続確認済み" : "接続テスト");
    }
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

      let credential;
      if (auth.currentUser) {
        credential = { user: auth.currentUser };
      } else {
        credential = await sdk.signInAnonymously(auth);
      }
      state.authenticated = true;
      state.uid = credential.user.uid;

      state.reason = "Realtime Databaseへの接続を確認しています...";
      updateUI(state.reason);

      if (connectedUnsubscribe) connectedUnsubscribe();
      await new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error("接続確認がタイムアウトしました。ネットワークとFirebase設定を確認してください。"));
          }
        }, 12000);
        connectedUnsubscribe = sdk.onValue(
          sdk.ref(database, ".info/connected"),
          snapshot => {
            const isConnected = snapshot.val() === true;
            state.connected = isConnected;
            if (isConnected && !settled) {
              settled = true;
              clearTimeout(timeout);
              resolve();
            }
            if (!isConnected) {
              state.connected = false;
              state.reason = "Firebaseとの接続が切れています。";
              updateUI(state.reason);
            } else {
              state.reason = "Firebase接続・匿名認証を確認しました。";
              updateUI(state.reason);
            }
          },
          error => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(error);
            }
          }
        );
      });

      state.reason = "Firebase接続・匿名認証を確認しました。データの書き込みはまだ行っていません。";
      return { ok: true, ...state };
    } catch (error) {
      state.connected = false;
      state.reason = "接続できませんでした: " + (error && error.message ? error.message : String(error));
      return { ok: false, ...state };
    } finally {
      state.connecting = false;
      updateUI(state.reason);
    }
  }

  function disconnect() {
    if (connectedUnsubscribe) {
      connectedUnsubscribe();
      connectedUnsubscribe = null;
    }
    state.connected = false;
    state.reason = "接続監視を停止しました。";
    updateUI(state.reason);
    return { ok: true, ...state };
  }

  function getStatus() {
    return { ...state, provider: "Firebase", allowedPlan: "Spark", maxPlayers: 16 };
  }

  window.NEON_ONLINE = Object.freeze({ getStatus, connect, disconnect });

  // GitHub Pages / iOS Safari: bind immediately when the DOM is already ready,
  // otherwise wait for DOMContentLoaded. This avoids a missed click handler.
  function initializeOnlineUI() {
    const button = document.getElementById("onlineConnectTest");
    if (button && button.dataset.onlineBound !== "true") {
      button.dataset.onlineBound = "true";
      button.addEventListener("click", () => {
        connect().catch(error => {
          state.connecting = false;
          state.connected = false;
          state.reason = "接続できませんでした: " +
            (error && error.message ? error.message : String(error));
          updateUI(state.reason);
        });
      });
    }
    updateUI(state.reason);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeOnlineUI, { once: true });
  } else {
    initializeOnlineUI();
  }
})();