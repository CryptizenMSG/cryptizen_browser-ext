
// utils.js - helpers (base64url, buffers, logging, DOM)
(function(){
  const u8 = (arr) => new Uint8Array(arr);
  const toHex = (buf) => Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  const b64 = {
    encode: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
    decode: (str) => new Uint8Array(atob(str).split('').map(c=>c.charCodeAt(0))).buffer
  };
  const b64url = {
    encode: (buf) => b64.encode(buf).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''),
    decode: (str) => {
      str = str.replace(/-/g,'+').replace(/_/g,'/'); const pad = str.length % 4;
      if (pad) str += '='.repeat(4-pad); return b64.decode(str);
    }
  };
  const enc = {
    te: new TextEncoder(),
    td: new TextDecoder(),
    encode: (s)=> enc.te.encode(s),
    decode: (b)=> enc.td.decode(b)
  };
  const sha256 = async (data) => {
    const buf = typeof data === 'string' ? enc.encode(data) : data;
    return await crypto.subtle.digest('SHA-256', buf);
  };
  const uuid = () => crypto.randomUUID ? crypto.randomUUID() : ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
  const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
  const safeJSON = {
    parse: (s)=>{ try { return JSON.parse(s); } catch(e){ return null; } },
    stringify: (o)=> { try { return JSON.stringify(o); } catch(e){ return null; } }
  };
  const selector = (root, sel) => {
    try { return root.querySelector(sel); } catch(e){ return null; }
  };
  const selectAll = (root, sel) => {
    try { return Array.from(root.querySelectorAll(sel)); } catch(e){ return []; }
  };
  const log = (...args) => {
    chrome.storage?.local.get({prefs:{debug:false}}).then(({prefs}) => {
      if(prefs.debug) console.log('[Cryptizen]', ...args);
    });
  };

  const fingerprintShort = async (pubBundle) => {
    const s = JSON.stringify(pubBundle);
    const h = await sha256(s);
    const arr = new Uint8Array(h);
    const code = Array.from(arr.slice(0,5)).map(b=>b.toString(16).padStart(2,'0')).join(':');
    const pin = ( (arr[0]<<24 | arr[1]<<16 | arr[2]<<8 | arr[3]) >>> 0 ) % 1000000;
    return {hex: code, pin: pin.toString().padStart(6,'0')};
  };

  window.CryptUtils = { u8, toHex, b64, b64url, enc, sha256, uuid, sleep, safeJSON, selector, selectAll, log, fingerprintShort };
})();
