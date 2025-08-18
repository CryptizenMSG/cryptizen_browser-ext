// content/contacts.js — sélecteurs + conversation + contacts + invites
(function () {
  const CM = window.CM;

  CM.resolveSelectors = function () {
    const sel = (CM.state.ACTIVE_DOMAIN && CM.state.ACTIVE_DOMAIN.selectors) || {
      input: "textarea, [contenteditable='true']",
      messageList: "main, body",
      username: "h1, h2, [role='heading']",
      sendButtons: "button[aria-label*='Send'],button[aria-label*='Envoyer'],button[title*='Send'],button[title*='Envoyer']"
    };
    const inputEl = document.querySelector(sel.input);
    const listEl = document.querySelector(sel.messageList) || document.body;
    const userEl = document.querySelector(sel.username);
    const sendBtns = (typeof sel.sendButtons === "string" && sel.sendButtons.trim())
      ? Array.from(document.querySelectorAll(sel.sendButtons))
      : [];
    return { inputEl, listEl, userEl, selectors: sel, sendBtns };
  };

  function normalizeConvId(id) {
    try {
      const u = new URL(location.href);
      // On privilégie le chemin stable sans querystring (souvent les plateformes varient ?ref=)
      return `${u.hostname}${u.pathname}` || id || "unknown";
    } catch {
      return id || "unknown";
    }
  }

  CM.getConversationId = function () {
    let conv = null;
    if (CM.state.ACTIVE_DOMAIN?.conversationIdFromUrl) {
      const m = location.href.match(new RegExp(CM.state.ACTIVE_DOMAIN.conversationIdFromUrl));
      if (m) conv = m[1];
    }
    if (!conv) {
      const { userEl } = CM.resolveSelectors();
      const name = userEl?.textContent?.trim() || "unknown";
      conv = `${location.host}:${name}`;
    }
    return normalizeConvId(conv);
  };

  CM.getDomainInfo = function () { return { domain: location.host, conversationId: CM.getConversationId(), url: location.href }; };

  CM.getInputText = function (el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    if (el.isContentEditable) return (el.innerText || el.textContent || "");
    return "";
  };

  CM.setInputText = function (el, text) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      el.value = text; el.dispatchEvent(new Event("input", { bubbles: true })); return true;
    }
    if (el.isContentEditable) {
      el.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
      return true;
    }
    return false;
  };

  CM.resolveActiveContact = async function () {
    const { domain, conversationId } = CM.getDomainInfo();
    let res;
    try { res = await CM.safeSendMessage({ type: "GET_STATE" }); } catch (e) { return null; }
    const contacts = res?.contacts || [];
    const exactId = `${domain}:${conversationId}`.trim();
    let c = contacts.find(x => x.id === exactId);
    if (c) return c;
    c = contacts.find(x => x.domain === domain && x.conversationId === conversationId);
    if (c) return c;
    const sameDomain = contacts.filter(x => x.domain === domain);
    if (sameDomain.length === 1) return sameDomain[0];
    if (sameDomain.length > 1) {
      sameDomain.sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
      return sameDomain[0];
    }
    return null;
  };

  CM.sendKeyExchange = async function () {
    await CM.safeSendMessage({ type: "ENSURE_KEYS" }).catch(()=>{});
    const pub = await CM.safeSendMessage({ type: "EXPORT_PUBLIC" }).catch(()=>null);
    if (!pub?.ok) return alert("Erreur: impossible d’exporter la clé publique.");
    const bundle = {
      v: 1, t: "keyx",
      from: pub.bundle.fp,
      pub: { enc: pub.bundle.enc, sig: pub.bundle.sig },
      time: Date.now(),
      sas: await (async () => {
        const merged = JSON.stringify(pub.bundle);
        const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(merged));
        const arr = new Uint8Array(h);
        const pin = (((arr[0]<<24)|(arr[1]<<16)|(arr[2]<<8)|arr[3])>>>0) % 1000000;
        return pin.toString().padStart(6,"0");
      })(),
      meta: CM.getDomainInfo()
    };
    try { sessionStorage.setItem("cryptizen:lastInvite", JSON.stringify({ time: bundle.time })); } catch {}

    const ipref = CM.state.PREFS.invitePrefix || CM.state.INVITE_PREFIX_DEFAULT;
    const str = ipref + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(bundle)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const { inputEl } = CM.resolveSelectors();
    if (!inputEl) return alert("Champ de saisie introuvable sur cette page.");
    CM.setInputText(inputEl, str);
  };

  CM.parseBundleString = function (str) {
    const msgPref = CM.state.PREFS.prefix || CM.state.PREFIX_DEFAULT;
    const invPref = CM.state.PREFS.invitePrefix || CM.state.INVITE_PREFIX_DEFAULT;
    if (!str) return null;
    const used = str.startsWith(msgPref) ? msgPref : (str.startsWith(invPref) ? invPref : null);
    if (!used) return null;
    const body = str.slice(used.length);
    try {
      const buf = Uint8Array.from(atob(body.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(buf));
    } catch { return null; }
  };
})();
