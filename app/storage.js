/*
 * BAC QUEST — storage.js
 * --------------------------------------------------------------
 * Everything about KEEPING your data safe:
 *   1. Main save in this browser (localStorage), checked after every write.
 *   2. Automatic snapshots (one per day + before updates/restores) you can roll back to.
 *   3. Your old v1 save is never touched or deleted — it stays as a permanent fallback.
 *   4. Damaged data is copied aside instead of being overwritten.
 *   5. Optional: a backup file on your disk that is updated after every change
 *      (needs a browser that supports the File System Access API, and your permission).
 */
(function () {
  'use strict';
  const C = window.BQCore;

  const KEY = 'bacQuest.v3.state';
  const LEGACY_KEY = 'bacQuestV1';                       // written by earlier versions; never modified here
  const LEGACY_COPY = 'bacQuest.v1.copyBeforeMigration'; // extra copy made once, just in case
  const SNAP_KEY = 'bacQuest.v3.snapshots';
  const PREV_KEY = 'bacQuest.v3.prev';                  // the save before the latest one (rolling safety copy)
  const CORRUPT_PREFIX = 'bacQuest.corrupt.';
  const MAX_SNAPSHOTS = 12;
  const AUTO_SNAPSHOT_HOURS = 20;

  const status = {
    memoryOnly: false,            // true if the browser refuses to give us storage at all
    local: 'unknown',             // 'ok' | 'error' | 'unknown'
    localError: null,
    lastSavedAt: null,
    persist: 'unknown',           // 'granted' | 'not-granted' | 'unsupported'
    file: { supported: false, state: 'none', name: '', lastWriteAt: null, error: null, pendingNewer: null }
    // file.state: 'none' | 'ok' | 'needs-permission' | 'error'
  };
  const listeners = [];
  const emit = () => listeners.forEach((f) => { try { f(status); } catch (e) { console.error(e); } });

  /* ----------------------------------------------------------- raw access */
  function readKey(k) {
    try { return localStorage.getItem(k); }
    catch (e) { status.memoryOnly = true; status.local = 'error'; status.localError = String(e && e.message || e); return null; }
  }
  function looksLikeState(o) { return C.isObj(o) && Array.isArray(o.tasks) && C.isObj(o.completions); }
  function tryParse(raw) {
    try { const o = JSON.parse(raw); return looksLikeState(o) ? o : null; } catch (e) { return null; }
  }
  // Keep a copy of data we could not use, so nothing is ever silently thrown away.
  function stashCorrupt(raw, label) {
    if (!raw) return;
    const k = CORRUPT_PREFIX + (label || 'unreadable') + '.' + Date.now();
    try {
      localStorage.setItem(k, raw);
      const all = Object.keys(localStorage).filter((x) => x.indexOf(CORRUPT_PREFIX) === 0).sort();
      while (all.length > 4) localStorage.removeItem(all.shift());
    } catch (e) { /* quota: nothing more we can do */ }
  }

  /* ------------------------------------------------------------ snapshots */
  function readSnaps() {
    try { const a = JSON.parse(localStorage.getItem(SNAP_KEY) || '[]'); return Array.isArray(a) ? a.filter((s) => s && typeof s.data === 'string' && s.at) : []; }
    catch (e) { return []; }
  }
  function writeSnaps(list) {
    for (;;) {
      try { localStorage.setItem(SNAP_KEY, JSON.stringify(list)); return true; }
      catch (e) { if (list.length <= 1) return false; list = list.slice(0, -1); }   // storage full: drop the oldest
    }
  }
  function addSnapshot(json, reason) {
    try {
      const list = readSnaps();
      if (list[0] && list[0].data === json) return false;                           // nothing new
      const obj = tryParse(json); if (!obj) return false;
      const summary = C.summarizeState(C.normalizeState(obj).state);
      list.unshift({ at: new Date().toISOString(), reason: reason, summary: summary, data: json });
      return writeSnaps(list.slice(0, MAX_SNAPSHOTS));
    } catch (e) { return false; }
  }
  function maybeAutoSnapshot(json) {
    const last = readSnaps()[0];
    if (!last || Date.now() - Date.parse(last.at) > AUTO_SNAPSHOT_HOURS * 3600000) addSnapshot(json, 'Automatic daily snapshot');
  }
  const listSnapshots = () => readSnaps().map((s, i) => ({ index: i, at: s.at, reason: s.reason, summary: s.summary }));
  function getSnapshotState(index) {
    const s = readSnaps()[index]; if (!s) return null;
    const o = tryParse(s.data); return o ? C.normalizeState(o).state : null;
  }

  /* ----------------------------------------------------------- load / save */
  function load() {
    const info = { source: 'fresh', warnings: [], notices: [], recoveredFrom: null };
    let state = null;
    const raw = readKey(KEY);

    if (raw) {
      const obj = tryParse(raw);
      if (obj) {
        const r = C.normalizeState(obj);
        state = r.state; info.source = 'saved'; info.warnings = r.warnings;
        if (r.warnings.length) { stashCorrupt(raw, 'repaired'); info.notices.push('Some unreadable entries were skipped. The original data was kept as a safety copy in this browser.'); }
        if (obj.meta && obj.meta.lastRunVersion !== C.APP_VERSION) addSnapshot(raw, 'Before updating to version ' + C.APP_VERSION);
      } else {
        stashCorrupt(raw, 'unreadable');
        info.notices.push('Your saved data could not be read, so a safety copy was kept and BAC QUEST looked for a snapshot to recover from.');
      }
    }
    if (!state) {                                       // recover: first the rolling previous save, then the newest readable snapshot
      const prevObj = tryParse(readKey(PREV_KEY));
      if (prevObj) { state = C.normalizeState(prevObj).state; info.source = 'snapshot'; info.recoveredFrom = state.meta.updatedAt; }
    }
    if (!state) {
      const snaps = readSnaps();
      for (let i = 0; i < snaps.length && !state; i++) {
        const o = tryParse(snaps[i].data);
        if (o) { state = C.normalizeState(o).state; info.source = 'snapshot'; info.recoveredFrom = snaps[i].at; }
      }
    }
    if (!state) {                                       // upgrade from the original app (key bacQuestV1)
      const rawV1 = readKey(LEGACY_KEY);
      if (rawV1) {
        const o = tryParse(rawV1);
        if (o) {
          try { if (localStorage.getItem(LEGACY_COPY) === null) localStorage.setItem(LEGACY_COPY, rawV1); } catch (e) { /* ignore */ }
          const r = C.normalizeState(o);
          state = r.state; state.meta.migratedFrom = 1; info.source = 'migrated'; info.warnings = r.warnings;
        } else { stashCorrupt(rawV1, 'v1-unreadable'); info.notices.push('Your older BAC QUEST save could not be read. A copy was kept; you can restore a backup file instead.'); }
      }
    }
    if (!state) state = C.createFreshState(C.nowInfo().dateKey);

    const versionChanged = state.meta.lastRunVersion !== C.APP_VERSION;
    state.meta.lastRunVersion = C.APP_VERSION;
    info.needsSave = info.source !== 'saved' || versionChanged || info.warnings.length > 0;
    return { state: state, info: info };
  }

  function save(state) {
    state.meta.updatedAt = new Date().toISOString();
    state.meta.revision = (state.meta.revision || 0) + 1;
    const json = JSON.stringify(state);
    if (status.memoryOnly) { status.local = 'error'; emit(); return { ok: false, error: new Error(status.localError || 'Storage unavailable') }; }
    try {
      const before = localStorage.getItem(KEY);
      if (before && tryParse(before)) { try { localStorage.setItem(PREV_KEY, before); } catch (e) { /* ignore: only a bonus copy */ } }
      localStorage.setItem(KEY, json);
      if (localStorage.getItem(KEY) !== json) throw new Error('The browser did not keep what we wrote.');
      status.local = 'ok'; status.localError = null; status.lastSavedAt = Date.now();
      maybeAutoSnapshot(json);
      scheduleFileWrite();
      emit();
      return { ok: true };
    } catch (e) {
      status.local = 'error'; status.localError = String(e && e.message || e);
      emit();
      return { ok: false, error: e };
    }
  }

  // Another tab or window of BAC QUEST saved something: adopt it so tabs never overwrite each other.
  function onExternalChange(cb, currentRevision) {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY || !e.newValue) return;
      const obj = tryParse(e.newValue); if (!obj) return;
      const st = C.normalizeState(obj).state;
      if (st.meta.revision > currentRevision()) cb(st);
    });
  }

  async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) { status.persist = 'unsupported'; emit(); return; }
    try {
      let ok = await navigator.storage.persisted();
      if (!ok) ok = await navigator.storage.persist();
      status.persist = ok ? 'granted' : 'not-granted';
    } catch (e) { status.persist = 'unsupported'; }
    emit();
  }

  /* --------------------------------------------- linked backup file (optional) */
  let fileHandle = null, fileTimer = null, getState = () => null, fileHold = false;
  const fileSupported = () => typeof window.showSaveFilePicker === 'function';

  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('bacQuestFiles', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('handles');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbOp(mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('handles', mode), rq = fn(t.objectStore('handles')); t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error); });
  }

  async function inspectLinkedFile() {
    try {
      const text = await (await fileHandle.getFile()).text();
      if (!text.trim()) return null;
      const r = C.parseBackup(text);
      if (!r.ok) return { unreadable: true, error: r.error };
      return { parsed: r, newer: r.state.meta.updatedAt > getState().meta.updatedAt };
    } catch (e) { return null; }
  }

  async function initFile(getStateFn) {
    getState = getStateFn;
    status.file.supported = fileSupported();
    if (!status.file.supported) { emit(); return; }
    try { fileHandle = (await idbOp('readonly', (s) => s.get('backupFile'))) || null; } catch (e) { fileHandle = null; }
    if (fileHandle) {
      status.file.name = fileHandle.name;
      try {
        const p = await fileHandle.queryPermission({ mode: 'readwrite' });
        status.file.state = p === 'granted' ? 'ok' : 'needs-permission';
      } catch (e) { status.file.state = 'needs-permission'; }
      if (status.file.state === 'ok') await checkNewer();
      else fileHold = true;                              // do not write until we have permission and have checked the file
    }
    emit();
  }

  // Never overwrite a linked file that holds NEWER data than this browser (for example after clearing site data).
  async function checkNewer() {
    fileHold = true;
    const r = await inspectLinkedFile();
    if (r && r.newer) { status.file.pendingNewer = r.parsed; }
    else { status.file.pendingNewer = null; fileHold = false; scheduleFileWrite(); }
  }
  function resolveNewer() { status.file.pendingNewer = null; fileHold = false; emit(); }

  async function linkFile() {
    if (!fileSupported()) return { ok: false, reason: 'unsupported' };
    let h;
    try {
      h = await window.showSaveFilePicker({ suggestedName: 'bac-quest-autosave.json', types: [{ description: 'BAC QUEST backup (JSON)', accept: { 'application/json': ['.json'] } }] });
    } catch (e) { return { ok: false, reason: e && e.name === 'AbortError' ? 'cancelled' : 'error', error: e }; }
    fileHandle = h;
    try { await idbOp('readwrite', (s) => s.put(h, 'backupFile')); } catch (e) { /* link still works for this session */ }
    status.file.name = h.name; status.file.state = 'ok'; status.file.error = null; status.file.pendingNewer = null; fileHold = false;
    return writeFileNow(true);
  }
  async function writeFileNow(force) {
    if (!fileHandle || (fileHold && !force)) return { ok: false, reason: 'held' };
    try {
      if ((await fileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') { status.file.state = 'needs-permission'; emit(); return { ok: false, reason: 'permission' }; }
      const w = await fileHandle.createWritable();
      await w.write(C.buildBackup(getState()));
      await w.close();
      status.file.state = 'ok'; status.file.lastWriteAt = Date.now(); status.file.error = null; emit();
      return { ok: true };
    } catch (e) {
      status.file.state = 'error'; status.file.error = String(e && e.message || e); emit();
      return { ok: false, reason: 'error', error: e };
    }
  }
  function scheduleFileWrite() {
    if (!fileHandle || status.file.state !== 'ok' || fileHold) return;
    clearTimeout(fileTimer);
    fileTimer = setTimeout(() => { fileTimer = null; writeFileNow(); }, 1500);
  }
  function flushFile() { if (fileTimer) { clearTimeout(fileTimer); fileTimer = null; writeFileNow(); } }
  async function reconnectFile() {            // must be called from a click
    if (!fileHandle) return { ok: false, reason: 'nolink' };
    try {
      if ((await fileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') return { ok: false, reason: 'denied' };
    } catch (e) { return { ok: false, reason: 'error', error: e }; }
    status.file.state = 'ok'; status.file.error = null;
    await checkNewer(); emit();
    return { ok: true, pendingNewer: status.file.pendingNewer };
  }
  async function unlinkFile() {
    clearTimeout(fileTimer); fileHandle = null; fileHold = false;
    try { await idbOp('readwrite', (s) => s.delete('backupFile')); } catch (e) { /* ignore */ }
    status.file = { supported: status.file.supported, state: 'none', name: '', lastWriteAt: null, error: null, pendingNewer: null };
    emit();
  }

  /* ------------------------------------------------------------- download */
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  window.addEventListener('pagehide', flushFile);

  window.BQStore = {
    KEY, LEGACY_KEY, status, load, save, onExternalChange, requestPersistence,
    addSnapshot, listSnapshots, getSnapshotState,
    initFile, linkFile, writeFileNow, flushFile, reconnectFile, unlinkFile, resolveNewer, download,
    subscribe: (f) => { listeners.push(f); }
  };
})();
