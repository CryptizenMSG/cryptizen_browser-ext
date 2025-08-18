// secure_storage.js — chiffrement au repos des clés privées (MV3 + ESM)
/* global crypto, indexedDB, chrome */

const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToArr(u8) { return Array.from(u8 instanceof Uint8Array ? u8 : new Uint8Array(u8)); }
export function arrToBytes(arr) { return new Uint8Array(arr || []); }

async function stGet(keys) { try { return await chrome.storage.local.get(keys); } catch { return {}; } }
async function stSet(obj) { try { await chrome.storage.local.set(obj); } catch {} }

// ---------- MODE "pass" ----------
export async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  return { key, salt };
}
export async function encryptPrivateKey(plaintext, passphrase) {
  const { key, salt } = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(plaintext));
  return { v: 1, mode: "pass", salt: bytesToArr(salt), iv: bytesToArr(iv), ct: bytesToArr(new Uint8Array(ct)) };
}
export async function decryptPrivateKey(blob, passphrase) {
  const salt = arrToBytes(blob.salt);
  const iv = arrToBytes(blob.iv);
  const ct = arrToBytes(blob.ct);
  const { key } = await deriveKey(passphrase, salt);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return td.decode(pt);
}

// ---------- MODE "device" (clé AES non-extractible persistée) ----------
let _deviceKeyPromise = null;

async function openDB() {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open("cryptizen-db", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kek")) db.createObjectStore("kek", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}
async function idbGet(store, key) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const st = tx.objectStore(store);
    const g = st.get(key);
    g.onsuccess = () => resolve(g.result || null);
    g.onerror = () => reject(g.error || new Error("IDB get failed"));
  });
}
async function idbPut(store, value) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const st = tx.objectStore(store);
      const p = st.put(value);
      p.onsuccess = () => resolve(true);
      p.onerror = () => reject(p.error || new Error("IDB put failed"));
    });
  } catch {}
  return true;
}

export async function getDeviceKey() {
  if (_deviceKeyPromise) return _deviceKeyPromise;
  _deviceKeyPromise = (async () => {
    const rec = await idbGet("kek", "device");
    if (rec && rec.key) return rec.key;

    const { deviceKEK } = await stGet(["deviceKEK"]);
    if (deviceKEK) {
      const key = await crypto.subtle.importKey("jwk", deviceKEK, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
      await idbPut("kek", { id: "device", key });
      return key;
    }

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await idbPut("kek", { id: "device", key });
    try {
      const jwk = await crypto.subtle.exportKey("jwk", key);
      await stSet({ deviceKEK: jwk });
    } catch {}
    return key;
  })();
  return _deviceKeyPromise;
}
export async function deviceEncryptPrivateKey(plaintext) {
  const key = await getDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(plaintext));
  return { v: 1, mode: "device", iv: bytesToArr(iv), ct: bytesToArr(new Uint8Array(ct)) };
}
export async function deviceDecryptPrivateKey(blob) {
  const key = await getDeviceKey();
  const iv = arrToBytes(blob.iv);
  const ct = arrToBytes(blob.ct);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return td.decode(pt);
}
