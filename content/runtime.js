// content/runtime.js — base + helpers + config/prefs
(function () {
  const CM = (window.CM = window.CM || {});
  const PREFIX_DEFAULT = "CRYPTIZEN|";
  const INVITE_PREFIX_DEFAULT = "CRYPTIZEN.ORG|";
  const cfgUrl = chrome.runtime.getURL("config.json");

  CM.state = {
    PREFIX_DEFAULT,
    INVITE_PREFIX_DEFAULT,
    cfgUrl,
    CONFIG: null,
    PREFS: null,
    MY_FP: null,
    ACTIVE_DOMAIN: null,
    sentPlainByHash: new Map(),
    seen: new WeakSet()
  };

  // ---- Runtime helpers : éviter "Extension context invalidated"
  CM.isExtensionAlive = function () {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  };

  CM.safeSendMessage = async function (payload) {
    if (!CM.isExtensionAlive()) throw new Error("EXTENSION_RELOADED");
    try {
      return await chrome.runtime.sendMessage(payload);
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e || "unknown");
      if (msg.includes("Extension context invalidated") || msg.includes("EXTENSION_RELOADED")) {
        throw new Error("EXTENSION_RELOADED");
      }
      throw e;
    }
  };

  CM.escapeHtml = (s) =>
    s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

  // ---- Chargement prefs + fingerprint locale
  CM.loadPrefsAndState = async function () {
    const res = await CM.safeSendMessage({ type: "GET_STATE" }).catch(() => null);
    if (res?.ok) {
      CM.state.PREFS = res.prefs || { prefix: PREFIX_DEFAULT, autoEncrypt: true, autoDecrypt: true };
      CM.state.MY_FP = res.keyring?.myFingerprint || null;
    } else {
      CM.state.PREFS = { prefix: PREFIX_DEFAULT, autoEncrypt: true, autoDecrypt: true };
    }
  };

  // ---- Config domaines
  CM.loadConfig = async function () {
    try {
      const txt = await (await fetch(cfgUrl)).text();
      const diskCfg = JSON.parse(txt);
      const { configOverride } = await chrome.storage.local.get("configOverride");
      CM.state.CONFIG = configOverride || diskCfg;
    } catch {
      CM.state.CONFIG = { version: 1, allowAll: true, domains: [] };
    }
  };

  CM.matchDomain = function () {
    const host = location.host;
    const rules = (CM.state.CONFIG && CM.state.CONFIG.domains) || [];
    for (const r of rules) {
      const pattern = r.hostPattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      const re = new RegExp(`^${pattern}$`);
      if (re.test(host)) return r;
    }
    return null;
  };

  CM.gateStart = function () {
    const { CONFIG, PREFS } = CM.state;
    const active = CM.matchDomain();
    CM.state.ACTIVE_DOMAIN = active;
    if (!active && !CONFIG.allowAll && !PREFS.allowUnknownDomains) return false;
    return true;
  };
})();
