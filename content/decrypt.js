// content/decrypt.js — application des bundles + déchiffrement
(function () {
  const CM = window.CM;
  const { escapeHtml, setBubblePlainText, setBubbleCard, setBubblePill } = CM;

  async function bindKeyxActions(bubbleEl, bundle) {
    const domainInfo = CM.getDomainInfo();
    bubbleEl.querySelector("#cm-deny")?.addEventListener("click", () => setBubblePill(bubbleEl, "Échange de clés refusé"));
    bubbleEl.querySelector("#cm-accept")?.addEventListener("click", async () => {
      try {
        await CM.safeSendMessage({
          type: "SAVE_CONTACT",
          contact: {
            id: `${domainInfo.domain}:${domainInfo.conversationId}`.trim(),
            name: domainInfo.conversationId,
            domain: domainInfo.domain,
            conversationId: domainInfo.conversationId,
            pubEncJwk: bundle.pub.enc,
            pubSigJwk: bundle.pub.sig,
            verified: false,
            createdAt: Date.now()
          }
        });
        const pub = await CM.safeSendMessage({ type: "EXPORT_PUBLIC" });
        const reply = { v: 1, t: "keyx-ack", to: bundle.from, pub: { enc: pub.bundle.enc, sig: pub.bundle.sig }, time: Date.now(), meta: domainInfo };
        const ipref = CM.state.PREFS.invitePrefix || CM.state.INVITE_PREFIX_DEFAULT;
        const str = ipref + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(reply)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
        const { inputEl } = CM.resolveSelectors();
        if (inputEl) CM.setInputText(inputEl, str);
        setBubblePill(bubbleEl, "Discussion chiffrée");
      } catch (e) {
        if ((e && e.message) === "EXTENSION_RELOADED") {
          setBubbleCard(bubbleEl, `<p><b>Extension rechargée</b></p><p style="opacity:.8">Rafraîchissez la page et acceptez à nouveau l’invitation.</p>`);
        } else {
          setBubbleCard(bubbleEl, `<p><b>Erreur</b></p><p style="opacity:.8">${escapeHtml(e?.message || String(e))}</p>`);
        }
      }
    });
  }

  CM.decryptIntoBubble = async function (bubbleEl, bundle) {
    const pref = CM.state.PREFS.prefix || CM.state.PREFIX_DEFAULT;
    const payloadStr = pref + btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(bundle)))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
    let res;
    try {
      res = await CM.safeSendMessage({ type: "DECRYPT_BUNDLE", bundle: payloadStr });
    } catch (e) {
      if ((e && e.message) === "EXTENSION_RELOADED") {
        setBubbleCard(bubbleEl, `<p><b>Extension rechargée</b></p><p style="opacity:.8">Rafraîchissez la page et réessayez.</p>`);
        return;
      }
      throw e;
    }

    if (!res?.ok && (res.error === "NEED_PASSPHRASE" || res.error === "BAD_PASSPHRASE")) {
      const msg = res.error === "BAD_PASSPHRASE" ? "Mot de passe incorrect.\nEntrez le mot de passe de chiffrement :" : "Entrez le mot de passe de chiffrement :";
      const pass = prompt(msg, "");
      if (pass) {
        const set = await CM.safeSendMessage({ type: "SET_PASSPHRASE", passphrase: pass }).catch(()=>null);
        if (set?.ok) res = await CM.safeSendMessage({ type: "DECRYPT_BUNDLE", bundle: payloadStr }).catch(()=>null);
      }
    }

    if (!res?.ok) {
      const human =
        res?.error === "NEED_PASSPHRASE" ? "Mot de passe requis pour déchiffrer vos clés privées."
      : res?.error === "NO_PRIVATE_KEYS" ? "Aucune clé privée locale. Générez vos clés puis ré-essayez."
      : res?.error === "DECRYPT_FAIL" || res?.error === "OperationError" ? "Impossible de déchiffrer ce message (clé incorrecte ou message altéré)."
      : res?.error || "Erreur inconnue";
      setBubbleCard(bubbleEl, `<p><b>Échec du déchiffrement</b></p><p style="opacity:.8">${escapeHtml(human)}</p>`);
      return;
    }
    const { plaintext } = res.result;
    setBubblePlainText(bubbleEl, plaintext);
  };

  CM.applyBundle = async function (bubbleEl, bundle) {
    if (bubbleEl.dataset.cmProcessed === "1") return;

    if (!CM.state.MY_FP) {
      try { const st = await CM.safeSendMessage({ type: "GET_STATE" }); if (st?.ok) CM.state.MY_FP = st.keyring?.myFingerprint || CM.state.MY_FP; } catch {}
    }
    let isSelf = !!(CM.state.MY_FP && bundle.from && (bundle.from.hex === CM.state.MY_FP.hex || bundle.from.pin === CM.state.MY_FP.pin));
    if (!isSelf) {
      try { const last = JSON.parse(sessionStorage.getItem("cryptizen:lastInvite") || "null"); if (last && last.time === bundle.time) isSelf = true; } catch {}
    }

    if (bundle.t === "keyx") {
      if (isSelf) { setBubblePill(bubbleEl, "Invitation envoyée"); }
      else {
        setBubbleCard(bubbleEl, `
          <p>Cette personne veut échanger avec vous de manière sécurisée avec <b>Cryptizen</b>.</p>
          <div class="cm-actions">
            <button class="cm-btn cm-btn-secondary" id="cm-deny">Non</button>
            <button class="cm-btn cm-btn-primary" id="cm-accept">Oui</button>
          </div>
          <p style="opacity:.75;font-size:.9em;margin-top:4px;">Empreinte : ${escapeHtml(bundle.from?.hex || "n/a")} • Code : <b>${escapeHtml(bundle.sas || "------")}</b></p>
        `);
        bindKeyxActions(bubbleEl, bundle);
      }
      return;
    }

    if (bundle.t === "keyx-ack") {
      const toMe = !!(CM.state.MY_FP && bundle.to && (bundle.to.hex === CM.state.MY_FP.hex || bundle.to.pin === CM.state.MY_FP.pin));
      if (toMe) {
        const info = bundle.meta || CM.getDomainInfo();
        await CM.safeSendMessage({
          type: "SAVE_CONTACT",
          contact: {
            id: `${info.domain}:${info.conversationId}`.trim(),
            name: info.conversationId,
            domain: info.domain,
            conversationId: info.conversationId,
            pubEncJwk: bundle.pub?.enc || null,
            pubSigJwk: bundle.pub?.sig || null,
            verified: false,
            createdAt: Date.now()
          }
        }).catch(()=>{});
        setBubblePill(bubbleEl, "Invitation acceptée — Discussion chiffrée");
      } else {
        setBubblePill(bubbleEl, "Demande acceptée");
      }
      return;
    }

    if (bundle.t === "msg") {
      if (isSelf) {
        // Avant : on dépendait d'un cache volatile. Maintenant on peut déchiffrer via ekSelf.
        CM.decryptIntoBubble(bubbleEl, bundle);
        return;
      }
      if (!CM.state.PREFS.autoDecrypt) {
        setBubbleCard(bubbleEl, `<p>🔐 Message chiffré.</p><div class="cm-actions"><button class="cm-btn cm-btn-primary" id="cm-dec">Déchiffrer</button></div>`);
        bubbleEl.querySelector("#cm-dec")?.addEventListener("click", () => CM.decryptIntoBubble(bubbleEl, bundle));
      } else {
        CM.decryptIntoBubble(bubbleEl, bundle);
      }
    }
  };
})();
