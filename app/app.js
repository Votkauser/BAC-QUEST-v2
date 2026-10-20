/*
 * BAC QUEST — app.js
 * --------------------------------------------------------------
 * Everything you see and click. It uses core.js for the rules and
 * storage.js for saving. All text from your data is inserted as plain
 * text (never as HTML), so a strange mission name can't break the page.
 */
(() => {
  'use strict';
  const C = window.BQCore, S = window.BQStore;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const fmt = C.formatDuration;
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Tiny helper to build page elements safely: h('div', {class:'x'}, 'text', childNode)
  function h(tag, props) {
    const el = document.createElement(tag);
    Object.keys(props || {}).forEach((k) => {
      const v = props[k];
      if (k.indexOf('aria-') === 0) { if (v != null) el.setAttribute(k, String(v)); return; }
      if (v === false || v == null) return;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  const setKids = (root, kids) => root.replaceChildren(...kids.filter((k) => k != null && k !== false));
  const btn = (label, props, onclick) => h('button', Object.assign({ type: 'button', onclick: onclick }, props), label);

  /* ------------------------------------------------------------------ state */
  let state, loadInfo;
  const ui = { view: 'today', viewDate: null, weekMode: 'board', schoolOpen: true, lastMinute: -1, lastCompleted: null };
  const dismissed = new Set();
  let swReg = null;

  const now = () => C.nowInfo(state.settings);
  const viewKey = () => ui.viewDate || now().dateKey;
  const timeLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dateTimeLabel = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  function daysAgo(iso) { return Math.floor((Date.now() - Date.parse(iso)) / 86400000); }

  // Change something, update XP/achievements, save, redraw.
  function commit(mutator, opts) {
    opts = opts || {};
    const n = now();
    const before = C.computeMetrics(state, n);
    const result = mutator(state);
    const after = C.computeMetrics(state, n);
    const ach = C.syncAchievements(state, after, n.dateKey, false);
    const saved = S.save(state);
    if (!saved.ok) toast('Could not save your change! Download a backup now (Backup button).', { error: true });
    if (opts.message) { const m = opts.message(result); if (m) toast(m); }
    if (opts.celebrate !== false) {
      if (after.level > before.level) toast('LEVEL UP! You are level ' + after.level + ' · ' + after.rank, { gold: true });
      ach.unlocked.forEach((a) => toast('Achievement unlocked: ' + a.name, { gold: true }));
    }
    if (opts.partial) { renderChrome(); } else renderAll();
    return result;
  }
  function replaceState(newState) {
    state = newState;
    const n = now();
    C.syncAchievements(state, C.computeMetrics(state, n), n.dateKey, true);
    state.meta.lastRunVersion = C.APP_VERSION;
    ui.viewDate = null;
    const r = S.save(state);
    renderAll();
    return r;
  }

  /* ------------------------------------------------------------- toasts, fx */
  const toastQueue = []; let toastBusy = false, toastTimer, toastCurrent = null;
  // Errors and Undo toasts show immediately; plain messages replace each other; trophies wait their turn.
  function toast(msg, opts) {
    opts = opts || {};
    const item = Object.assign({ msg: msg }, opts);
    const plainShowing = toastBusy && toastCurrent && !toastCurrent.gold && !toastCurrent.error && !toastCurrent.actionLabel;
    if (opts.error || opts.actionLabel || (plainShowing && !opts.gold)) { toastQueue.unshift(item); nextToast(); }
    else { toastQueue.push(item); if (!toastBusy) nextToast(); }
  }
  function nextToast() {
    clearTimeout(toastTimer);
    const el = $('#toast'), t = toastQueue.shift();
    if (!t) { toastBusy = false; toastCurrent = null; el.classList.add('hidden'); return; }
    toastBusy = true; toastCurrent = t;
    el.className = 'toast' + (t.error ? ' error' : '') + (t.gold ? ' gold' : '');
    el.replaceChildren(...[h('span', {}, t.msg), t.actionLabel ? btn(t.actionLabel, { class: 'toast-action' }, () => { if (t.onAction) t.onAction(); nextToast(); }) : null].filter(Boolean));
    toastTimer = setTimeout(nextToast, t.ms || (t.actionLabel ? 8000 : t.error ? 6000 : t.gold ? 3500 : 3000));
  }
  function floatText(text, rect) {
    if (reduceMotion) return;
    const s = h('span', { class: 'fx-float' }, text);
    s.style.left = (rect ? rect.left + rect.width / 2 : innerWidth / 2) + 'px';
    s.style.top = (rect ? rect.top : innerHeight / 2) + 'px';
    $('#fx').append(s);
    setTimeout(() => s.remove(), 1300);
  }

  // Yes/No dialog that returns a promise.
  function confirmDialog(o) {
    return new Promise((resolve) => {
      const d = $('#confirmDialog'), yes = $('#confirmYes'), no = $('#confirmNo');
      $('#confirmTitle').textContent = o.title;
      $('#confirmBody').replaceChildren(...[].concat(o.body || []).map((x) => (typeof x === 'string' ? h('p', {}, x) : x)));
      yes.textContent = o.yes || 'Confirm';
      yes.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
      const done = (v) => { d.close(); resolve(v); };
      yes.onclick = () => done(true);
      no.onclick = () => done(false);
      d.oncancel = (e) => { e.preventDefault(); done(false); };
      d.showModal();
      no.focus();
    });
  }

  /* ------------------------------------------------------------ reminders */
  const notifSupported = 'Notification' in window;
  const permission = () => (notifSupported ? Notification.permission : 'unsupported');
  const remindersOn = () => state.settings.reminders.enabled && permission() === 'granted';

  function sendNotification(n) {
    const opts = { body: n.body, icon: 'icon-192.png', tag: n.tag || n.title };
    const plain = () => { try { const x = new Notification(n.title, opts); x.onclick = () => { window.focus(); x.close(); }; } catch (e) { console.warn('Notification failed', e); } };
    if (swReg && swReg.showNotification) swReg.showNotification(n.title, opts).catch(plain); else plain();
  }
  async function enableReminders() {
    if (!notifSupported) { toast('This browser does not support notifications. Use the calendar export in Settings instead.', { error: true }); return; }
    let p = Notification.permission;
    if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
    if (p === 'granted') {
      commit((st) => { st.settings.reminders.enabled = true; }, { partial: true, celebrate: false });
      toast('Reminders are on while BAC QUEST is open.');
      sendNotification({ title: 'BAC QUEST reminders are on', body: 'You will be reminded when missions start or run late.', tag: 'bq-welcome' });
      if (ui.view === 'settings') renderSettings();
    } else {
      toast('Notifications are blocked. Click the lock icon next to the address bar, allow Notifications for this site, then try again.', { error: true });
    }
  }
  function disableReminders() {
    commit((st) => { st.settings.reminders.enabled = false; }, { partial: true, celebrate: false });
    toast('Reminders turned off.');
    if (ui.view === 'settings') renderSettings();
  }
  function remindersTick() {
    if (!remindersOn()) return;
    const due = C.dueReminders(state, now());
    if (!due.length) return;
    due.forEach((d) => { sendNotification({ title: d.title, body: d.body, tag: d.key }); state.notified[d.key] = Date.now(); });
    S.save(state);
  }

  /* ------------------------------------------------------ chrome (always on) */
  const VIEW_TITLES = { today: 'Today', week: 'Weekly plan', stats: 'Progress', settings: 'Settings & data' };

  function renderChrome() {
    $('#pageTitle').textContent = VIEW_TITLES[ui.view];
    $('#versionLabel').textContent = 'BAC QUEST v' + C.APP_VERSION;
    // sidebar goal
    const set = state.settings, n = now(), sc = C.scoreStats(state);
    $('#goalGrade').textContent = String(set.targetGrade).replace(/\.0+$/, '');
    const cd = C.examCountdown(set, n);
    $('#goalCountdown').textContent = cd == null ? '2BAC national exam' : cd > 0 ? cd + ' days to the exam' : cd === 0 ? 'Exam day. You are ready.' : 'Exam date has passed';
    $('#goalAvg').textContent = sc.overall == null ? 'No scores logged yet' : 'Your logged average: ' + sc.overall + '/20';
    $('#goalBar').style.width = (sc.overall == null ? 0 : Math.min(100, sc.overall / Math.max(1, set.targetGrade) * 100)) + '%';
    // reminders button
    const nb = $('#notifyBtn'), on = remindersOn();
    $('.btn-text', nb).textContent = on ? 'Reminders on' : 'Reminders';
    nb.classList.toggle('is-on', on);
    nb.setAttribute('aria-pressed', on ? 'true' : 'false');
    renderSaveStatus();
    renderBanners();
    const od = C.overdueToday(state, n).length;
    document.title = (od ? '(' + od + ') ' : '') + 'BAC QUEST';
  }

  function renderSaveStatus() {
    const st = S.status, chip = $('#saveChip'), label = $('#saveStatus');
    let cls = 'ok', text;
    if (st.memoryOnly) { cls = 'err'; text = 'NOT saving'; }
    else if (st.local === 'error') { cls = 'err'; text = 'Save failed'; }
    else if (st.file.state === 'needs-permission') { cls = 'warn'; text = 'Saved · file needs permission'; }
    else if (st.file.state === 'error') { cls = 'warn'; text = 'Saved · file write failed'; }
    else {
      text = st.lastSavedAt ? 'Saved ' + timeLabel(st.lastSavedAt) : 'Saved on this device';
      if (st.file.state === 'ok' && st.file.lastWriteAt) text += ' · file synced';
    }
    chip.className = 'save-chip ' + cls;
    label.textContent = text;
  }

  function renderBanners() {
    const box = $('#banners'), st = S.status, list = [];
    const add = (id, kind, text, actions, dismissible) => { if (!dismissed.has(id)) list.push({ id: id, kind: kind, text: text, actions: actions || [], dismissible: dismissible }); };
    if (st.memoryOnly) add('mem', 'error', 'Your browser is not allowing BAC QUEST to store data (a private window, or storage is blocked). Progress will NOT be kept. Use the Backup button often.', [], false);
    else if (st.local === 'error') add('save', 'error', 'The last save failed. Download a backup now so nothing is lost, then check your browser storage settings.', [{ label: 'Download backup', fn: exportBackup }], false);
    if (st.file.pendingNewer) {
      const s = st.file.pendingNewer.summary;
      add('newer', 'warn', 'Your linked backup file has newer data than this browser (' + s.completions + ' completed missions, ' + s.xp + ' XP). Automatic file saving is paused so nothing is overwritten.', [
        { label: 'Restore from file', fn: () => restoreParsed(st.file.pendingNewer, 'the linked file') },
        { label: 'Keep this browser’s data', fn: () => { S.resolveNewer(); S.writeFileNow(true); renderAll(); } }], false);
    } else if (st.file.state === 'needs-permission') {
      add('fileperm', 'warn', 'Your linked backup file “' + st.file.name + '” needs permission again (browsers ask after a restart).', [{ label: 'Reconnect file', fn: reconnectFile }], true);
    }
    if (loadInfo.source === 'migrated') {
      const s = C.summarizeState(state, now());
      add('migrated', 'ok', 'Upgraded safely: your earlier progress came with you (' + s.tasks + ' missions, ' + s.completions + ' completed missions, ' + s.xp + ' XP). Your old save is still kept untouched as a fallback.', [], true);
    }
    if (loadInfo.source === 'snapshot') add('snap', 'warn', 'Your main save could not be read, so BAC QUEST recovered your data as it was on ' + dateTimeLabel(loadInfo.recoveredFrom) + ' (the last good copy). Please check your recent progress.', [], true);
    loadInfo.notices.forEach((t, i) => add('notice' + i, 'warn', t, [], true));
    if (loadInfo.source === 'fresh') add('welcome', 'info', 'Welcome! Your 15-hour weekly plan is ready. Tick missions off on the Today screen, and press Backup once a week to keep a copy.', [], true);
    // backup reminder
    const m = C.computeMetrics(state, now()), days = state.settings.backupReminderDays, hasData = m.completedCount >= 3 || state.scores.length > 0;
    if (days > 0 && hasData && st.file.state !== 'ok') {
      const lb = state.meta.lastBackupAt, age = lb ? daysAgo(lb) : null;
      if (age === null) add('backup', 'info', 'You have not made a backup yet. A backup file protects you if the browser data is ever cleared.', [{ label: 'Download backup', fn: exportBackup }], true);
      else if (age >= days) add('backup', 'info', 'Your last backup was ' + age + ' days ago.', [{ label: 'Download backup', fn: exportBackup }], true);
    }
    if (state.settings.reminders.enabled && permission() !== 'granted') add('notif', 'warn', 'Reminders are on, but the browser is blocking notifications for this site.', [{ label: 'Open settings', fn: () => setView('settings') }], true);
    const od = C.overdueToday(state, now());
    if (ui.view === 'today' && !ui.viewDate && od.length) add('overdue' + od.length, 'warn', od.length + (od.length === 1 ? ' mission is' : ' missions are') + ' overdue today. Finish, skip or reschedule ' + (od.length === 1 ? 'it' : 'them') + '.', [], true);

    box.replaceChildren(...list.map((b) => h('div', { class: 'banner banner-' + b.kind },
      h('p', {}, b.text),
      h('div', { class: 'banner-actions' }, b.actions.map((a) => btn(a.label, { class: 'btn btn-small' }, a.fn)),
        b.dismissible ? btn('Dismiss', { class: 'btn btn-small btn-ghost', 'aria-label': 'Dismiss message' }, () => { dismissed.add(b.id); renderBanners(); }) : null))));
  }

  /* ------------------------------------------------------------ navigation */
  function setView(v) {
    ui.view = v;
    $$('.view-section').forEach((el) => el.classList.add('hidden'));
    $('#' + v + 'View').classList.remove('hidden');
    $$('.nav-btn').forEach((b) => { const a = b.dataset.view === v; b.classList.toggle('active', a); if (a) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    renderAll();
    window.scrollTo(0, 0);
  }
  // Redraw something but keep keyboard focus on the same control (so Tab / Space / Enter keep working).
  function keepFocus(fn) {
    const ae = document.activeElement, fid = ae && ae.dataset && ae.dataset.fid;
    fn();
    if (fid) { const el = $('[data-fid="' + fid.replace(/"/g, '\\"') + '"]'); if (el && el !== document.activeElement) el.focus({ preventScroll: true }); }
  }
  function renderAll() {
    keepFocus(() => {
      renderChrome();
      if (ui.view === 'today') renderToday();
      else if (ui.view === 'week') renderWeek();
      else if (ui.view === 'stats') renderStats();
      else renderSettings();
    });
  }

  /* ------------------------------------------------------------- TODAY view */
  function weeklyRing(m, n) {
    const subs = C.MAIN_SUBJECTS, tg = state.settings.weeklyTargets, total = subs.reduce((a, s) => a + tg[s], 0);
    const wk = m.weekSubject[C.weekStart(n.dateKey)] || {};
    const done = Object.keys(wk).reduce((a, k) => a + wk[k], 0);
    const gap = 3, stops = [];
    let a0 = 0;
    if (total > 0) subs.forEach((s) => {
      if (!tg[s]) return;
      const size = tg[s] / total * (360 - gap * subs.filter((x) => tg[x]).length), fill = size * Math.min(1, (wk[s] || 0) / tg[s]), col = C.SUBJECT_COLORS[s];
      stops.push(col + ' ' + a0.toFixed(2) + 'deg ' + (a0 + fill).toFixed(2) + 'deg', col + '30 ' + (a0 + fill).toFixed(2) + 'deg ' + (a0 + size).toFixed(2) + 'deg', 'transparent ' + (a0 + size).toFixed(2) + 'deg ' + (a0 + size + gap).toFixed(2) + 'deg');
      a0 += size + gap;
    });
    const ring = h('div', { class: 'ring', role: 'img', 'aria-label': 'Weekly study: ' + fmt(done) + ' of ' + fmt(total) + ' target' },
      h('div', { class: 'ring-hole' }, h('strong', {}, fmt(done)), h('span', {}, 'of ' + fmt(total) + ' this week')));
    ring.style.background = stops.length ? 'conic-gradient(' + stops.join(',') + ')' : '#2c303a';
    return ring;
  }

  function nextMissionPanel(n) {
    const nm = C.nextMission(state, n), dayTasks = C.tasksOnDate(state, n.dateKey);
    const wrap = h('div', { class: 'now-panel' });
    if (!dayTasks.length) { wrap.append(h('div', { class: 'now-kicker' }, 'No missions today'), h('div', { class: 'now-title' }, 'Free day'), h('p', { class: 'now-sub' }, 'Add a mission to keep your streak alive.')); return wrap; }
    if (!nm) {
      const left = dayTasks.filter((t) => !C.isDone(state, t.id, n.dateKey) && !C.isSkipped(state, t.id, n.dateKey)).length;
      wrap.append(h('div', { class: 'now-kicker' }, left ? 'Day finished' : 'Day cleared'), h('div', { class: 'now-title' }, left ? left + ' mission' + (left > 1 ? 's' : '') + ' still open' : 'Every mission done'), h('p', { class: 'now-sub' }, left ? 'Finish them now or skip them honestly. Tomorrow is a new run.' : 'That is how an 18/20 is built. Rest well.'));
      return wrap;
    }
    const t = nm.task;
    wrap.append(h('div', { class: 'now-kicker' + (nm.inSession ? ' live' : '') }, nm.inSession ? 'In session · ' + fmt(nm.minutesLeft) + ' left' : 'Up next · in ' + fmt(nm.minutesUntil)),
      h('div', { class: 'now-title' }, t.name),
      h('div', { class: 'now-meta' }, h('span', { class: 'subject-tag', style: { color: C.SUBJECT_COLORS[t.subject] } }, t.subject), h('span', { class: 'mono' }, t.start + '–' + C.fromMin(C.toMin(t.start) + t.duration)), h('span', {}, fmt(t.duration))),
      btn('Mark complete · +' + C.earnedXP(t.duration) + ' XP', { class: 'btn btn-primary', 'data-fid': 'hero-complete' }, (ev) => toggleTask(t, n.dateKey, ev)));
    return wrap;
  }

  function renderToday() {
    const root = $('#todayView'), n = now(), key = viewKey(), isToday = key === n.dateKey, m = C.computeMetrics(state, n);
    const tasks = C.tasksOnDate(state, key), orphans = C.orphansOnDate(state, key);
    const done = tasks.filter((t) => C.isDone(state, t.id, key)), plan = tasks.reduce((a, t) => a + t.duration, 0), cleared = done.reduce((a, t) => a + t.duration, 0);
    const pct = tasks.length ? Math.round(done.length / tasks.length * 100) : 0;

    // --- console
    const inLevel = m.xpInLevel / C.LEVEL_XP * 100, cd = C.examCountdown(state.settings, n);
    const streakNote = m.streakAtRisk ? 'Complete one mission today to keep it' : m.currentStreak ? 'Alive. Keep going' : 'Complete a mission to start one';
    const consolePanel = h('section', { class: 'console hud', 'aria-label': 'Your status' },
      h('div', { class: 'console-ring' }, weeklyRing(m, n)),
      nextMissionPanel(n),
      h('div', { class: 'console-stats' },
        h('div', { class: 'level-block' }, h('div', { class: 'level-top' }, h('strong', {}, 'Level ' + m.level), h('span', {}, m.rank)),
          h('div', { class: 'progress-track', role: 'progressbar', 'aria-label': 'Level progress', 'aria-valuemin': 0, 'aria-valuemax': C.LEVEL_XP, 'aria-valuenow': m.xpInLevel }, (() => { const i = h('i'); i.style.width = inLevel + '%'; return i; })()),
          h('div', { class: 'level-sub' }, m.xpInLevel + ' / ' + C.LEVEL_XP + ' XP · ' + m.xp.toLocaleString() + ' total')),
        h('div', { class: 'stat-line' }, h('span', { class: 'stat-ico coral', 'aria-hidden': 'true' }, '♨'), h('div', {}, h('strong', {}, m.currentStreak + (m.currentStreak === 1 ? ' day streak' : ' day streak')), h('small', { class: m.streakAtRisk ? 'risk' : '' }, streakNote))),
        h('div', { class: 'stat-line' }, h('span', { class: 'stat-ico cyan', 'aria-hidden': 'true' }, '◷'), h('div', {}, h('strong', {}, cd == null ? 'Exam date not set' : cd > 0 ? cd + ' days to the exam' : cd === 0 ? 'Exam day' : 'Exam passed'), cd == null ? btn('Set it in Settings', { class: 'link-btn' }, () => setView('settings')) : h('small', {}, 'Every mission counts'))))
    );

    // --- day navigation
    const min = C.shiftKey(n.dateKey, -30), max = C.shiftKey(n.dateKey, 7);
    const go = (d) => { const k = C.shiftKey(key, d); if (k < min || k > max) return; ui.viewDate = k === n.dateKey ? null : k; renderAll(); };
    const nav = h('div', { class: 'section-heading' },
      h('div', { class: 'day-nav' },
        btn('‹', { class: 'icon-btn', 'aria-label': 'Previous day', 'data-fid': 'day-prev', disabled: key <= min }, () => go(-1)),
        h('div', { class: 'day-nav-label' }, h('h2', {}, isToday ? 'Today' : C.formatDateKey(key, { weekday: 'long' })), h('span', {}, isToday ? C.formatDateKey(key, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : C.formatDateKey(key, { day: 'numeric', month: 'long', year: 'numeric' }))),
        btn('›', { class: 'icon-btn', 'aria-label': 'Next day', 'data-fid': 'day-next', disabled: key >= max }, () => go(1)),
        isToday ? null : btn('Back to today', { class: 'btn btn-small', 'data-fid': 'day-today' }, () => { ui.viewDate = null; renderAll(); })),
      btn('＋ Add mission', { class: 'btn btn-primary', 'data-fid': 'add-top' }, () => openTaskDialog(null, { day: C.dowOf(key), date: key })));

    const note = isToday ? null : h('div', { class: 'callout' }, h('p', {}, key > n.dateKey ? 'You are previewing a future day. Missions can be ticked off only on the day itself.' : 'You are looking at a past day. If you really did a mission and forgot to tick it, you can tick it here.'));
    const summary = h('div', { class: 'daily-summary' },
      h('div', {}, h('span', { class: 'summary-label' }, 'Missions complete'), h('strong', {}, done.length + ' / ' + tasks.length)),
      h('div', { class: 'summary-progress' }, h('div', { class: 'progress-track' }, (() => { const i = h('i'); i.style.width = pct + '%'; return i; })()), h('span', {}, pct + '% complete')),
      h('div', { class: 'summary-time' }, h('span', { class: 'summary-label' }, 'Study time'), h('strong', {}, fmt(cleared), ' ', h('small', {}, '/ ' + fmt(plan)))));

    const list = h('div', { class: 'task-list' }, tasks.map((t) => taskCard(t, key, n)), orphans.map((o) => orphanCard(o, key)));
    const empty = tasks.length || orphans.length ? null : h('div', { class: 'empty-state' }, h('h3', {}, 'Nothing planned for this day'), h('p', {}, 'Add a mission, or enjoy the rest. Planned rest still counts.'), btn('Create a mission', { class: 'btn btn-primary' }, () => openTaskDialog(null, { day: C.dowOf(key), date: key })));

    // --- below: mini week + next achievement
    const keys = C.weekKeys(key);
    const mini = h('div', { class: 'mini-week' }, keys.map((k) => {
      const ts = C.tasksOnDate(state, k), tot = ts.reduce((a, t) => a + t.duration, 0), dn = ts.filter((t) => C.isDone(state, t.id, k)).reduce((a, t) => a + t.duration, 0), p = tot ? Math.min(100, dn / tot * 100) : 0;
      const fill = h('i'); fill.style.height = p + '%';
      return h('button', { type: 'button', class: 'mini-day' + (k === key ? ' sel' : ''), 'aria-label': C.formatDateKey(k) + ': ' + (tot ? Math.round(p) + '% done' : 'nothing planned'), onclick: () => { ui.viewDate = k === n.dateKey ? null : k; renderAll(); } },
        h('label', {}, C.DAY_SHORT[C.dowOf(k)]), h('div', { class: 'mini-day-bar' }, fill), h('small', {}, tot ? Math.round(p) + '%' : '—'));
    }));
    const na = C.nextAchievement(m);
    const nextA = h('div', { class: 'next-achievement' }, na ? [h('div', { class: 'achievement-emblem' }, na.icon), h('div', {}, h('strong', {}, na.name), h('p', {}, na.desc), progressBar(C.achievementRatio(na, m), na.prog(m)))] : h('p', {}, 'Every achievement is unlocked. Legendary.'));
    const below = h('div', { class: 'below-grid' },
      h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'This week')), mini),
      h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'Closest achievement')), nextA));

    setKids(root, [consolePanel, nav, note, summary, list, empty, below]);
  }

  function progressBar(ratio, prog) {
    const i = h('i'); i.style.width = (ratio * 100) + '%';
    return h('div', { class: 'mini-progress' }, h('div', { class: 'progress-track' }, i), h('small', {}, Math.min(prog[0], prog[1]).toLocaleString() + ' / ' + prog[1].toLocaleString()));
  }

  function taskCard(t, key, n) {
    const completed = C.isDone(state, t.id, key), skipped = C.isSkipped(state, t.id, key), st = C.taskStatus(state, t, key, n), xp = C.earnedXP(t.duration), future = key > n.dateKey;
    return h('article', { class: 'task-card' + (completed ? ' is-complete' : '') + (skipped ? ' is-skipped' : '') + ' st-' + st.code },
      h('button', { type: 'button', class: 'task-check' + (completed ? ' checked' : ''), role: 'checkbox', 'aria-checked': completed, 'aria-label': (completed ? 'Mark not done: ' : 'Mark done: ') + t.name, 'data-fid': t.id + ':check', disabled: future, title: future ? 'You can tick this off on the day itself' : null, onclick: (ev) => toggleTask(t, key, ev) }, completed ? '✓' : ''),
      h('div', { class: 'task-info' },
        h('div', { class: 'task-title' }, t.name),
        h('div', { class: 'task-meta' }, h('span', { class: 'subject-tag', style: { color: C.SUBJECT_COLORS[t.subject] || '#a4aabc' } }, t.subject), h('span', {}, fmt(t.duration)), t.repeat === 'once' ? h('span', { class: 'tag-once' }, 'one-time') : null, h('span', { class: 'task-status ' + st.code }, st.label))),
      h('div', { class: 'task-right' },
        h('div', { class: 'task-time' }, h('strong', { class: 'mono' }, t.start), h('small', {}, 'to ' + C.fromMin(C.toMin(t.start) + t.duration))),
        h('span', { class: 'xp-pill' }, (completed ? '✓ ' : '+') + (completed ? state.completions[C.completionKey(key, t.id)].xp : xp) + ' XP'),
        h('div', { class: 'row-actions' },
          !completed && !future ? btn(skipped ? 'Undo skip' : 'Skip', { class: 'btn btn-tiny', 'data-fid': t.id + ':skip', title: 'Skipping is recorded honestly: no XP, no streak.' }, () => commit((s) => C.toggleSkip(s, t, key, Date.now()), { celebrate: false })) : null,
          btn('✎', { class: 'icon-btn small', 'aria-label': 'Edit ' + t.name, 'data-fid': t.id + ':edit' }, () => openTaskDialog(t)),
          btn('×', { class: 'icon-btn small danger', 'aria-label': 'Delete ' + t.name, 'data-fid': t.id + ':del' }, () => deleteTask(t)))));
  }
  function orphanCard(e, key) {
    return h('article', { class: 'task-card is-complete' },
      h('button', { type: 'button', class: 'task-check checked', role: 'checkbox', 'aria-checked': true, 'aria-label': 'Mark not done: ' + (e.name || 'removed mission'), onclick: () => commit((s) => C.toggleCompletion(s, { id: e.taskId }, key, 0), { celebrate: false }) }, '✓'),
      h('div', { class: 'task-info' }, h('div', { class: 'task-title' }, e.name || 'Mission no longer in your plan'),
        h('div', { class: 'task-meta' }, h('span', { class: 'subject-tag', style: { color: C.SUBJECT_COLORS[e.subject] || '#a4aabc' } }, e.subject), h('span', {}, fmt(e.minutes)), h('span', { class: 'task-status done' }, 'Completed earlier · removed from plan'))),
      h('div', { class: 'task-right' }, h('span', { class: 'xp-pill' }, '✓ ' + e.xp + ' XP')));
  }

  function toggleTask(task, dateKey, ev) {
    const n = now();
    if (dateKey > n.dateKey) return;
    const rect = ev && ev.currentTarget ? ev.currentTarget.getBoundingClientRect() : null;
    const res = commit((s) => C.toggleCompletion(s, task, dateKey, Date.now()), { message: (r) => (r.done ? 'Mission cleared! +' + r.xp + ' XP' : 'Unchecked. ' + r.xp + ' XP removed.') });
    if (res.done) floatText('+' + res.xp + ' XP', rect);
  }

  function deleteTask(task) {
    confirmDialog({ title: 'Delete this mission?', body: ['“' + task.name + '” will be removed from your plan.', 'XP and history you already earned stay saved.'], yes: 'Delete mission', danger: true }).then((ok) => {
      if (!ok) return;
      const copy = JSON.parse(JSON.stringify(task));
      commit((s) => { s.tasks = s.tasks.filter((t) => t.id !== task.id); }, { celebrate: false });
      toast('Mission deleted.', { actionLabel: 'Undo', onAction: () => commit((s) => { s.tasks.push(copy); s.tasks.sort(C.taskOrder); }, { celebrate: false }) });
    });
  }

  /* ---------------------------------------------------------- mission dialog */
  let editingId = null;
  function openTaskDialog(task, defaults) {
    defaults = defaults || {};
    const d = $('#taskDialog');
    editingId = task ? task.id : null;
    $('#taskDialogTitle').textContent = task ? 'Edit mission' : 'Add a mission';
    $('#saveTask').textContent = task ? 'Save changes' : 'Save mission';
    $('#taskSubject').replaceChildren(...C.SUBJECTS.map((s) => h('option', { value: s }, s)));
    $('#taskDay').replaceChildren(...C.WEEK_ORDER.map((i) => h('option', { value: i }, C.DAY_NAMES[i])));
    $('#durChips').replaceChildren(...[30, 45, 60, 90, 120].map((v) => btn(fmt(v), { class: 'chip' }, () => { $('#taskDuration').value = v; updateTaskPreview(); })));
    const t = task || { name: '', subject: 'Mathematics', repeat: 'weekly', day: defaults.day != null ? defaults.day : now().dow, date: defaults.date || now().dateKey, start: '17:00', duration: 60 };
    $('#taskName').value = t.name; $('#taskSubject').value = t.subject; $('#taskDay').value = String(t.day);
    $('#taskDate').value = t.date || defaults.date || now().dateKey; $('#taskStart').value = t.start; $('#taskDuration').value = t.duration;
    $$('input[name="repeat"]').forEach((r) => { r.checked = r.value === t.repeat; });
    $('#taskErrors').classList.add('hidden');
    syncRepeatFields(); updateTaskPreview();
    d.showModal();
    $('#taskName').focus();
  }
  const repeatValue = () => ($('input[name="repeat"]:checked') || {}).value || 'weekly';
  function syncRepeatFields() { const once = repeatValue() === 'once'; $('#dayField').classList.toggle('hidden', once); $('#dateField').classList.toggle('hidden', !once); }
  function readTaskForm() {
    return { name: $('#taskName').value, subject: $('#taskSubject').value, repeat: repeatValue(), day: Number($('#taskDay').value), date: $('#taskDate').value, start: $('#taskStart').value, duration: $('#taskDuration').value === '' ? NaN : Number($('#taskDuration').value) };
  }
  function updateTaskPreview() {
    const f = readTaskForm(), ends = $('#taskEnds'), warn = $('#taskWarn');
    const timeOk = C.isTime(f.start) && Number.isInteger(f.duration) && f.duration >= 5;
    ends.textContent = timeOk ? 'Ends at ' + C.fromMin(Math.min(1440, C.toMin(f.start) + f.duration)) + ' · ' + fmt(f.duration) + ' · +' + C.earnedXP(f.duration) + ' XP' : '';
    warn.classList.add('hidden'); warn.replaceChildren();
    $('#saveTask').textContent = editingId ? 'Save changes' : 'Save mission';
    if (!timeOk || (f.repeat === 'once' && !C.isDateKey(f.date))) return;
    const cf = C.findConflicts(state, f, editingId), lines = [];
    cf.school.forEach((l) => lines.push('Overlaps a school lesson: ' + l.subject + ' (' + l.start + '–' + l.end + ')'));
    cf.missions.forEach((x) => lines.push('Overlaps another mission: ' + x.name + ' (' + x.start + '–' + C.fromMin(C.toMin(x.start) + x.duration) + ')'));
    if (lines.length) { warn.replaceChildren(h('strong', {}, 'Schedule clash'), h('ul', {}, lines.map((l) => h('li', {}, l))), h('p', {}, 'You can still save it, but you will not be able to do both at once.')); warn.classList.remove('hidden'); $('#saveTask').textContent = editingId ? 'Save anyway' : 'Save anyway'; }
  }
  function submitTask(ev) {
    ev.preventDefault();
    const n = now(), f = readTaskForm(), res = C.validateTaskInput(f, n.dateKey), errBox = $('#taskErrors');
    if (!res.ok) { errBox.replaceChildren(h('ul', {}, res.errors.map((e) => h('li', {}, e)))); errBox.classList.remove('hidden'); return; }
    const t = res.task;
    commit((s) => {
      if (editingId) {
        const cur = s.tasks.find((x) => x.id === editingId); if (!cur) return;
        const wasOnce = cur.repeat === 'once';
        const keepStart = cur.repeat === 'weekly' && t.repeat === 'weekly' ? cur.startDate : undefined;   // editing never changes when a weekly mission began
        const upd = Object.assign({}, t); delete upd.startDate;
        delete cur.date; delete cur.startDate;
        Object.assign(cur, upd);
        if (t.repeat === 'weekly') { if (cur.repeat === 'weekly' && keepStart) cur.startDate = keepStart; else if (wasOnce) cur.startDate = t.startDate; }
      } else s.tasks.push(Object.assign({ id: C.uid('task'), createdAt: Date.now() }, t));
      s.tasks.sort(C.taskOrder);
    }, { celebrate: false });
    $('#taskDialog').close();
    toast(editingId ? 'Mission updated.' : 'Mission added to your plan.');
  }

  /* -------------------------------------------------------------- WEEK view */
  function renderWeek() {
    const root = $('#weekView'), n = now(), ws = C.weekStart(n.dateKey), plan = C.weekPlan(state, ws), tg = state.settings.weeklyTargets;
    const totalTarget = C.MAIN_SUBJECTS.reduce((a, s) => a + tg[s], 0), schoolTotal = C.WEEK_ORDER.reduce((a, d) => a + C.schoolMinutes(state, d), 0);

    const subjectRows = C.MAIN_SUBJECTS.map((s) => {
      const p = plan.bySubject[s] || 0, diff = p - tg[s];
      return h('div', { class: 'target-row' }, h('i', { class: 'swatch', style: { background: C.SUBJECT_COLORS[s] } }), h('span', { class: 'target-name' }, s),
        h('span', { class: 'mono' }, fmt(p) + ' / ' + fmt(tg[s])),
        h('span', { class: 'delta ' + (diff === 0 ? 'ok' : diff < 0 ? 'under' : 'over') }, diff === 0 ? 'on target' : (diff < 0 ? '−' : '+') + fmt(Math.abs(diff))));
    });
    const targetPanel = h('div', { class: 'panel target-panel' },
      h('div', { class: 'target-main' }, h('span', { class: 'summary-label' }, 'Planned this week'), h('strong', {}, fmt(plan.total)), h('small', {}, 'Target ' + fmt(totalTarget) + ' · outside your ' + fmt(schoolTotal) + ' of school')),
      h('div', { class: 'target-rows' }, subjectRows));

    const heading = h('div', { class: 'section-heading' },
      h('div', { class: 'seg-toggle', role: 'group', 'aria-label': 'Plan layout' },
        btn('Board', { class: ui.weekMode === 'board' ? 'on' : '', 'aria-pressed': ui.weekMode === 'board', 'data-fid': 'mode-board' }, () => { ui.weekMode = 'board'; renderWeek(); }),
        btn('Timeline', { class: ui.weekMode === 'timeline' ? 'on' : '', 'aria-pressed': ui.weekMode === 'timeline', 'data-fid': 'mode-tl' }, () => { ui.weekMode = 'timeline'; renderWeek(); })),
      btn('＋ Add mission', { class: 'btn btn-primary', 'data-fid': 'add-week' }, () => openTaskDialog(null)));

    const callout = h('div', { class: 'callout' }, h('p', {}, 'Missions repeat every week. Tick them off on the Today screen: ticks are saved per date, so editing the plan never changes your history.'));
    const body = ui.weekMode === 'board' ? weekBoard(n, ws) : weekTimeline(n, ws);

    const once = state.tasks.filter((t) => t.repeat === 'once' && t.date >= n.dateKey).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    const onceList = once.length ? h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'Upcoming one-time missions')),
      once.map((t) => missionRow(t, C.formatDateKey(t.date) + ' · ' + t.start + ' · ' + fmt(t.duration) + ' · ' + t.subject))) : null;

    setKids(root, [heading, callout, targetPanel, body, onceList, schoolPanel()]);
  }

  function missionRow(t, detail) {
    return h('div', { class: 'week-mission' }, h('i', { class: 'dot', style: { background: C.SUBJECT_COLORS[t.subject] || '#a4aabc' } }),
      h('div', { class: 'wm-text' }, h('strong', {}, t.name), h('small', {}, detail)),
      h('div', { class: 'row-actions' }, btn('✎', { class: 'icon-btn small', 'aria-label': 'Edit ' + t.name, 'data-fid': t.id + ':wedit' }, () => openTaskDialog(t)), btn('×', { class: 'icon-btn small danger', 'aria-label': 'Delete ' + t.name, 'data-fid': t.id + ':wdel' }, () => deleteTask(t))));
  }
  const itemsForDow = (dow, weekKeysList) => state.tasks.filter((t) => t.repeat === 'once' ? weekKeysList.indexOf(t.date) >= 0 && C.dowOf(t.date) === dow : t.day === dow).sort(C.taskOrder);

  function weekBoard(n, ws) {
    const wk = C.weekKeys(ws);
    return h('div', { class: 'week-board' }, C.WEEK_ORDER.map((dow) => {
      const ts = itemsForDow(dow, wk), clash = C.conflictIdsForDay(state, dow), sMin = C.schoolMinutes(state, dow);
      return h('div', { class: 'day-column' + (dow === n.dow ? ' is-today' : '') },
        h('div', { class: 'day-head' }, h('strong', {}, C.DAY_NAMES[dow]), h('span', {}, fmt(ts.reduce((a, t) => a + t.duration, 0)) + ' study' + (sMin ? ' · ' + fmt(sMin) + ' school' : '')),
          btn('＋', { class: 'icon-btn small', 'aria-label': 'Add mission on ' + C.DAY_NAMES[dow], 'data-fid': 'add-' + dow }, () => openTaskDialog(null, { day: dow }))),
        h('div', { class: 'day-missions' }, ts.length ? ts.map((t) => missionRow(t, t.start + '–' + C.fromMin(C.toMin(t.start) + t.duration) + ' · ' + fmt(t.duration) + ' · ' + t.subject + (t.repeat === 'once' ? ' · one-time' : '') + (clash[t.id] ? ' · ⚠ clash' : ''))) : h('div', { class: 'no-missions' }, 'No missions planned')));
    }));
  }

  function weekTimeline(n, ws) {
    const wk = C.weekKeys(ws), px = 0.9;                      // pixels per minute
    let lo = 8 * 60, hi = 21 * 60;
    state.school.forEach((l) => { lo = Math.min(lo, C.toMin(l.start)); hi = Math.max(hi, C.toMin(l.end)); });
    state.tasks.forEach((t) => { lo = Math.min(lo, C.toMin(t.start)); hi = Math.max(hi, C.toMin(t.start) + t.duration); });
    lo = Math.floor(lo / 60) * 60; hi = Math.min(1440, Math.ceil(hi / 60) * 60);
    const height = (hi - lo) * px;
    const hours = h('div', { class: 'tl-hours', style: { height: height + 'px' } });
    for (let m = lo; m < hi; m += 60) { const l = h('span', {}, C.fromMin(m)); l.style.top = (m - lo) * px + 'px'; hours.append(l); }
    const cols = C.WEEK_ORDER.map((dow) => {
      const col = h('div', { class: 'tl-col' + (dow === n.dow ? ' is-today' : '') }, h('div', { class: 'tl-head' }, C.DAY_SHORT[dow]), h('div', { class: 'tl-body', style: { height: height + 'px' } }));
      const body = $('.tl-body', col), clash = C.conflictIdsForDay(state, dow);
      for (let m = lo + 60; m < hi; m += 60) { const g = h('i', { class: 'tl-grid' }); g.style.top = (m - lo) * px + 'px'; body.append(g); }
      const place = (el, s, e) => { el.style.top = (s - lo) * px + 'px'; el.style.height = Math.max(14, (e - s) * px - 2) + 'px'; body.append(el); };
      state.school.filter((l) => l.day === dow).forEach((l) => place(h('div', { class: 'tl-block school', title: 'School: ' + l.subject + ' ' + l.start + '–' + l.end + (l.room ? ' (' + l.room + ')' : '') }, h('b', {}, l.subject), l.room ? h('small', {}, l.room) : null), C.toMin(l.start), C.toMin(l.end)));
      itemsForDow(dow, wk).forEach((t) => {
        const s = C.toMin(t.start), blk = h('button', { type: 'button', class: 'tl-block study' + (t.duration < 45 ? ' short' : '') + (clash[t.id] ? ' clash' : ''), title: t.name + ' · ' + t.start + '–' + C.fromMin(s + t.duration) + (clash[t.id] ? ' · CLASH' : ''), 'aria-label': 'Edit ' + t.subject + ': ' + t.name + ', ' + t.start, onclick: () => openTaskDialog(t) }, t.duration < 45 ? h('b', {}, t.subject + ' · ' + t.start) : [h('b', {}, t.subject), h('small', {}, t.start)]);
        blk.style.setProperty('--c', C.SUBJECT_COLORS[t.subject] || '#a4aabc');
        place(blk, s, s + t.duration);
      });
      if (dow === n.dow && n.minutes >= lo && n.minutes <= hi) { const nl = h('i', { class: 'tl-now' }); nl.style.top = (n.minutes - lo) * px + 'px'; body.append(nl); }
      return col;
    });
    return h('div', { class: 'timeline-wrap' }, h('div', { class: 'timeline' }, h('div', { class: 'tl-gutter' }, h('div', { class: 'tl-head' }, ''), hours), cols),
      h('div', { class: 'tl-legend' }, h('span', {}, h('i', { class: 'sw school' }), 'School lesson'), h('span', {}, h('i', { class: 'sw study' }), 'Study mission (click to edit)'), h('span', {}, h('i', { class: 'sw clash' }), 'Clash')));
  }

  function schoolPanel() {
    const det = h('details', { class: 'panel school-details' });
    if (ui.schoolOpen) det.setAttribute('open', '');
    det.addEventListener('toggle', () => { ui.schoolOpen = det.open; });
    const total = C.WEEK_ORDER.reduce((a, d) => a + C.schoolMinutes(state, d), 0);
    det.append(h('summary', {}, 'School timetable · ' + fmt(total) + ' per week'),
      h('p', { class: 'hint' }, 'Missions are checked against these lessons so you do not plan study during class. Update it if your timetable changes.'));
    det.append(h('div', { class: 'school-board' }, C.WEEK_ORDER.map((dow) => {
      const ls = state.school.filter((l) => l.day === dow).sort((a, b) => a.start.localeCompare(b.start));
      return h('div', { class: 'school-day' }, h('div', { class: 'school-day-head' }, h('strong', {}, C.DAY_NAMES[dow]), h('span', {}, ls.length ? fmt(C.schoolMinutes(state, dow)) : 'No classes')),
        ls.length ? ls.map((l) => h('div', { class: 'school-lesson' }, h('span', { class: 'mono' }, l.start + '–' + l.end), h('span', {}, l.subject + (l.room ? ' · ' + l.room : '')), btn('×', { class: 'icon-btn small danger', 'aria-label': 'Remove ' + l.subject + ' lesson on ' + C.DAY_NAMES[dow] + ' at ' + l.start, onclick: () => commit((s) => { s.school = s.school.filter((x) => x.id !== l.id); }, { celebrate: false }) }))) : h('div', { class: 'no-missions' }, 'Rest day'));
    })));
    // add-lesson form
    const day = h('select', { 'aria-label': 'Lesson day' }, C.WEEK_ORDER.map((i) => h('option', { value: i }, C.DAY_NAMES[i])));
    const st = h('input', { type: 'time', value: '08:00', 'aria-label': 'Lesson start' }), en = h('input', { type: 'time', value: '09:00', 'aria-label': 'Lesson end' });
    const sub = h('input', { type: 'text', list: 'subjList', placeholder: 'Subject', maxlength: 40, 'aria-label': 'Lesson subject' }), room = h('input', { type: 'text', placeholder: 'Room', maxlength: 12, 'aria-label': 'Room' });
    const dl = h('datalist', { id: 'subjList' }, ['Mathematics', 'Physics-Chemistry', 'SVT', 'Philosophy', 'English', 'French', 'Arabic', 'Islamic Education', 'Physical Education'].map((s) => h('option', { value: s })));
    const msg = h('p', { class: 'error-text hidden', role: 'alert' });
    det.append(h('div', { class: 'add-lesson' }, h('strong', {}, 'Add a lesson'), h('div', { class: 'add-lesson-row' }, day, st, en, sub, room, btn('Add lesson', { class: 'btn btn-small' }, () => {
      const l = C.normalizeSchool([{ day: Number(day.value), start: st.value, end: en.value, subject: sub.value, room: room.value }]);
      if (!l.length) { msg.textContent = 'Enter a subject and make sure the end time is after the start time.'; msg.classList.remove('hidden'); return; }
      const lesson = Object.assign(l[0], { id: C.uid('sch') });
      const clash = state.tasks.filter((t) => t.repeat !== 'once' && t.day === lesson.day && C.toMin(t.start) < C.toMin(lesson.end) && C.toMin(lesson.start) < C.toMin(t.start) + t.duration).length;
      commit((s) => { s.school.push(lesson); }, { celebrate: false });
      toast(clash ? 'Lesson added. It overlaps ' + clash + ' study mission' + (clash > 1 ? 's' : '') + ': check the Timeline.' : 'Lesson added.', clash ? { error: true } : {});
    })), msg, dl));
    return det;
  }

  /* ------------------------------------------------------------ STATS view */
  function statCard(label, value, sub) { return h('div', { class: 'panel large-stat' }, h('span', { class: 'summary-label' }, label), h('strong', {}, value), h('p', {}, sub)); }

  function renderStats() {
    const root = $('#statsView'), n = now(), m = C.computeMetrics(state, n), ws = C.weekStart(n.dateKey), tg = state.settings.weeklyTargets;
    const totalTarget = C.MAIN_SUBJECTS.reduce((a, s) => a + tg[s], 0);
    const activeWeeks = Object.keys(m.weekMinutes).filter((k) => m.weekMinutes[k] > 0).length;
    const avg = activeWeeks ? Math.round(m.minutes / activeWeeks) : 0, wd = C.weekdayTotals(m), bestDay = wd.indexOf(Math.max.apply(null, wd));
    const cards = h('div', { class: 'stats-grid' },
      statCard('Total study time', Math.floor(m.minutes / 60) + 'h ' + (m.minutes % 60) + 'm', 'From missions you ticked off.'),
      statCard('Missions cleared', String(m.completedCount), 'Each earns XP.'),
      statCard('Streak', m.currentStreak + ' days', 'Best: ' + m.bestStreak + ' days.'),
      statCard('Average per active week', fmt(avg), m.minutes ? 'Strongest day: ' + C.DAY_NAMES[bestDay] + '.' : 'Complete missions to see this.'));

    // weekly chart (last 8 weeks)
    const series = C.weeklySeries(m, n, 8), scale = Math.max(totalTarget, ...series.map((s) => s.minutes), 60) * 1.08;
    const chart = h('div', { class: 'bars', role: 'img', 'aria-label': 'Study hours for the last 8 weeks: ' + series.map((s) => fmt(s.minutes)).join(', ') }, series.map((s) => {
      const bar = h('i'); bar.style.height = (s.minutes / scale * 100) + '%';
      return h('div', { class: 'bar-col' + (s.isCurrent ? ' cur' : '') }, h('span', { class: 'bar-val' }, s.minutes ? fmt(s.minutes) : '–'), h('div', { class: 'bar-track' }, bar), h('small', {}, C.formatDateKey(s.start, { day: 'numeric', month: 'short' })));
    }));
    const line = h('i', { class: 'target-line' }); line.style.setProperty('--pct', String(totalTarget / scale));
    const chartPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {}, h('h3', {}, 'Hours per week'), h('p', { class: 'hint' }, 'Last 8 weeks (Monday to Sunday). The dashed line is your ' + fmt(totalTarget) + ' target.'))), h('div', { class: 'chart-wrap' }, chart, line));

    // heatmap (12 weeks)
    const hm = C.heatmap(m, n, 12), lvl = (x) => (x <= 0 ? 0 : x < 45 ? 1 : x < 90 ? 2 : x < 150 ? 3 : 4);
    const grid = h('div', { class: 'heatmap', role: 'img', 'aria-label': 'Daily study activity for the last 12 weeks' }, hm.map((col) => h('div', { class: 'hm-col' }, col.map((c) => h('i', { class: 'hm-cell l' + (c.future ? 'f' : lvl(c.minutes)), title: C.formatDateKey(c.date) + ': ' + (c.future ? 'upcoming' : fmt(c.minutes)) })))));
    const heatPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {}, h('h3', {}, 'Consistency'), h('p', { class: 'hint' }, 'Each square is a day (columns are weeks, rows are Monday to Sunday).'))),
      h('div', { class: 'hm-wrap' }, h('div', { class: 'hm-days' }, ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((d) => h('span', {}, d))), grid),
      h('div', { class: 'hm-legend' }, 'Less ', [0, 1, 2, 3, 4].map((l) => h('i', { class: 'hm-cell l' + l })), ' More'));

    // subjects this week
    const wk = m.weekSubject[ws] || {}, subs = C.MAIN_SUBJECTS.concat(wk.Other ? ['Other'] : []);
    const subjectPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'Subjects · this week')),
      h('div', { class: 'subject-progress' }, subs.map((s) => {
        const done = wk[s] || 0, target = tg[s] || 0, i = h('i'); i.style.width = (target ? Math.min(100, done / target * 100) : (done ? 100 : 0)) + '%'; i.style.background = C.SUBJECT_COLORS[s];
        return h('div', { class: 'subject-line' }, h('label', {}, s), h('div', { class: 'progress-track' }, i), h('strong', { class: 'mono' }, fmt(done) + ' / ' + fmt(target)));
      })));
    const allMin = Object.keys(m.subjectMinutes).reduce((a, k) => a + m.subjectMinutes[k], 0);
    const allPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'Where your time has gone · all time')),
      allMin ? h('div', { class: 'subject-progress' }, Object.keys(m.subjectMinutes).sort((a, b) => m.subjectMinutes[b] - m.subjectMinutes[a]).map((s) => {
        const i = h('i'); i.style.width = (m.subjectMinutes[s] / allMin * 100) + '%'; i.style.background = C.SUBJECT_COLORS[s] || '#a4aabc';
        return h('div', { class: 'subject-line' }, h('label', {}, s), h('div', { class: 'progress-track' }, i), h('strong', { class: 'mono' }, fmt(m.subjectMinutes[s])));
      })) : h('p', { class: 'hint' }, 'Tick off a few missions to see your subject balance.'));

    // achievements
    const unlockedCount = C.ACHIEVEMENTS.filter((a) => C.achievementDone(a, m)).length;
    const achPanel = h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('h3', {}, 'Achievements'), h('span', { class: 'count-pill' }, unlockedCount + ' / ' + C.ACHIEVEMENTS.length)),
      h('div', { class: 'achievement-grid' }, C.ACHIEVEMENTS.map((a) => {
        const ok = C.achievementDone(a, m), when = state.achievements[a.id];
        return h('div', { class: 'achievement-card t' + a.tier + (ok ? ' unlocked' : '') },
          h('div', { class: 'badge-icon', 'aria-hidden': 'true' }, ok ? a.icon : '◇'), h('strong', {}, a.name), h('p', {}, a.desc),
          ok ? h('span', { class: 'lock-status' }, when ? 'Unlocked ' + C.formatDateKey(when, { day: 'numeric', month: 'short' }) : 'Unlocked') : progressBar(C.achievementRatio(a, m), a.prog(m)));
      })));

    setKids(root, [cards, chartPanel, h('div', { class: 'two-col' }, subjectPanel, allPanel), heatPanel, scoresPanel(n), achPanel]);
  }

  function scoresPanel(n) {
    const ss = C.scoreStats(state), target = state.settings.targetGrade;
    const subj = h('select', { 'aria-label': 'Subject' }, C.SCORE_SUBJECTS.map((s) => h('option', { value: s }, s)));
    const date = h('input', { type: 'date', value: n.dateKey, 'aria-label': 'Date' });
    const score = h('input', { type: 'number', min: 0, max: 20, step: 0.25, placeholder: 'Score /20', 'aria-label': 'Score out of 20' });
    const note = h('input', { type: 'text', maxlength: 120, placeholder: 'Note (e.g. mock exam, school test)', 'aria-label': 'Note' });
    const err = h('p', { class: 'error-text hidden', role: 'alert' });
    const add = () => {
      const v = Number(score.value);
      if (score.value === '' || !Number.isFinite(v) || v < 0 || v > 20) { err.textContent = 'Enter a score between 0 and 20.'; err.classList.remove('hidden'); return; }
      if (!C.isDateKey(date.value)) { err.textContent = 'Choose a date.'; err.classList.remove('hidden'); return; }
      commit((s) => { s.scores.push({ id: C.uid('score'), date: date.value, subject: subj.value, score: Math.round(v * 100) / 100, note: note.value.trim().slice(0, 120) }); });
      toast('Score logged.');
    };
    const rows = ss.rows.sort((a, b) => b.average - a.average).map((r) => {
      const i = h('i'); i.style.width = (r.average / 20 * 100) + '%'; i.style.background = C.SUBJECT_COLORS[r.subject] || '#a4aabc';
      const tl = h('b', { class: 'goal-tick', title: 'Target ' + target }); tl.style.left = (target / 20 * 100) + '%';
      return h('div', { class: 'subject-line score-line' }, h('label', {}, r.subject), h('div', { class: 'progress-track with-tick' }, i, tl), h('strong', { class: 'mono' }, r.average + ' avg · best ' + r.best));
    });
    const recent = state.scores.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((s) => h('div', { class: 'score-item' },
      h('span', { class: 'mono' }, C.formatDateKey(s.date, { day: 'numeric', month: 'short' })), h('span', {}, s.subject + (s.note ? ' · ' + s.note : '')), h('strong', { class: 'mono' }, s.score + '/20'),
      btn('×', { class: 'icon-btn small danger', 'aria-label': 'Delete score ' + s.score + ' in ' + s.subject, onclick: () => commit((st) => { st.scores = st.scores.filter((x) => x.id !== s.id); }, { celebrate: false }) })));
    return h('div', { class: 'panel' }, h('div', { class: 'panel-heading' }, h('div', {}, h('h3', {}, 'Your real scores'), h('p', { class: 'hint' }, 'Log marks from tests and mock exams. Only numbers you enter appear here. This is your record, not a prediction.'))),
      ss.overall != null ? h('div', { class: 'score-overall' }, h('strong', {}, ss.overall + ' / 20'), h('span', {}, 'average of ' + state.scores.length + ' score' + (state.scores.length > 1 ? 's' : '') + ' · target ' + target)) : null,
      rows.length ? h('div', { class: 'subject-progress' }, rows) : null,
      h('div', { class: 'score-form' }, subj, date, score, note, btn('Log score', { class: 'btn btn-small btn-primary' }, add)), err,
      recent.length ? h('div', { class: 'score-list' }, recent) : h('p', { class: 'hint' }, 'No scores yet. Your first one earns the “On the Record” badge.'));
  }

  /* -------------------------------------------------------- SETTINGS view */
  function row(label, content, hint) { return h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, h('strong', {}, label), hint ? h('small', {}, hint) : null), h('div', { class: 'set-control' }, content)); }
  function select(opts, value, onchange, label) { const s = h('select', { 'aria-label': label, onchange: () => onchange(s.value) }, opts.map((o) => h('option', { value: o[0] }, o[1]))); s.value = String(value); return s; }
  function check(label, checked, onchange) { const c = h('input', { type: 'checkbox', onchange: () => onchange(c.checked) }); c.checked = checked; return h('label', { class: 'check' }, c, h('span', {}, label)); }

  function renderSettings() {
    const root = $('#settingsView'), st = S.status, set = state.settings, n = now(), lb = state.meta.lastBackupAt;

    /* --- data safety */
    const fileBlock = !st.file.supported
      ? h('p', { class: 'hint' }, 'Automatic saving to a file is not available in this browser (it needs the File System Access API; some Brave versions switch it off). Your data is still saved in the browser, and you can use Backup regularly.')
      : st.file.state === 'none'
        ? h('div', {}, h('p', { class: 'hint' }, 'Choose a file (for example in Documents) and BAC QUEST will update it after every change. You grant access once; the browser may ask again after a restart. Pick a NEW file name; never an important file.'), btn('Link a save file…', { class: 'btn', 'data-fid': 'link-file' }, linkFile))
        : h('div', {}, h('p', {}, h('strong', {}, st.file.name), ' · ', st.file.state === 'ok' ? 'connected' + (st.file.lastWriteAt ? ' · last written ' + timeLabel(st.file.lastWriteAt) : '') : st.file.state === 'needs-permission' ? 'needs your permission' : 'last write failed: ' + (st.file.error || 'unknown error')),
          h('div', { class: 'btn-row' }, st.file.state !== 'ok' ? btn('Reconnect', { class: 'btn btn-primary', 'data-fid': 'reconnect' }, reconnectFile) : btn('Save to file now', { class: 'btn', 'data-fid': 'file-now' }, async () => { const r = await S.writeFileNow(true); toast(r.ok ? 'Saved to your file.' : 'Could not write the file.', r.ok ? {} : { error: true }); }), btn('Unlink', { class: 'btn btn-ghost', 'data-fid': 'unlink' }, async () => { await S.unlinkFile(); renderAll(); toast('File unlinked. The file itself was not deleted.'); })));

    const snaps = S.listSnapshots();
    const snapList = snaps.length ? h('div', { class: 'snap-list' }, snaps.map((s) => h('div', { class: 'snap-item' },
      h('div', {}, h('strong', {}, dateTimeLabel(s.at)), h('small', {}, s.reason + (s.summary ? ' · ' + s.summary.completions + ' missions, ' + s.summary.xp + ' XP' : ''))),
      btn('Restore', { class: 'btn btn-small', 'data-fid': 'snap-' + s.index }, async () => { const stt = S.getSnapshotState(s.index); if (stt) restoreParsed({ state: stt, summary: C.summarizeState(stt, n), warnings: [], exportedAt: s.at }, 'the snapshot from ' + dateTimeLabel(s.at)); else toast('That snapshot could not be read.', { error: true }); })))) : h('p', { class: 'hint' }, 'No snapshots yet. The first one is taken automatically after your next change.');

    const dataCard = h('div', { class: 'panel set-card' }, h('h3', {}, 'Data safety'),
      row('Saved in this browser', h('span', { class: 'pill ' + (st.local === 'error' || st.memoryOnly ? 'bad' : 'good') }, st.memoryOnly ? 'Storage blocked' : st.local === 'error' ? 'Last save failed' : st.lastSavedAt ? 'OK · ' + timeLabel(st.lastSavedAt) : 'OK'), 'Every change is saved immediately and checked.'),
      row('Protected from cleanup', h('span', { class: 'pill ' + (st.persist === 'granted' ? 'good' : 'neutral') }, st.persist === 'granted' ? 'Yes' : st.persist === 'unsupported' ? 'Not supported' : 'Not granted'), 'If “not granted”, the browser may clear data when disk space is very low. Backups cover that.'),
      row('Last backup file', h('span', {}, lb ? dateTimeLabel(lb) + ' (' + daysAgo(lb) + ' days ago)' : 'Never'), 'A backup is a normal .json file you can keep anywhere.'),
      h('div', { class: 'btn-row' }, btn('Download backup', { class: 'btn btn-primary', 'data-fid': 'set-export' }, exportBackup), btn('Restore from backup file…', { class: 'btn', 'data-fid': 'set-import' }, () => $('#importFile').click())),
      h('h4', {}, 'Automatic backup file (optional)'), fileBlock,
      h('h4', {}, 'Automatic snapshots'), h('p', { class: 'hint' }, 'BAC QUEST keeps up to 12 snapshots inside this browser: one a day, plus one before every update or restore. Use them to undo a mistake.'), snapList,
      row('Remind me to back up', select([[0, 'Never'], [3, 'After 3 days'], [7, 'After 7 days'], [14, 'After 14 days'], [30, 'After 30 days']], set.backupReminderDays, (v) => commit((s) => { s.settings.backupReminderDays = Number(v); }, { partial: true, celebrate: false }), 'Backup reminder'), 'Shown as a message at the top; skipped while a linked file is working.'));

    /* --- reminders */
    const perm = permission(), on = remindersOn();
    const remBtn = !notifSupported ? h('span', { class: 'pill bad' }, 'Not supported') : on ? btn('Turn reminders off', { class: 'btn', 'data-fid': 'rem-off' }, disableReminders) : btn(perm === 'denied' ? 'Blocked: see how to fix' : 'Enable reminders', { class: 'btn btn-primary', 'data-fid': 'rem-on' }, perm === 'denied' ? () => toast('Click the lock icon beside the address bar, set Notifications to Allow for this site, then reload.', { error: true, ms: 9000 }) : enableReminders);
    const rem = set.reminders;
    const reminderCard = h('div', { class: 'panel set-card' }, h('h3', {}, 'Reminders'),
      h('p', { class: 'hint strong' }, 'Honest limit: browser reminders only work while BAC QUEST is open in a tab or app window. If the browser is closed or the computer sleeps, nothing can pop up. For reminders that always work, use the calendar export below.'),
      row('Browser notifications', remBtn, 'Permission: ' + perm),
      row('Remind me before a mission', select([[0, 'Not before'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes']], rem.leadMinutes, (v) => commit((s) => { s.settings.reminders.leadMinutes = Number(v); }, { partial: true, celebrate: false }), 'Lead time')),
      row('When a mission starts', check('Notify me', rem.notifyStart, (v) => commit((s) => { s.settings.reminders.notifyStart = v; }, { partial: true, celebrate: false }))),
      row('When a mission is overdue', check('Notify me once', rem.notifyOverdue, (v) => commit((s) => { s.settings.reminders.notifyOverdue = v; }, { partial: true, celebrate: false }))),
      h('div', { class: 'btn-row' }, btn('Send a test notification', { class: 'btn btn-small', 'data-fid': 'rem-test' }, () => { if (permission() !== 'granted') { toast('Enable reminders first.', { error: true }); return; } sendNotification({ title: 'BAC QUEST test', body: 'If you can read this, notifications work.', tag: 'bq-test' }); toast('Test notification sent.'); })),
      row('Time zone', select([['morocco', 'Morocco time (Africa/Casablanca)'], ['device', 'This computer’s time zone']], set.timeZone, (v) => commit((s) => { s.settings.timeZone = v; }, { celebrate: false }), 'Time zone'), 'Missions follow this clock. Morocco time is safest if your computer clock is not set to Morocco.'),
      h('h4', {}, 'Calendar reminders that work when the browser is closed'),
      h('p', { class: 'hint' }, 'Download a calendar file and open it with GNOME Calendar, Thunderbird or your phone’s calendar. Your weekly missions appear as repeating events with alarms. It repeats until your exam date (or 30 June 2027 if none is set). Re-import after changing your plan, and delete the old calendar first to avoid duplicates.'),
      row('Alarm before each mission', select([[0, 'At start'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']], set.calendarLeadMinutes, (v) => commit((s) => { s.settings.calendarLeadMinutes = Number(v); }, { partial: true, celebrate: false }), 'Calendar alarm')),
      h('div', { class: 'btn-row' }, btn('Download calendar file (.ics)', { class: 'btn btn-primary', 'data-fid': 'ics' }, () => {
        const r = C.buildICS(state, now());
        if (!r.events) { toast('No missions to export yet.', { error: true }); return; }
        S.download('bac-quest-missions.ics', r.text, 'text/calendar'); toast('Calendar file downloaded (' + r.events + ' missions).');
      })));

    /* --- targets */
    const total = h('strong', {}, '');
    const upd = () => { total.textContent = fmt(C.MAIN_SUBJECTS.reduce((a, s) => a + state.settings.weeklyTargets[s], 0)); };
    const targetRows = C.MAIN_SUBJECTS.map((s) => {
      const inp = h('input', { type: 'number', min: 0, max: 3000, step: 15, 'aria-label': s + ' weekly target in minutes', 'data-fid': 'tg-' + s });
      inp.value = set.weeklyTargets[s];
      const hint = h('small', {}, fmt(set.weeklyTargets[s]));
      inp.addEventListener('change', () => { const v = Math.min(3000, Math.max(0, Math.round(Number(inp.value) || 0))); inp.value = v; hint.textContent = fmt(v); commit((x) => { x.settings.weeklyTargets[s] = v; }, { partial: true, celebrate: false }); upd(); });
      return h('div', { class: 'set-row' }, h('div', { class: 'set-label tg' }, h('i', { class: 'swatch', style: { background: C.SUBJECT_COLORS[s] } }), h('strong', {}, s)), h('div', { class: 'set-control' }, inp, h('span', { class: 'unit' }, 'min / week'), hint));
    });
    const exam = h('input', { type: 'date', 'aria-label': 'Exam date', 'data-fid': 'exam-date' }); exam.value = set.examDate;
    exam.addEventListener('change', () => commit((s) => { s.settings.examDate = C.isDateKey(exam.value) ? exam.value : ''; }, { partial: true, celebrate: false }));
    const grade = h('input', { type: 'number', min: 0, max: 20, step: 0.5, 'aria-label': 'Target grade', 'data-fid': 'grade' }); grade.value = set.targetGrade;
    grade.addEventListener('change', () => { const v = Math.min(20, Math.max(0, Number(grade.value) || 18)); grade.value = v; commit((s) => { s.settings.targetGrade = v; }, { partial: true, celebrate: false }); });
    upd();
    const targetCard = h('div', { class: 'panel set-card' }, h('h3', {}, 'Goals and weekly targets'),
      h('p', { class: 'hint' }, 'The ring on the Today screen and the Progress charts measure you against these numbers. The preloaded plan adds up to 15 hours.'),
      targetRows, h('div', { class: 'set-row total-row' }, h('div', { class: 'set-label' }, h('strong', {}, 'Total self-study per week')), h('div', { class: 'set-control' }, total)),
      row('National exam date', exam, 'Set it once the official date is published. Nothing is assumed.'), row('Target grade', grade, 'Out of 20.'));

    /* --- maintenance + about */
    const aboutCard = h('div', { class: 'panel set-card' }, h('h3', {}, 'Maintenance and about'),
      row('Missing preloaded missions', btn('Add back missing ones', { class: 'btn btn-small', 'data-fid': 'presets' }, () => confirmDialog({ title: 'Add back preloaded missions?', body: 'Only preloaded missions that are currently missing will be added. Nothing else changes.', yes: 'Add them' }).then((ok) => { if (!ok) return; const added = commit((s) => C.restoreMissingPresets(s), { celebrate: false }); toast(added ? added + ' mission' + (added > 1 ? 's' : '') + ' added back.' : 'Nothing was missing.'); })), 'Useful if you deleted one by accident.'),
      row('App looks outdated?', btn('Refresh app files', { class: 'btn btn-small', 'data-fid': 'refresh-app' }, refreshAppFiles), 'Clears only the offline copy of the program files and reloads. Your missions, XP and history are not touched.'),
      row('Version', h('span', { class: 'mono' }, 'v' + C.APP_VERSION + ' · data format ' + C.SCHEMA_VERSION)),
      row('Where is my data?', h('span', {}, 'In this browser, for the address ' + location.host), 'Always open BAC QUEST at the same address in the same browser profile.'));

    setKids(root, [dataCard, reminderCard, targetCard, aboutCard]);
  }

  /* ------------------------------------------------------ backup & restore */
  function exportBackup() {
    const iso = new Date().toISOString();
    commit((s) => { s.meta.lastBackupAt = iso; });
    S.download('bac-quest-backup-' + now().dateKey + '.json', C.buildBackup(state, iso), 'application/json');
    toast('Backup downloaded. Keep it somewhere safe (a USB stick or cloud drive).');
    dismissed.delete('backup');
  }

  function compareTable(cur, inc) {
    const rows = [['Missions in plan', 'tasks'], ['Completed missions', 'completions'], ['Total XP', 'xp'], ['Scores logged', 'scores'], ['Last activity', 'lastActivity']];
    return h('table', { class: 'compare' }, h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Now'), h('th', {}, 'Replace with'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('th', {}, r[0]), h('td', {}, cur[r[1]] == null ? '—' : String(cur[r[1]])), h('td', {}, inc[r[1]] == null ? '—' : String(inc[r[1]]))))));
  }

  // Replace everything with another state, after showing exactly what will change.
  async function restoreParsed(parsed, label) {
    const body = ['This replaces your current plan and progress with ' + label + '.', compareTable(C.summarizeState(state, now()), parsed.summary)];
    if (parsed.warnings && parsed.warnings.length) body.push(h('div', { class: 'warn-box' }, h('strong', {}, 'Please note'), h('ul', {}, parsed.warnings.map((w) => h('li', {}, w)))));
    body.push('Your current data is saved as a snapshot first, so you can undo this from Settings & data.');
    const ok = await confirmDialog({ title: 'Restore this data?', body: body, yes: 'Replace my data', danger: true });
    if (!ok) return;
    S.addSnapshot(JSON.stringify(state), 'Before restoring ' + label);
    const r = replaceState(parsed.state);
    S.resolveNewer();
    toast(r.ok ? 'Restored. ' + parsed.summary.completions + ' completed missions and ' + parsed.summary.xp + ' XP are back.' : 'Restored on screen, but saving failed. Download a backup now.', r.ok ? { gold: true } : { error: true });
    renderAll();
  }

  // Throw away the offline copy of the program files (never your data) and load them again.
  async function refreshAppFiles() {
    const ok = await confirmDialog({ title: 'Refresh the app files?', body: ['The page will reload with the newest program files from the folder you are running.', 'Your missions, XP, history and backups are NOT touched. Only the offline copy of the program is cleared.'], yes: 'Refresh now' });
    if (!ok) return;
    try {
      if ('serviceWorker' in navigator) (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister());
      if (window.caches) (await caches.keys()).forEach((k) => caches.delete(k));
    } catch (e) { console.warn(e); }
    setTimeout(() => location.reload(), 400);
  }

  async function importFromInput(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { toast('That file is too large to be a BAC QUEST backup.', { error: true }); return; }
    let text;
    try { text = await f.text(); } catch (e) { toast('The file could not be read.', { error: true }); return; }
    const r = C.parseBackup(text, now().dateKey);
    if (!r.ok) { toast(r.error, { error: true, ms: 8000 }); return; }
    restoreParsed(r, 'the backup file “' + f.name + '”' + (r.exportedAt ? ' (made ' + dateTimeLabel(r.exportedAt) + ')' : ''));
  }

  async function linkFile() {
    const r = await S.linkFile();
    if (r.ok) toast('Linked. BAC QUEST will keep this file up to date.');
    else if (r.reason !== 'cancelled') toast('Could not link the file: ' + (r.error && r.error.message || r.reason), { error: true });
    renderAll();
  }
  async function reconnectFile() {
    const r = await S.reconnectFile();
    if (!r.ok) toast('Permission was not granted, so the file was not touched.', { error: true });
    else if (r.pendingNewer) toast('The file has newer data. Choose what to do in the message at the top.', { ms: 6000 });
    else { await S.writeFileNow(); toast('File reconnected.'); }
    renderAll();
  }

  /* ---------------------------------------------------------------- startup */
  function init() {
    const loaded = S.load();
    state = loaded.state; loadInfo = loaded.info;
    const n0 = now(), before = JSON.stringify(state.achievements);
    C.syncAchievements(state, C.computeMetrics(state, n0), n0.dateKey, true);       // record existing badges quietly
    try { if (loadInfo.source === 'migrated' && localStorage.getItem('bacQuestNotifications') === 'yes' && permission() === 'granted') state.settings.reminders.enabled = true; } catch (e) { /* ignore */ }
    if (loadInfo.needsSave || JSON.stringify(state.achievements) !== before) S.save(state);

    $$('.nav-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#importBtn').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importFromInput);
    $('#notifyBtn').addEventListener('click', () => (remindersOn() ? disableReminders() : enableReminders()));
    $('#saveChip').addEventListener('click', () => setView('settings'));
    $('#taskForm').addEventListener('submit', submitTask);
    $('#taskForm').addEventListener('input', () => { $('#taskErrors').classList.add('hidden'); syncRepeatFields(); updateTaskPreview(); });
    $('#closeTask').addEventListener('click', () => $('#taskDialog').close());
    $('#cancelTask').addEventListener('click', () => $('#taskDialog').close());
    $('#taskDialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

    let sig = '';
    S.subscribe((st) => {
      renderSaveStatus();
      const next = [st.file.state, st.file.name, st.file.supported, st.persist, st.memoryOnly, st.local, !!st.file.pendingNewer].join('|');
      if (next !== sig) { sig = next; renderBanners(); if (ui.view === 'settings' && !$('dialog[open]')) keepFocus(renderSettings); }
    });
    S.onExternalChange((st) => { state = st; renderAll(); toast('Updated from another BAC QUEST window.'); }, () => state.meta.revision);

    S.requestPersistence();
    S.initFile(() => state).then(() => renderAll());
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      navigator.serviceWorker.register('sw.js?v=' + C.APP_VERSION).catch((e) => console.warn('Offline mode unavailable:', e));
      navigator.serviceWorker.ready.then((r) => { swReg = r; }).catch(() => {});
    }

    setView('today');
    { const n1 = now(); ui.lastMinute = n1.dateKey + ':' + n1.minutes; }
    const tick = () => {
      remindersTick();
      const n = now(), key = n.dateKey + ':' + n.minutes;
      if (key === ui.lastMinute) return;
      ui.lastMinute = key;
      if ($('dialog[open]')) return;
      const ae = document.activeElement, typing = ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName);
      if ((ui.view === 'today' || ui.view === 'week') && !typing) renderAll(); else renderChrome();   // never rebuild a form you are typing in
    };
    setInterval(tick, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
    window.addEventListener('focus', tick);
    setTimeout(tick, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
