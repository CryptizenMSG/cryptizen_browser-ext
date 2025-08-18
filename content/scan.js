// content/scan.js — scan des bulles + auto-chiffrement (Enter / boutons)
(function () {
  const CM = window.CM;

  CM.scanMessages = async function (root) {
    const nodes = Array.from(root.querySelectorAll("*")).slice(0, 1200);
    for (const el of nodes) {
      if (CM.state.seen.has(el)) continue;
      const raw = (el.innerText || el.textContent || "").trim();
      if (!raw) { CM.state.seen.add(el); continue; }
      const bundle = CM.parseBundleString(raw);
      if (bundle) { CM.state.seen.add(el); await CM.applyBundle(el, bundle); }
    }
  };

  CM.observeList = function (el) {
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.addedNodes) m.addedNodes.forEach(n => { if (n.nodeType === 1) CM.scanMessages(n); });
      }
      CM.wireSendButtons(true);
    });
    mo.observe(el || document.body, { childList: true, subtree: true });
    CM.scanMessages(el || document.body);
  };

  CM.wireAutoEncrypt = function () {
    const { inputEl } = CM.resolveSelectors();
    if (!inputEl) return;

    // Enter
    inputEl.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey && CM.state.PREFS.autoEncrypt) {
        const contact = await CM.resolveActiveContact(); if (!contact) return;
        const rawText = CM.getInputText(inputEl).trim(); if (!rawText) return;
        e.preventDefault();
        const res = await CM.safeSendMessage({
          type: "ENCRYPT_FOR",
          toPubEncJwk: contact.pubEncJwk,
          plaintext: rawText,
          meta: CM.getDomainInfo()
        }).catch(()=>null);
        if (res?.ok) {
          try { CM.state.sentPlainByHash.set(res.payload.hash, rawText); } catch {}
          CM.setInputText(inputEl, res.bundle);
          const ke = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
          inputEl.dispatchEvent(ke);
        }
      }
    }, true);

    CM.wireSendButtons(true);
  };

  let sendBtnObserverInstalled = false;
  CM.wireSendButtons = function (setupGlobal) {
    const { inputEl, selectors } = CM.resolveSelectors();
    if (!inputEl) return;

    if (setupGlobal && !sendBtnObserverInstalled) {
      document.addEventListener("click", async (e) => {
        if (!CM.state.PREFS.autoEncrypt) return;

        const s = CM.resolveSelectors();
        const el = s.inputEl;
        if (!el) return;

        if (!s || !s.selectors || typeof s.selectors.sendButtons !== "string" || !s.selectors.sendButtons.trim()) return;

        let candidates;
        try {
          candidates = Array.from(document.querySelectorAll(s.selectors.sendButtons));
        } catch {
          return; // sélecteur invalide défini par le site, on ignore proprement
        }
        if (!candidates.length) return;

        const path = (e.composedPath && e.composedPath()) || [];
        const hit = path.find(n => candidates.includes(n));
        if (!hit) return;

        const current = CM.getInputText(el).trim();
        const pref = CM.state.PREFS.prefix || CM.state.PREFIX_DEFAULT;
        if (!current || current.startsWith(pref)) return;

        const contact = await CM.resolveActiveContact();
        if (!contact) return;

        const res = await CM.safeSendMessage({
          type: "ENCRYPT_FOR",
          toPubEncJwk: contact.pubEncJwk,
          plaintext: current,
          meta: CM.getDomainInfo()
        }).catch(()=>null);
        if (res?.ok) {
          try { CM.state.sentPlainByHash.set(res.payload.hash, current); } catch {}
          CM.setInputText(el, res.bundle);
        }
      }, true);
      sendBtnObserverInstalled = true;
    }
  };

  CM.tryStart = function () {
    const { listEl } = CM.resolveSelectors();
    CM.observeList(listEl || document.body);
    CM.wireAutoEncrypt();
    CM.ensureFab();
  };

  CM.init = async function () {
    await CM.loadPrefsAndState();
    await CM.loadConfig();
    if (!CM.gateStart()) return;
    CM.tryStart();
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area === "local" && changes.prefs) {
        CM.state.PREFS = Object.assign({}, CM.state.PREFS, changes.prefs.newValue);
      }
    });
  };
})();
