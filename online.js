/* NEON ADVENTURE ONLINE — Phase 1 foundation
 * This file intentionally makes NO network requests.
 * Firebase configuration and SDK are not installed in Phase 1.
 * The solo game remains independent from this module.
 */
(() => {
  "use strict";

  const settings = Object.freeze({
    enabled: false,
    provider: "Firebase",
    allowedPlan: "Spark",
    maxPlayers: 16
  });

  const status = Object.freeze({
    ready: false,
    connected: false,
    networkStarted: false,
    reason: "オンライン通信は未設定です。Firebase Spark の確認と設定が完了するまで接続しません。"
  });

  function getStatus() {
    return { ...status, ...settings };
  }

  function connect() {
    return {
      ok: false,
      connected: false,
      reason: status.reason
    };
  }

  function disconnect() {
    return {
      ok: true,
      connected: false,
      reason: "通信は開始されていません。"
    };
  }

  window.NEON_ONLINE = Object.freeze({
    getStatus,
    connect,
    disconnect
  });
})();
