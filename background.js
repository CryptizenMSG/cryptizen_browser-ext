// background.js (MV3 module) — clés, chiffrement, routage, commandes & backup
import {
  encryptPrivateKey,
  decryptPrivateKey,
  deviceEncryptPrivateKey,
  deviceDecryptPrivateKey
} from "./secure_storage.js";

const state = {
  keysReady: false,
  passphrase: null
};

const DEFAULT_PREFS = {
  autoEncrypt: true,
  autoDecrypt: true,
  clickToDecrypt: false,
  signMessages: true,
  prefix: "CRYPTIZEN|",
  invitePrefix: "CRYPTIZEN.ORG|",
  debug: false,
  allowUnknownDomains: false,
  lockIconPosition: "bottom-right" // top-left | top-right | bottom-right | bottom-left
};

async function getPrefs() {
  const { prefs } = await chrome.storage.local.get({ prefs: DEFAULT_PREFS });
  return Object.assign({}, DEFAULT_PREFS, prefs || {});
}
async function setPrefs(p) {
  const current = await getPrefs();
  const next = Object.assign({}, current, p || {});
  await chrome.storage.local.set({ prefs: next });
  return next;
}

// ---------- Utilitaires crypto ----------
const te = new TextEncoder();
const td = new TextDecoder();

async function generateEncKeyPair() {
  return await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["encrypt", "decrypt"]
  );
}
async function generateSigKeyPair() {
  return await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
}
async function exportJwk(key) { return await crypto.subtle.exportKey("jwk", key); }
async function importKey(alg, jwk, usages) { return await crypto.subtle.importKey("jwk", jwk, alg, true, usages); }

