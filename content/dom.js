(function () {
  const CM = window.CM;
  const { escapeHtml } = CM;

  // Fonction pour trouver l'élément texte à modifier
  function findTextLeaf(node) {
    if (!node || node.nodeType !== 1) return null;
    let best = null, bestLen = 0;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, null);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (el.childElementCount === 0) {
        const txt = (el.innerText || el.textContent || "").trim();
        const len = txt.length;
        if (len > bestLen) { best = el; bestLen = len; }
      }
    }
    return best || node;
  }

  CM.setBubblePlainText = function (bubbleEl, text) {
    const leaf = findTextLeaf(bubbleEl);
    if (!leaf) return;
    try {
      if (leaf.textContent !== undefined) {
        leaf.textContent = text;
      } else {
        console.error('Element non trouvé pour modification');
      }
      bubbleEl.dataset.cmProcessed = "1";
      bubbleEl.classList.remove("cm-mask");
    } catch (error) {
      console.error('Erreur lors de la mise à jour du contenu :', error);
    }
  };

  CM.setBubbleCard = function (bubbleEl, innerHTML) {
    const leaf = findTextLeaf(bubbleEl); if (!leaf) return;
    leaf.innerHTML = "";
    const card = document.createElement("div");
    card.className = "cm-card cm-inline";
    card.innerHTML = innerHTML;
    leaf.appendChild(card);
    bubbleEl.dataset.cmProcessed = "1";
  };

  CM.setBubblePill = function (bubbleEl, text) {
    const leaf = findTextLeaf(bubbleEl); if (!leaf) return;
    leaf.innerHTML = "";
    const pill = document.createElement("span");
    pill.className = "cm-pill cm-inline";
    pill.innerHTML = `<span class="dot"></span>${escapeHtml(text)}`;
    leaf.appendChild(pill);
    bubbleEl.dataset.cmProcessed = "1";
  };

  // ---- UI flottante
  let overlayRoot = null;
  CM.ensureShadow = function () {
    if (overlayRoot) return overlayRoot;
    const host = document.createElement("div"); host.className = "cryptizen-root";
    const shadow = host.attachShadow({ mode: "open" });
    const link = document.createElement("link"); link.rel = "stylesheet"; link.href = chrome.runtime.getURL("styles/overlay.css");
    shadow.appendChild(link);
    document.documentElement.appendChild(host);
    overlayRoot = { host, shadow };
    return overlayRoot;
  };

  CM.togglePanel = function () {
    const { shadow } = CM.ensureShadow();
    const PREFS = CM.state.PREFS;
    const existing = shadow.querySelector(".cryptizen-panel");
    if (existing) { existing.remove(); return; }

    const panel = document.createElement("div");
    panel.className = "cryptizen-panel";
    panel.innerHTML = `
      <h4>🔐 Cryptizen</h4>
      <div class="cryptizen-small">Domaine: ${location.host}</div>
      <label class="cryptizen-toggle"><input type="checkbox" id="autoEnc"> Auto-chiffrer</label>
      <label class="cryptizen-toggle"><input type="checkbox" id="autoDec"> Auto-déchiffrer</label>
      <div class="cryptizen-toggle">
        <button id="sendKeyReq" class="cryptizen-btn cryptizen-secondary">Inviter l'utilisateur</button>
        <button id="encryptOnce" class="cryptizen-btn cryptizen-primary">Chiffrer ▶</button>
      </div>
    `;
    shadow.appendChild(panel);

    // Appliquer la position de la card selon les préférences
    const pos = CM.state?.PREFS?.lockIconPosition || "bottom-right"; // Position par défaut
    panel.classList.add(pos); // Applique la classe correspondant à la position (par ex : "bottom-right")
    
    panel.querySelector("#autoEnc").checked = !!PREFS.autoEncrypt;
    panel.querySelector("#autoDec").checked = !!PREFS.autoDecrypt;

    panel.querySelector("#autoEnc").addEventListener("change", async (e) => {
      CM.state.PREFS.autoEncrypt = e.target.checked;
      await CM.safeSendMessage({ type: "SET_PREFS", payload: { autoEncrypt: CM.state.PREFS.autoEncrypt } }).catch(() => {});
    });

    panel.querySelector("#autoDec").addEventListener("change", async (e) => {
      CM.state.PREFS.autoDecrypt = e.target.checked;
      await CM.safeSendMessage({ type: "SET_PREFS", payload: { autoDecrypt: CM.state.PREFS.autoDecrypt } }).catch(() => {});
    });

    panel.querySelector("#sendKeyReq").addEventListener("click", CM.sendKeyExchange);
    panel.querySelector("#encryptOnce").addEventListener("click", () => CM.encryptCurrentInputOnce());
  };

  CM.ensureFab = function () {
    const { shadow } = CM.ensureShadow();
    let holder = shadow.querySelector(".cryptizen-floating");

    if (!holder) {
      holder = document.createElement("div");
      holder.className = "cryptizen-floating";

      // Récupérer la position selon les préférences : BL, BR, TL, TR
      const pos = CM.state?.PREFS?.lockIconPosition || "bottom-right"; // Valeur par défaut : "bottom-right"
      holder.classList.add(pos);  // Ajoute la classe correspondant à la position choisie (par exemple "bottom-right")

      const btn = document.createElement("button");
      btn.className = "cryptizen-fab";
      btn.title = "Cryptizen";
      btn.textContent = "🔐";

      btn.addEventListener("click", CM.togglePanel);

      // Ajoute le bouton au conteneur
      holder.appendChild(btn);
      shadow.appendChild(holder);
    }
  };

  CM.encryptCurrentInputOnce = async function () {
    const { inputEl } = CM.resolveSelectors();
    if (!inputEl) return alert("Champ de saisie introuvable.");
    const text = CM.getInputText(inputEl).trim();
    if (!text) return;
    const contact = await CM.resolveActiveContact();
    if (!contact) { alert("Aucun destinataire/contact pour cette conversation. Lancez d’abord l’échange de clés."); return; }
    const res = await CM.safeSendMessage({
      type: "ENCRYPT_FOR",
      toPubEncJwk: contact.pubEncJwk,
      plaintext: text,
      meta: CM.getDomainInfo()
    }).catch((e) => ({ ok: false, error: e.message || String(e) }));
    if (!res?.ok) { alert("Échec du chiffrement: " + (res?.error || "inconnu")); return; }
    try { CM.state.sentPlainByHash.set(res.payload.hash, text); } catch {}
    CM.setInputText(inputEl, res.bundle);
  };

  // Sélectionner le champ "input" pour envoyer un message sur différents réseaux sociaux
  CM.resolveSelectors = function () {
    const selectors = {};

    // Lecture dynamique des sélecteurs depuis le fichier config.json
    fetch(chrome.runtime.getURL('config.json'))
      .then(response => response.json())
      .then(config => {
        const host = location.host;
        const domainConfig = config.domains.find(domain => host.includes(domain.hostPattern));

        if (domainConfig && domainConfig.selectors) {
          selectors.input = domainConfig.selectors.input;
        }

        const inputEl = document.querySelector(selectors.input);
        return { inputEl };
      })
      .catch(error => {
        console.error('Erreur lors de la récupération de la config.json:', error);
        return { inputEl: null };
      });
  };

})();
