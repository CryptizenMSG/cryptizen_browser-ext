// content/invite.js — génération de l’invitation (inclut mes clés publiques) + robustesse
(function () {
  const CM = (window.CM = window.CM || {});
  CM.state = CM.state || {};

  CM.buildInviteString = async function () {
    // essaie d'exporter; en cas d'échec, assure la génération puis re-tente
    let pubRes = await CM.safeSendMessage({ type: "EXPORT_PUBLIC" }).catch(() => null);
    if (!pubRes?.ok) {
      await CM.safeSendMessage({ type: "ENSURE_KEYS" }).catch(() => null);
      pubRes = await CM.safeSendMessage({ type: "EXPORT_PUBLIC" }).catch(() => null);
    }
    const pub = pubRes?.bundle;
    if (!pub || !pub.enc || !pub.sig) throw new Error("Impossible d’exporter les clés publiques");

    const domainInfo = CM.getDomainInfo ? CM.getDomainInfo() : { domain: location.hostname, conversationId: document.title || "n/a" };
    const sas = (pub.fp?.pin || "000000").toString().padStart(6,"0");

    const invite = {
      v: 1, t: "keyx", time: Date.now(),
      from: pub.fp || null,
      pub: { enc: pub.enc, sig: pub.sig },
      sas, meta: domainInfo
    };

    const pref = (CM.state.PREFS?.invitePrefix || CM.state.INVITE_PREFIX_DEFAULT || "CRYPTIZEN.ORG|");
    const json = JSON.stringify(invite);
    const buf = new TextEncoder().encode(json);
    const b64url = btoa(String.fromCharCode(...buf)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    const str = pref + b64url;

    try { sessionStorage.setItem("cryptizen:lastInvite", JSON.stringify({ time: invite.time })); } catch {}
    return { invite, string: str };
  };

  CM.insertInviteIntoInput = async function () {
    const { inputEl } = CM.resolveSelectors ? CM.resolveSelectors() : { inputEl: null };
    const { string } = await CM.buildInviteString();
    if (inputEl && CM.setInputText) CM.setInputText(inputEl, string);
    return string;
  };
})();