const b64 = {
  encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  decode: (str) => new Uint8Array(atob(str).split("").map((c) => c.charCodeAt(0))).buffer
};
const b64url = {
  encode: (buf) => b64.encode(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  decode: (str) => {
    str = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = str.length % 4;
    if (pad) str += "=".repeat(4 - pad);
    return b64.decode(str);
  }
};
async function sha256Bytes(data) {
  const buf = typeof data === "string" ? te.encode(data) : data;
  return await crypto.subtle.digest("SHA-256", buf);
}
async function fingerprint(pubEncJwk, pubSigJwk) {
  const merged = JSON.stringify({ pubEncJwk, pubSigJwk });
  const h = await sha256Bytes(merged);
  const arr = new Uint8Array(h);
  const hex = Array.from(arr.slice(0, 6)).map((b) => b.toString(16).padStart(2, "0")).join(":");
  const pin = (((arr[0] << 24) | (arr[1] << 16) | (arr[2] << 8) | arr[3]) >>> 0) % 1000000;
  return { hex, pin: pin.toString().padStart(6, "0") };
}
function concatBufs(...arrs) {
  const total = arrs.reduce((n, b) => n + (b.byteLength || b.length || 0), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of arrs) { const u = new Uint8Array(b); out.set(u, off); off += u.byteLength; }
  return out.buffer;
}

// ---------- Stockage des privées ----------
async function persistPrivates(privEncJwk, privSigJwk) {
  const blob = await deviceEncryptPrivateKey(JSON.stringify({ myEncPriv: privEncJwk, mySigPriv: privSigJwk }));
  await chrome.storage.local.set({ deviceEncryptedPrivateKey: blob, keyMode: "device" });
}
async function rewrapToPassphrase(passphrase) {
  const { deviceEncryptedPrivateKey, encryptedPrivateKey } = await chrome.storage.local.get([
    "deviceEncryptedPrivateKey",
    "encryptedPrivateKey"
  ]);
  if (encryptedPrivateKey) return true;
  if (!deviceEncryptedPrivateKey) return false;
  const json = await deviceDecryptPrivateKey(deviceEncryptedPrivateKey);
  const blob = await encryptPrivateKey(json, passphrase);
  await chrome.storage.local.set({ encryptedPrivateKey: blob, keyMode: "pass" });
  return true;
}
async function loadPrivates() {
  const { encryptedPrivateKey, deviceEncryptedPrivateKey, keyMode } = await chrome.storage.local.get([
    "encryptedPrivateKey",
    "deviceEncryptedPrivateKey",
    "keyMode"
  ]);

  if (keyMode === "pass" || state.passphrase) {
    if (!encryptedPrivateKey) return null;
    try {
      const json = await decryptPrivateKey(encryptedPrivateKey, state.passphrase || "");
      return JSON.parse(json);
    } catch (e) {
      throw new Error(state.passphrase ? "BAD_PASSPHRASE" : "NEED_PASSPHRASE");
    }
  }
  if (deviceEncryptedPrivateKey) {
    const json = await deviceDecryptPrivateKey(deviceEncryptedPrivateKey);
    return JSON.parse(json);
  }
  return null;
}

async function ensureKeys() {
  const store = await chrome.storage.local.get(["keyring", "encryptedPrivateKey", "deviceEncryptedPrivateKey", "keyMode"]);
  let keyring = store.keyring;

  // migration
  if (keyring?.myEncPriv && keyring?.mySigPriv) {
    await persistPrivates(keyring.myEncPriv, keyring.mySigPriv);
    const { myEncPriv, mySigPriv, ...pubOnly } = keyring;
    await chrome.storage.local.set({ keyring: pubOnly });
    keyring = pubOnly;
  }

  if (!keyring?.myEncPub || !keyring?.mySigPub) {
    const encPair = await generateEncKeyPair();
    const sigPair = await generateSigKeyPair();
    const pubEnc = await exportJwk(encPair.publicKey);
    const privEnc = await exportJwk(encPair.privateKey);
    const pubSig = await exportJwk(sigPair.publicKey);
    const privSig = await exportJwk(sigPair.privateKey);
    const fp = await fingerprint(pubEnc, pubSig);
    const pubKeyring = { myEncPub: pubEnc, mySigPub: pubSig, myFingerprint: fp };
    await chrome.storage.local.set({ keyring: pubKeyring });

    if (state.passphrase) {
      const blob = await encryptPrivateKey(JSON.stringify({ myEncPriv: privEnc, mySigPriv: privSig }), state.passphrase);
      await chrome.storage.local.set({ encryptedPrivateKey: blob, keyMode: "pass" });
    } else {
      await persistPrivates(privEnc, privSig);
    }
    state.keysReady = true;
    return Object.assign({}, pubKeyring, { myEncPriv: privEnc, mySigPriv: privSig });
  }

  try {
    const privs = await loadPrivates();
    state.keysReady = true;
    return Object.assign({}, keyring, privs || {});
  } catch (e) {
    state.keysReady = true;
    return keyring;
  }
}
async function getKeyring() {
  const { keyring } = await chrome.storage.local.get(["keyring"]);
  if (!keyring) return await ensureKeys();
  try {
    const privs = await loadPrivates();
    return Object.assign({}, keyring, privs || {});
  } catch {
    return keyring;
  }
}

// ---------- Contacts ----------
async function importContact(contact) {
  const c = Object.assign({ verified: false, createdAt: Date.now(), lastSeen: Date.now() }, contact);
  const { contacts = [] } = await chrome.storage.local.get(["contacts"]);
  const idx = contacts.findIndex((x) => x.id === c.id || (x.domain === c.domain && x.conversationId === c.conversationId));
  if (idx >= 0) contacts[idx] = Object.assign(contacts[idx], c);
  else contacts.push(c);
  await chrome.storage.local.set({ contacts });
  return c;
}
async function getContacts() {
  const { contacts = [] } = await chrome.storage.local.get(["contacts"]);
  return contacts;
}
async function exportPublicBundle() {
  // ⬅️ corrige “impossible d’exporter la clé publique”
  const kr = await ensureKeys();
  return { enc: kr.myEncPub, sig: kr.mySigPub, fp: kr.myFingerprint };
}

// ---------- Payload crypto ----------
async function encryptFor(recipientPubEncJwk, selfPubEncJwk, senderPrivSigJwk, plaintext) {
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = typeof plaintext === "string" ? te.encode(plaintext) : plaintext;
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, data);

  const rawAes = await crypto.subtle.exportKey("raw", aesKey);

  const recipPub = await importKey({ name: "RSA-OAEP", hash: "SHA-256" }, recipientPubEncJwk, ["encrypt"]);
  const ek = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipPub, rawAes);

  const selfPub = await importKey({ name: "RSA-OAEP", hash: "SHA-256" }, selfPubEncJwk, ["encrypt"]);
  const ekSelf = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, selfPub, rawAes);

  const hash = await sha256Bytes(data);
  let sig = null;
  if ((await getPrefs()).signMessages && senderPrivSigJwk) {
    const priv = await importKey({ name: "RSA-PSS", hash: "SHA-256" }, senderPrivSigJwk, ["sign"]);
    sig = await crypto.subtle.sign({ name: "RSA-PSS", saltLength: 32 }, priv, concatBufs(iv.buffer, ct, hash));
  }
  return {
    v: 1, t: "msg",
    iv: b64url.encode(iv),
    ct: b64url.encode(ct),
    ek: b64url.encode(ek),
    ekSelf: b64url.encode(ekSelf),
    hash: b64url.encode(hash),
    sig: sig ? b64url.encode(sig) : null,
    alg: { sym: "AES-GCM-256", kdf: "raw", wrap: "RSA-OAEP-2048+", sig: "RSA-PSS-3072", hash: "SHA-256" },
    time: Date.now()
  };
}
async function decryptFrom(myPrivEncJwk, senderPubSigJwk, payload) {
  const iv = new Uint8Array(b64url.decode(payload.iv));
  const ct = b64url.decode(payload.ct);
  const priv = await importKey({ name: "RSA-OAEP", hash: "SHA-256" }, myPrivEncJwk, ["decrypt"]);

  let rawAes; let lastErr = null;
  const candidates = [];
  if (payload.ekSelf) candidates.push(payload.ekSelf);
  if (payload.ek) candidates.push(payload.ek);
  for (const w of candidates) {
    try {
      rawAes = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, priv, b64url.decode(w));
      lastErr = null;
      break;
    } catch (e) { lastErr = e; }
  }
  if (!rawAes) throw lastErr || new Error("DECRYPT_FAIL");

  const aesKey = await crypto.subtle.importKey("raw", rawAes, { name: "AES-GCM" }, false, ["decrypt"]);
  const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);

  const hash = await sha256Bytes(data);
  const hashOk = b64url.encode(hash) === (payload.hash || "");
  let sigOk = null;
  if (payload.sig && senderPubSigJwk) {
    const pub = await importKey({ name: "RSA-PSS", hash: "SHA-256" }, senderPubSigJwk, ["verify"]);
    sigOk = await crypto.subtle.verify(
      { name: "RSA-PSS", saltLength: 32 },
      pub,
      new Uint8Array(b64url.decode(payload.sig)),
      concatBufs(iv.buffer, ct, new Uint8Array(b64url.decode(payload.hash)))
    );
  }
  return { plaintext: td.decode(new Uint8Array(data)), hashOk, sigOk };
}
function buildBundle(prefix, obj) {
  const json = JSON.stringify(obj);
  const buf = new TextEncoder().encode(json);
  return `${prefix}${b64url.encode(buf)}`;
}
function parseBundle(prefix, str) {
  if (!str || typeof str !== "string") return null;
  if (!str.startsWith(prefix)) return null;
  const body = str.slice(prefix.length);
  try {
    const buf = b64url.decode(body);
    const json = new TextDecoder().decode(new Uint8Array(buf));
    return JSON.parse(json);
  } catch (e) { return null; }
}

