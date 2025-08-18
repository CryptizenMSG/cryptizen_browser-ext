async function send(type, payload) {
  try { return await chrome.runtime.sendMessage(Object.assign({ type }, payload || {})); }
  catch (e) { return { ok: false, error: e?.message || String(e) }; }
}
function $(id){ return document.getElementById(id); }

function safeSet(el, html){
  if (!el) return;
  el.innerHTML = html;
}

function renderContacts(list) {
  const table = $('contacts');
  if (!table) return;
  table.innerHTML = '';
  const head = document.createElement('tr');
  head.innerHTML = '<th>Nom/ID</th><th>Domaine</th><th>Conv ID</th><th>Clés</th><th>Vérifié</th>';
  table.appendChild(head);
  for (const c of (list||[])) {
    const tr = document.createElement('tr');
    const hasPub = (c.pubEncJwk && c.pubSigJwk) ? '✓' : '—';
    tr.innerHTML = `<td>${c.name||c.id||''}</td><td>${c.domain||''}</td><td>${c.conversationId||''}</td><td>${hasPub}</td><td>${c.verified?'✓':'—'}</td>`;
    table.appendChild(tr);
  }
}

async function readConfigPreview() {
  try {
    const override = (await chrome.storage.local.get('configOverride')).configOverride;
    if (override) return JSON.stringify(override, null, 2);
    const cfgUrl = chrome.runtime.getURL("config.json");
    return await (await fetch(cfgUrl)).text();
  } catch { return '—'; }
}

async function refresh() {
  const st = await send("GET_STATE");
  if (!st?.ok) {
    safeSet($('fp'), 'Erreur de récupération de l’état.');
    return;
  }
  const fp = st.keyring?.myFingerprint;
  safeSet($('fp'), fp ? `Empreinte: <code>${fp.hex}</code> — Code: <b>${fp.pin}</b>` : 'Empreinte indisponible');

  renderContacts(st.contacts || []);

  // charger prefs et pré-remplir
  const prefsRes = await send('GET_PREFS');
  const prefs = prefsRes?.prefs || {};
  if ($('autoEncrypt')) $('autoEncrypt').checked = !!prefs.autoEncrypt;
  if ($('autoDecrypt')) $('autoDecrypt').checked = !!prefs.autoDecrypt;
  if ($('clickToDecrypt')) $('clickToDecrypt').checked = !!prefs.clickToDecrypt;
  if ($('signMessages')) $('signMessages').checked = !!prefs.signMessages;
  if ($('prefix')) $('prefix').value = prefs.prefix || 'CRYPTIZEN|';
  if ($('lockPos')) $('lockPos').value = prefs.lockIconPosition || 'bottom-right';

  // config preview
  const cfgTxt = await readConfigPreview();
  safeSet($('cfgPreview'), cfgTxt.replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s])));
}

async function bioGateIfNeeded() {
  const gate = $('bioGate');
  if (!gate || !gate.checked) return true;
  if (!('credentials' in navigator) || !('PublicKeyCredential' in window)) return confirm("Vérification native indisponible, continuer ?");
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    await navigator.credentials.get({
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: "required",
        allowCredentials: [] // ca déclenche l'UV (Windows Hello, Touch ID, etc.) si présent
      }
    });
    return true;
  } catch {
    alert('Vérification annulée ou indisponible.');
    return false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await send('ENSURE_KEYS');
  await refresh();

  $('regen')?.addEventListener('click', async () => {
    if (!confirm("Régénérer de nouvelles clés ? Cela peut invalider d’anciens échanges.")) return;
    await chrome.storage.local.remove(['keyring','encryptedPrivateKey','deviceEncryptedPrivateKey','deviceKEK']);
    const res = await send('ENSURE_KEYS');
    if (!res?.ok) alert('Erreur lors de la régénération.');
    await refresh();
  });

  $('copyPub')?.addEventListener('click', async () => {
    const res = await send("EXPORT_PUBLIC");
    if (!res?.ok) return alert("Erreur: impossible d’exporter la clé publique.");
    const txt = JSON.stringify(res.bundle, null, 2);
    await navigator.clipboard.writeText(txt).catch(()=>{});
    alert("Clés publiques copiées.");
  });

  $('savePrefs')?.addEventListener('click', async () => {
    const payload = {
      autoEncrypt: $('autoEncrypt')?.checked || false,
      autoDecrypt: $('autoDecrypt')?.checked || false,
      clickToDecrypt: $('clickToDecrypt')?.checked || false,
      signMessages: $('signMessages')?.checked || false,
      prefix: $('prefix')?.value || "CRYPTIZEN|",
      lockIconPosition: $('lockPos')?.value || "bottom-right"
    };

    // IMPORTANT: wrap in { payload }
    const res = await send("SET_PREFS", { payload });

    if (res?.ok) {
      alert("Préférences sauvegardées.");
      await refresh(); // recharger l’UI depuis le storage
    } else {
      alert("Échec de sauvegarde.");
    }
  });

  // Export sécurisé (JSON chiffré)
  $('doExport')?.addEventListener('click', async () => {
    const pass = $('bkPass')?.value || '';
    if (!pass) return alert('Entrez une passphrase.');
    if (!(await bioGateIfNeeded())) return;

    const res = await send('EXPORT_PRIVATE_BACKUP', { passphrase: pass });
    if (!res?.ok) return alert('Échec de l’export: ' + (res?.error || 'inconnu'));

    const blob = new Blob([JSON.stringify(res.blob, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'cryptizen-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // Import sécurisé
  $('doImport')?.addEventListener('click', async () => {
    const pass = $('bkPassImport')?.value || '';
    if (!pass) return alert('Entrez la passphrase de la sauvegarde.');
    const file = $('bkFile')?.files?.[0];
    if (!file) return alert('Choisissez le fichier de sauvegarde.');
    if (!(await bioGateIfNeeded())) return;

    try {
      const txt = await file.text();
      const blob = JSON.parse(txt); // { v, mode:"pass", salt[], iv[], ct[] }
      const res = await send('IMPORT_PRIVATE_BACKUP', { passphrase: pass, blob });
      if (!res?.ok) return alert('Échec d’import: ' + (res?.error || 'inconnu'));
      alert('Clés importées avec succès.');
      await refresh();
    } catch (e) {
      alert('Fichier invalide: ' + (e?.message || 'inconnu'));
    }
  });

  // Config export/import (override)
  $('exportCfg')?.addEventListener('click', async () => {
    const url = chrome.runtime.getURL("config.json");
    const txt = await (await fetch(url)).text().catch(()=>null);
    if (!txt) return alert('Impossible de lire config.json');
    const blob = new Blob([txt], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importCfg')?.addEventListener('click', async () => {
    const file = $('cfgFile')?.files?.[0];
    if (!file) return alert('Choisissez un fichier.');
    const txt = await file.text();
    try {
      const json = JSON.parse(txt);
      await chrome.storage.local.set({ configOverride: json });
      alert('Config importée (override stocké). Recharger les pages cibles.');
    } catch { alert('JSON invalide.'); }
  });
});

// mettre à jour l’UI si les prefs changent ailleurs
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.prefs?.newValue) {
    const p = changes.prefs.newValue;
    if ($('lockPos')) $('lockPos').value = p.lockIconPosition || 'bottom-right';
  }
});
