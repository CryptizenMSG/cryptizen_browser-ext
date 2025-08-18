// content-script.js — point d’entrée & helpers (position FAB + chiffrement via raccourci)
(async function () {
  try {
    // 1) lancer le runtime des modules de contenu
    if (window.CM && typeof window.CM.init === "function") {
      await window.CM.init();
    }

    const CM = (window.CM = window.CM || {});
    CM.state = CM.state || {};
    CM.state.sentPlainByHash = CM.state.sentPlainByHash || new Map();

    // 2) fonction appelée par le raccourci clavier (via background)
    CM.encryptCurrentInput = async function () {
      try {
        const s = CM.resolveSelectors ? CM.resolveSelectors() : null;
        if (!s?.inputEl) return false;

        const current = (CM.getInputText ? CM.getInputText(s.inputEl) : (s.inputEl.innerText || s.inputEl.value || "")).trim();
        if (!current) return false;

        const contact = await (CM.resolveActiveContact ? CM.resolveActiveContact() : null);
        if (!contact?.pubEncJwk) return false;

        const res = await CM.safeSendMessage({
          type: "ENCRYPT_FOR",
          toPubEncJwk: contact.pubEncJwk,
          plaintext: current,
          meta: CM.getDomainInfo ? CM.getDomainInfo() : null
        }).catch(() => null);

        if (res?.ok) {
          try { CM.state.sentPlainByHash.set(res.payload.hash, current); } catch {}
          if (CM.setInputText) CM.setInputText(s.inputEl, res.bundle);
          // pas d’auto-send ici : l’utilisateur peut encore éditer
          return true;
        }
      } catch { /* noop */ }
      return false;
    };

    // 3) position du FAB / cadenas selon préférences
    async function applyLockPosition() {
      try {
        const prefs = CM.state?.PREFS || (await chrome.runtime.sendMessage({ type: "GET_PREFS" }))?.prefs || {};
        const pos = prefs.lockIconPosition || "bottom-right";

        const root =
          document.querySelector(".cryptizen-floating") ||
          document.querySelector(".cryptizen-root") ||
          document.querySelector(".cryptizen-fab");

        if (!root) return; // FAB pas encore présent

        // reset
        root.style.top = root.style.right = root.style.bottom = root.style.left = "";

        switch (pos) {
          case "top-left":
            root.style.top = "16px"; root.style.left = "16px"; break;
          case "top-right":
            root.style.top = "16px"; root.style.right = "16px"; break;
          case "bottom-left":
            root.style.bottom = "16px"; root.style.left = "16px"; break;
          case "bottom-right":
          default:
            root.style.bottom = "16px"; root.style.right = "16px"; break;
        }
      } catch { /* no-op */ }
    }

    // observer pour repositionner dès que le FAB apparaît
    const mo = new MutationObserver(() => {
      const el = document.querySelector(".cryptizen-floating, .cryptizen-root, .cryptizen-fab");
      if (el) { applyLockPosition(); }
    });
    mo.observe(document.documentElement || document.body, { childList: true, subtree: true });

    // applique immédiatement si déjà présent
    applyLockPosition();

    // réagit aux changements de préférences
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.prefs?.newValue) {
        CM.state.PREFS = Object.assign({}, CM.state.PREFS || {}, changes.prefs.newValue);
        applyLockPosition();
      }
    });

    // 4) canal de secours (si jamais tu veux envoyer un message plutôt que executeScript)
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "DO_ENCRYPT_ACTIVE_INPUT") {
        CM.encryptCurrentInput().then(ok => sendResponse({ ok })).catch(e => sendResponse({ ok: false, error: String(e) }));
        return true;
      }
      return false;
    });

  } catch (e) {
    // silencieux (certains sites loggent beaucoup déjà)
  }
})();
