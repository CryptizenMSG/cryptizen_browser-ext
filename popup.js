
async function send(type, payload) {
  return await chrome.runtime.sendMessage(Object.assign({type}, payload||{}));
}

function el(id) { return document.getElementById(id); }

async function refresh() {
  const st = await send("GET_STATE");
  if (!st?.ok) return;
  const k = st.keyring;
  el('keysState').innerHTML = `
    <div>Empreinte: <code>${k.myFingerprint.hex}</code></div>
    <div>Code: <b>${k.myFingerprint.pin}</b></div>
  `;
  const prefs = st.prefs;
  el('autoEnc').checked = !!prefs.autoEncrypt;
  el('autoDec').checked = !!prefs.autoDecrypt;
  el('clickDec').checked = !!prefs.clickToDecrypt;
  el('signMsg').checked = !!prefs.signMessages;
  el('prefix').value = prefs.prefix || "CRYPTIZEN|";
}

document.addEventListener('DOMContentLoaded', async () => {
  await send("ENSURE_KEYS");
  await refresh();

  el('regenKeys').addEventListener('click', async () => {
    if (!confirm("Régénérer de nouvelles clés ? (Cela invalidera d’anciens échanges si vous n’informez pas vos contacts)")) return;
    await chrome.storage.local.remove(['keyring']);
    await send("ENSURE_KEYS");
    await refresh();
  });

  el('exportPub').addEventListener('click', async () => {
    const res = await send("EXPORT_PUBLIC");
    if (!res?.ok) return alert("Erreur");
    const txt = JSON.stringify(res.bundle, null, 2);
    await navigator.clipboard.writeText(txt);
    alert("Clé publique copiée dans le presse-papier.");
  });

  el('savePrefs').addEventListener('click', async () => {
    const payload = {
      autoEncrypt: el('autoEnc').checked,
      autoDecrypt: el('autoDec').checked,
      clickToDecrypt: el('clickDec').checked,
      signMessages: el('signMsg').checked,
      prefix: el('prefix').value || "CRYPTIZEN|"
    };
    
    const res = await send("SET_PREFS", { payload });
    
    if (res?.ok) alert("Préférences sauvegardées.");
  });

  el('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
});

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('setPass');
  if (btn) {
    btn.addEventListener('click', async () => {
      const pass = (document.getElementById('passphrase') || {}).value || '';
      if (!pass) { alert('Merci de saisir un mot de passe.'); return; }
      const res = await send('SET_PASSPHRASE', { passphrase: pass });
      if (res?.ok) alert('Mot de passe enregistré. Vos clés privées seront chiffrées et stockées.');
    });
  }
});