// ---------- Raccourci clavier (chrome://extensions/shortcuts)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "encrypt-current-message" && tab?.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.CM?.encryptCurrentInput && window.CM.encryptCurrentInput()
    });
  }
});

// ---------- Messaging ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "SET_PASSPHRASE": {
          state.passphrase = msg.passphrase || null;
          if (state.passphrase) {
            await rewrapToPassphrase(state.passphrase);
          } else {
            const kr = await getKeyring();
            if (kr.myEncPriv && kr.mySigPriv) await persistPrivates(kr.myEncPriv, kr.mySigPriv);
            await chrome.storage.local.set({ keyMode: "device" });
          }
          sendResponse({ ok: true }); break;
        }

        case "GET_PREFS": { sendResponse({ ok: true, prefs: await getPrefs() }); break; }
        
        case "SET_PREFS": {
          const incoming = (msg && typeof msg === "object" && "payload" in msg)
            ? (msg.payload || {})
            : (() => {
                const { type, ...rest } = (msg || {});
                return rest;
              })();

          const prefs = await setPrefs(incoming);
          sendResponse({ ok: true, prefs });
          break;
        }

        case "ENSURE_KEYS": { sendResponse({ ok: true, keyring: await ensureKeys() }); break; }

        case "GET_STATE": {
          const kr = await ensureKeys();
          const contacts = await getContacts();
          const prefs = await getPrefs();
          sendResponse({ ok: true, keyring: { myFingerprint: kr.myFingerprint }, contacts, prefs });
          break;
        }

        case "EXPORT_PUBLIC": {
          const bundle = await exportPublicBundle();
          sendResponse({ ok: true, bundle });
          break;
        }
        case "SAVE_CONTACT": { sendResponse({ ok: true, contact: await importContact(msg.contact) }); break; }

        // --- Export/Import sécurisé (appelé par Options)
        case "EXPORT_PRIVATE_BACKUP": {
          const kr = await getKeyring();
          if (!kr.myEncPriv || !kr.mySigPriv) { sendResponse({ ok: false, error: "NO_PRIVATE_KEYS" }); break; }
          const blob = await encryptPrivateKey(JSON.stringify({ myEncPriv: kr.myEncPriv, mySigPriv: kr.mySigPriv }), msg.passphrase || "");
          sendResponse({ ok: true, blob }); break;
        }
        case "IMPORT_PRIVATE_BACKUP": {
          try {
            const json = await decryptPrivateKey(msg.blob, msg.passphrase || "");
            const { myEncPriv, mySigPriv } = JSON.parse(json);
            await persistPrivates(myEncPriv, mySigPriv);
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || "IMPORT_FAIL" });
          }
          break;
        }

        case "ENCRYPT_FOR": {
          const { toPubEncJwk, plaintext } = msg;
          let kr = await ensureKeys();
          if (!kr.myEncPriv || !kr.mySigPriv) {
            sendResponse({ ok: false, error: "NO_PRIVATE_KEYS" });
            break;
          }
          const payload = await encryptFor(toPubEncJwk, kr.myEncPub, kr.mySigPriv, plaintext);
          payload.from = kr.myFingerprint;
          payload.meta = { origin: msg.meta || null };
          const final = buildBundle((await getPrefs()).prefix, payload);
          sendResponse({ ok: true, bundle: final, payload });
          break;
        }

        case "DECRYPT_BUNDLE": {
          const pref = (await getPrefs()).prefix;
          const bundle = parseBundle(pref, msg.bundle);
          if (!bundle) { sendResponse({ ok: false, error: "Not a Cryptizen bundle" }); break; }

          const kr = await ensureKeys();
          if (!kr.myEncPriv) {
            const { keyMode } = await chrome.storage.local.get("keyMode");
            if (keyMode === "pass" && !state.passphrase) { sendResponse({ ok: false, error: "NEED_PASSPHRASE" }); break; }
            sendResponse({ ok: false, error: "NO_PRIVATE_KEYS" }); break;
          }

          try {
            const res = await decryptFrom(kr.myEncPriv, msg.senderPubSigJwk || null, bundle);
            sendResponse({ ok: true, result: res, payload: bundle });
          } catch (e) {
            const name = e?.name || "";
            if (name === "OperationError") sendResponse({ ok: false, error: "DECRYPT_FAIL" });
            else sendResponse({ ok: false, error: e?.message || "DECRYPT_FAIL" });
          }
          break;
        }

        case "PARSE_BUNDLE": {
          const b = (m => {
            try { return m && JSON.parse(new TextDecoder().decode(new Uint8Array(b64url.decode(m.slice((getPrefs().prefix||"").length))))); }
            catch { return null; }
          })(msg.bundle);
          sendResponse({ ok: !!b, payload: b });
          break;
        }

        default:
          sendResponse({ ok: false, error: "Unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true;
});
