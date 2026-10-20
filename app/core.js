/*
 * BAC QUEST — core.js
 * --------------------------------------------------------------
 * All the "thinking" of the app lives here: the data format, upgrading old
 * saves, XP, streaks, achievements, schedule-conflict checks, reminder timing,
 * calendar export and backup validation.
 *
 * This file never touches the page (no DOM), so it can be tested on its own
 * (see dev-tests/). Nothing in here saves data; storage.js does that.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BQCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_VERSION = '3.0.0';
  const SCHEMA_VERSION = 3;
  const LEVEL_XP = 250;                       // XP needed per level (unchanged from earlier versions)
  const DEFAULT_EXAM_END = '2027-06-30';      // calendar export stops here unless you set an exam date

  const MAIN_SUBJECTS = ['Mathematics', 'Physics-Chemistry', 'SVT', 'Philosophy', 'English'];
  const SUBJECTS = MAIN_SUBJECTS.concat(['Other']);
  const SCORE_SUBJECTS = MAIN_SUBJECTS.concat(['French', 'Arabic', 'Islamic Education', 'Other']);
  const SUBJECT_COLORS = {
    'Mathematics': '#80a9ff', 'Physics-Chemistry': '#f4b35e', 'SVT': '#6ed7a6',
    'Philosophy': '#c3a0ff', 'English': '#68d7e5', 'Other': '#a4aabc',
    'French': '#ff9fb5', 'Arabic': '#e7d27a', 'Islamic Education': '#9fd0a0'
  };
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];  // the week starts on Monday

  // Weekly self-study targets in minutes (total = 15 hours).
  const DEFAULT_TARGETS = { 'Mathematics': 270, 'Physics-Chemistry': 270, 'SVT': 180, 'Philosophy': 90, 'English': 90 };

  // The preloaded 15-hour plan. IDs must never change: past completions are linked to them.
  const DEFAULT_TASKS = [
    { id: 'plan-mon-math', day: 1, subject: 'Mathematics', name: 'Solve Mathematics Bac exercises', start: '17:00', duration: 90 },
    { id: 'plan-mon-english', day: 1, subject: 'English', name: 'Review vocabulary and grammar', start: '19:00', duration: 30 },
    { id: 'plan-tue-physics', day: 2, subject: 'Physics-Chemistry', name: 'Review today’s class and solve focused exercises', start: '19:00', duration: 60 },
    { id: 'plan-tue-svt', day: 2, subject: 'SVT', name: 'Recall one SVT lesson from memory', start: '20:15', duration: 30 },
    { id: 'plan-wed-english', day: 3, subject: 'English', name: 'Reading comprehension or short writing practice', start: '18:30', duration: 30 },
    { id: 'plan-wed-philosophy', day: 3, subject: 'Philosophy', name: 'Review one concept, argument and counterargument', start: '19:15', duration: 30 },
    { id: 'plan-thu-physics', day: 4, subject: 'Physics-Chemistry', name: 'Complete a Bac-style Physics-Chemistry exercise set', start: '11:00', duration: 90 },
    { id: 'plan-thu-svt', day: 4, subject: 'SVT', name: 'Interpret documents and write scientific conclusions', start: '16:00', duration: 60 },
    { id: 'plan-fri-philosophy', day: 5, subject: 'Philosophy', name: 'Plan a structured answer to a course question', start: '19:00', duration: 30 },
    { id: 'plan-fri-english', day: 5, subject: 'English', name: 'Practise grammar and exam-style writing', start: '19:45', duration: 30 },
    { id: 'plan-sat-math', day: 6, subject: 'Mathematics', name: 'Timed national-exam Mathematics questions', start: '14:30', duration: 90 },
    { id: 'plan-sat-physics', day: 6, subject: 'Physics-Chemistry', name: 'Timed Physics-Chemistry exercises and corrections', start: '16:30', duration: 90 },
    { id: 'plan-sat-svt', day: 6, subject: 'SVT', name: 'Reproduce diagrams and explain mechanisms', start: '19:00', duration: 60 },
    { id: 'plan-sun-math', day: 0, subject: 'Mathematics', name: 'Weekly review: solve exercises and correct mistakes', start: '10:00', duration: 90 },
    { id: 'plan-sun-physics', day: 0, subject: 'Physics-Chemistry', name: 'Recall formulas and reaction methods', start: '15:00', duration: 30 },
    { id: 'plan-sun-svt', day: 0, subject: 'SVT', name: 'Review definitions and difficult points', start: '16:00', duration: 30 },
    { id: 'plan-sun-philosophy', day: 0, subject: 'Philosophy', name: 'Recall definitions, arguments and philosophers', start: '17:00', duration: 30 }
  ];

  // School timetable 2BACSPF-1 (day, start, end, subject, room) — 31 hours per week.
  const DEFAULT_SCHOOL = [
    [1, '08:00', '10:00', 'French', 'S9'], [1, '10:00', '12:00', 'French', 'S11'], [1, '14:00', '16:00', 'Physics-Chemistry', 'S7'],
    [2, '09:00', '10:00', 'English', 'S22'], [2, '10:00', '12:00', 'Physics-Chemistry', 'S7'], [2, '14:00', '16:00', 'Philosophy', 'S11'],
    [2, '16:00', '17:00', 'Arabic', 'S10'], [2, '17:00', '18:00', 'Islamic Education', 'S4'],
    [3, '08:00', '09:00', 'Physical Education', ''], [3, '09:00', '10:00', 'Mathematics', 'S11'], [3, '10:00', '11:00', 'French', 'S9'], [3, '16:00', '18:00', 'SVT', 'L12'],
    [4, '08:00', '10:00', 'French', 'S9'],
    [5, '09:00', '10:00', 'Arabic', 'S10'], [5, '10:00', '12:00', 'Mathematics', 'S11'], [5, '14:00', '15:00', 'French', 'S9'],
    [5, '15:00', '16:00', 'English', 'S22'], [5, '16:00', '18:00', 'SVT', 'L12'],
    [6, '08:00', '10:00', 'Physics-Chemistry', 'L14'], [6, '10:00', '11:00', 'English', 'S22'], [6, '11:00', '12:00', 'Physical Education', '']
  ];

  /* ---------------------------------------------------------- small helpers */
  const pad = (n) => String(n).padStart(2, '0');
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const BAD_KEYS = { '__proto__': 1, 'constructor': 1, 'prototype': 1 };
  function clampInt(v, min, max, def) {
    const n = Number(v);
    if (v === null || v === '' || !Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function clampNum(v, min, max, def) {
    const n = Number(v);
    if (v === null || v === '' || !Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }
  function isoOr(v, fallback) { return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : fallback; }
  function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
  function uid(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function checksum(text) {                    // small fingerprint used to notice damaged/edited backups
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  }

  /* ------------------------------------------------------------ time & dates
   * Dates are plain "YYYY-MM-DD" strings and times are "HH:MM" strings, so
   * daylight-saving or time-zone surprises can never shift a saved mission.
   * Only "what time is it right now" depends on the time zone (Morocco by default).
   */
  const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
  const toMin = (s) => { const p = s.split(':'); return Number(p[0]) * 60 + Number(p[1]); };
  const fromMin = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  function keyParts(k) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k); return m ? [+m[1], +m[2], +m[3]] : null; }
  function isDateKey(k) {
    const p = typeof k === 'string' ? keyParts(k) : null;
    if (!p) return false;
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return d.getUTCFullYear() === p[0] && d.getUTCMonth() === p[1] - 1 && d.getUTCDate() === p[2];
  }
  const toUTC = (k) => { const p = keyParts(k); return Date.UTC(p[0], p[1] - 1, p[2]); };
  function keyFromUTC(ms) { const d = new Date(ms); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  const shiftKey = (k, n) => keyFromUTC(toUTC(k) + n * 86400000);
  const dowOf = (k) => new Date(toUTC(k)).getUTCDay();
  const diffDays = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 86400000);
  function weekStart(k) { const d = dowOf(k); return shiftKey(k, d === 0 ? -6 : 1 - d); }
  function weekKeys(k) { const s = weekStart(k); return Array.from({ length: 7 }, (_, i) => shiftKey(s, i)); }
  function formatDuration(mins) {
    mins = Math.max(0, Math.round(mins));
    const h = Math.floor(mins / 60), m = mins % 60;
    return h ? (m ? h + 'h ' + m + 'm' : h + 'h') : m + 'm';
  }
  function formatDateKey(k, opts) {
    const p = keyParts(k); if (!p) return k;
    return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)).toLocaleDateString(undefined, Object.assign({ timeZone: 'UTC' }, opts || { weekday: 'short', day: 'numeric', month: 'short' }));
  }

  // "Now" in Morocco time (default) or the computer's own time zone.
  function nowInfo(settings, date) {
    date = date || new Date();
    const opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' };
    if (!settings || settings.timeZone !== 'device') opts.timeZone = 'Africa/Casablanca';
    let parts;
    try { parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(date); }
    catch (e) { delete opts.timeZone; parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(date); }
    const g = (t) => Number(parts.find((p) => p.type === t).value);
    const hour = g('hour') % 24;
    const dateKey = g('year') + '-' + pad(g('month')) + '-' + pad(g('day'));
    return { dateKey: dateKey, minutes: hour * 60 + g('minute'), seconds: g('second'), dow: dowOf(dateKey), ts: date.getTime() };
  }

  /* ------------------------------------------------- normalising / upgrading
   * normalizeState() accepts ANYTHING (an old v1 save, a backup file, a damaged
   * object) and returns a clean, current-format state. It never throws and it
   * never invents progress: it only repairs or drops entries that are unusable.
   */
  function normalizeTask(t) {
    if (!isObj(t)) return null;
    const name = str(t.name, 90);
    if (!name) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(t.start || ''));
    if (!m) return null;
    const start = pad(+m[1]) + ':' + m[2];
    if (!isTime(start)) return null;
    const repeat = t.repeat === 'once' && isDateKey(t.date) ? 'once' : 'weekly';
    let day = repeat === 'once' ? dowOf(t.date) : Number(t.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    let duration = clampInt(t.duration, 5, 600, 60);
    duration = Math.min(duration, 1440 - toMin(start));       // a mission cannot run past midnight
    if (duration < 5) return null;
    const out = {
      id: str(t.id, 80) || uid('task'), name: name, subject: SUBJECTS.indexOf(t.subject) >= 0 ? t.subject : 'Other',
      day: day, start: start, duration: duration, repeat: repeat, createdAt: Number(t.createdAt) || 0
    };
    if (repeat === 'once') out.date = t.date;
    else if (isDateKey(t.startDate)) out.startDate = t.startDate;
    if (t.preset) out.preset = true;
    return out;
  }

  function normalizeSchool(list) {
    const out = [], seen = {};
    list.forEach((l, i) => {
      let day, start, end, subject, room, id;
      if (Array.isArray(l)) { day = l[0]; start = l[1]; end = l[2]; subject = l[3]; room = l[4]; }
      else if (isObj(l)) { day = l.day; start = l.start; end = l.end; subject = l.subject; room = l.room; id = l.id; }
      else return;
      day = Number(day);
      if (!Number.isInteger(day) || day < 0 || day > 6 || !isTime(start) || !isTime(end) || toMin(end) <= toMin(start)) return;
      subject = str(subject, 40); if (!subject) return;
      id = str(id, 80) || ('sch-' + day + '-' + start.replace(':', '') + '-' + i);
      while (seen[id]) id += 'x';
      seen[id] = 1;
      out.push({ id: id, day: day, start: start, end: end, subject: subject, room: str(room, 12) });
    });
    return out;
  }

  function normalizeSettings(s) {
    s = isObj(s) ? s : {};
    const targets = {};
    MAIN_SUBJECTS.forEach((sub) => { targets[sub] = clampInt(isObj(s.weeklyTargets) ? s.weeklyTargets[sub] : null, 0, 3000, DEFAULT_TARGETS[sub]); });
    const r = isObj(s.reminders) ? s.reminders : {};
    return {
      weeklyTargets: targets,
      reminders: { enabled: r.enabled === true, leadMinutes: clampInt(r.leadMinutes, 0, 120, 0), notifyStart: r.notifyStart !== false, notifyOverdue: r.notifyOverdue !== false },
      examDate: isDateKey(s.examDate) ? s.examDate : '',
      targetGrade: clampNum(s.targetGrade, 0, 20, 18),
      backupReminderDays: [0, 3, 7, 14, 30].indexOf(Number(s.backupReminderDays)) >= 0 ? Number(s.backupReminderDays) : 7,
      calendarLeadMinutes: clampInt(s.calendarLeadMinutes, 0, 120, 10),
      timeZone: s.timeZone === 'device' ? 'device' : 'morocco'
    };
  }

  function defaultTasks() { return DEFAULT_TASKS.map((t) => Object.assign({ repeat: 'weekly', preset: true, createdAt: 0 }, t)); }

  function normalizeState(raw, todayKey) {
    const warnings = [];
    const src = isObj(raw) ? raw : {};
    todayKey = isDateKey(todayKey) ? todayKey : nowInfo().dateKey;

    // missions (also upgrades the very first prototype's "default-" schedule, as before)
    let tasksIn = Array.isArray(src.tasks) ? src.tasks : [];
    if (tasksIn.some((t) => isObj(t) && String(t.id || '').indexOf('default-') === 0)) {
      tasksIn = defaultTasks().concat(tasksIn.filter((t) => !(isObj(t) && String(t.id || '').indexOf('default-') === 0)));
    }
    const tasks = [], ids = {};
    let droppedTasks = 0;
    tasksIn.forEach((t) => {
      const n = normalizeTask(t);
      if (!n) { droppedTasks++; return; }
      while (ids[n.id]) n.id += 'x';
      ids[n.id] = 1; tasks.push(n);
    });
    if (droppedTasks) warnings.push(droppedTasks + ' unreadable mission(s) were skipped.');

    // completion history
    const completions = {};
    let droppedC = 0;
    if (isObj(src.completions)) {
      Object.keys(src.completions).forEach((key) => {
        const v = src.completions[key], i = key.indexOf('|');
        if (BAD_KEYS[key] || i < 1 || !isDateKey(key.slice(0, i)) || !isObj(v) || !v.done) { if (!BAD_KEYS[key] && isObj(v) && v.done) droppedC++; return; }
        completions[key] = {
          done: true, minutes: clampInt(v.minutes, 0, 1440, 0), xp: clampInt(v.xp, 0, 10000, 0),
          subject: str(v.subject, 40) || 'Other', taskName: str(v.taskName, 90), completedAt: Number(v.completedAt) || 0
        };
      });
    }
    if (droppedC) warnings.push(droppedC + ' unreadable history entr' + (droppedC === 1 ? 'y was' : 'ies were') + ' skipped.');

    const skips = {};
    if (isObj(src.skips)) Object.keys(src.skips).forEach((k) => { const i = k.indexOf('|'); if (!BAD_KEYS[k] && i > 0 && isDateKey(k.slice(0, i)) && src.skips[k]) skips[k] = Number(src.skips[k]) || 1; });

    // reminder memory (keeps only the last 14 days so it cannot grow forever)
    const notified = {}, oldest = shiftKey(todayKey, -14);
    if (isObj(src.notified)) Object.keys(src.notified).forEach((k) => { const d = k.slice(0, 10); if (!BAD_KEYS[k] && isDateKey(d) && d >= oldest) notified[k] = Number(src.notified[k]) || 1; });

    const scores = [];
    (Array.isArray(src.scores) ? src.scores : []).forEach((s) => {
      if (!isObj(s) || !isDateKey(s.date)) return;
      const score = Number(s.score);
      if (!Number.isFinite(score) || score < 0 || score > 20) return;
      scores.push({ id: str(s.id, 80) || uid('score'), date: s.date, subject: SCORE_SUBJECTS.indexOf(s.subject) >= 0 ? s.subject : 'Other', score: Math.round(score * 100) / 100, note: str(s.note, 120) });
    });

    const achievements = {};
    if (isObj(src.achievements)) Object.keys(src.achievements).forEach((k) => { const v = src.achievements[k]; if (!BAD_KEYS[k] && (v === '' || isDateKey(v))) achievements[k] = v; });

    const m = isObj(src.meta) ? src.meta : {};
    const legacyCreated = isDateKey(src.createdAt) ? src.createdAt + 'T12:00:00.000Z' : null;
    const state = {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        createdAt: isoOr(m.createdAt, legacyCreated || new Date().toISOString()),
        updatedAt: isoOr(m.updatedAt, '1970-01-01T00:00:00.000Z'),
        revision: clampInt(m.revision, 0, 1e9, 0),
        lastBackupAt: isoOr(m.lastBackupAt, null),
        lastRunVersion: str(m.lastRunVersion, 20),
        migratedFrom: m.migratedFrom || null
      },
      settings: normalizeSettings(src.settings),
      tasks: tasks,
      school: normalizeSchool(Array.isArray(src.school) ? src.school : DEFAULT_SCHOOL),
      completions: completions,
      skips: skips,
      scores: scores,
      notified: notified,
      achievements: achievements,
      xpBonus: clampInt(src.xpBonus, 0, 1e7, 0)
    };
    tasks.sort(taskOrder);
    return { state: state, warnings: warnings };
  }

  function taskOrder(a, b) { return a.day - b.day || a.start.localeCompare(b.start) || a.name.localeCompare(b.name); }

  function createFreshState(todayKey) {
    const r = normalizeState({ tasks: defaultTasks(), meta: { createdAt: new Date().toISOString() } }, todayKey);
    return r.state;
  }

  /* ---------------------------------------------------- missions & schedule */
  const completionKey = (dateKey, taskId) => dateKey + '|' + taskId;
  const earnedXP = (duration) => Math.max(10, Math.round(duration / 30) * 10);   // same rule as before
  const isDone = (state, taskId, dateKey) => Boolean(state.completions[completionKey(dateKey, taskId)]);
  const isSkipped = (state, taskId, dateKey) => Boolean(state.skips[completionKey(dateKey, taskId)]);

  function tasksOnDate(state, dateKey) {
    const dow = dowOf(dateKey);
    return state.tasks.filter((t) => t.repeat === 'once' ? t.date === dateKey : (t.day === dow && (!t.startDate || t.startDate <= dateKey))).sort(taskOrder);
  }
  // Completed missions on a date that are no longer in the plan (deleted/moved). Kept so history is never hidden.
  function orphansOnDate(state, dateKey) {
    const ids = {}; tasksOnDate(state, dateKey).forEach((t) => { ids[t.id] = 1; });
    return entriesOf(state).filter((e) => e.date === dateKey && !ids[e.taskId]);
  }

  function validateTaskInput(input, todayKey) {
    const errors = [];
    const name = str(input.name, 90);
    if (!name) errors.push('Give the mission a name.');
    const subject = SUBJECTS.indexOf(input.subject) >= 0 ? input.subject : null;
    if (!subject) errors.push('Choose a subject.');
    const repeat = input.repeat === 'once' ? 'once' : 'weekly';
    let day = Number(input.day);
    if (repeat === 'once') {
      if (!isDateKey(input.date)) errors.push('Choose a date for a one-time mission.'); else day = dowOf(input.date);
    } else if (!Number.isInteger(day) || day < 0 || day > 6) errors.push('Choose a day.');
    if (!isTime(input.start)) errors.push('Choose a start time.');
    const duration = Number(input.duration);
    if (!Number.isInteger(duration) || duration < 5 || duration > 600) errors.push('Duration must be between 5 and 600 minutes.');
    if (isTime(input.start) && Number.isInteger(duration) && toMin(input.start) + duration > 1440) errors.push('The mission would run past midnight. Shorten it or start earlier.');
    if (errors.length) return { ok: false, errors: errors };
    const task = { name: name, subject: subject, repeat: repeat, day: day, start: input.start, duration: duration };
    if (repeat === 'once') task.date = input.date; else task.startDate = isDateKey(input.startDate) ? input.startDate : (todayKey || undefined);
    if (task.startDate === undefined) delete task.startDate;
    return { ok: true, task: task };
  }

  const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;
  // Which school lessons / other missions would this mission collide with?
  function findConflicts(state, cand, ignoreId) {
    const s = toMin(cand.start), e = s + Number(cand.duration);
    const dow = cand.repeat === 'once' ? dowOf(cand.date) : Number(cand.day);
    const school = state.school.filter((l) => l.day === dow && overlaps(s, e, toMin(l.start), toMin(l.end)));
    const pool = cand.repeat === 'once' ? tasksOnDate(state, cand.date) : state.tasks.filter((t) => t.repeat !== 'once' && t.day === dow);
    const missions = pool.filter((t) => t.id !== ignoreId && overlaps(s, e, toMin(t.start), toMin(t.start) + t.duration));
    return { school: school, missions: missions };
  }
  // Conflicts between existing items on one weekday (used to highlight the timeline).
  function conflictIdsForDay(state, dow) {
    const ids = {}, ts = state.tasks.filter((t) => t.repeat !== 'once' && t.day === dow);
    ts.forEach((a, i) => {
      ts.slice(i + 1).forEach((b) => { if (overlaps(toMin(a.start), toMin(a.start) + a.duration, toMin(b.start), toMin(b.start) + b.duration)) { ids[a.id] = 1; ids[b.id] = 1; } });
      state.school.forEach((l) => { if (l.day === dow && overlaps(toMin(a.start), toMin(a.start) + a.duration, toMin(l.start), toMin(l.end))) ids[a.id] = 1; });
    });
    return ids;
  }

  function weekPlan(state, weekStartKey) {
    const bySubject = {}; let total = 0;
    weekKeys(weekStartKey).forEach((k) => tasksOnDate(state, k).forEach((t) => { bySubject[t.subject] = (bySubject[t.subject] || 0) + t.duration; total += t.duration; }));
    return { bySubject: bySubject, total: total };
  }
  function schoolMinutes(state, dow) { return state.school.filter((l) => l.day === dow).reduce((n, l) => n + toMin(l.end) - toMin(l.start), 0); }

  function taskStatus(state, task, dateKey, now) {
    if (isDone(state, task.id, dateKey)) return { code: 'done', label: 'Completed' };
    if (isSkipped(state, task.id, dateKey)) return { code: 'skipped', label: 'Skipped' };
    if (dateKey > now.dateKey) return { code: 'future', label: 'Planned' };
    if (dateKey < now.dateKey) return { code: 'missed', label: 'Missed' };
    const s = toMin(task.start), e = s + task.duration;
    if (now.minutes >= e) return { code: 'overdue', label: 'Overdue' };
    if (now.minutes >= s) return { code: 'current', label: 'In session' };
    return { code: 'upcoming', label: 'Up next' };
  }
  function nextMission(state, now) {
    const t = tasksOnDate(state, now.dateKey).find((x) => !isDone(state, x.id, now.dateKey) && !isSkipped(state, x.id, now.dateKey) && toMin(x.start) + x.duration > now.minutes);
    if (!t) return null;
    const s = toMin(t.start);
    return { task: t, inSession: now.minutes >= s, minutesUntil: s - now.minutes, minutesLeft: s + t.duration - now.minutes };
  }
  function overdueToday(state, now) {
    return tasksOnDate(state, now.dateKey).filter((t) => taskStatus(state, t, now.dateKey, now).code === 'overdue');
  }

  // Tick / untick a mission. XP is stored with the completion, so unticking removes exactly that XP.
  function toggleCompletion(state, task, dateKey, ts) {
    const key = completionKey(dateKey, task.id);
    if (state.completions[key]) { const xp = state.completions[key].xp; delete state.completions[key]; return { done: false, xp: xp }; }
    delete state.skips[key];
    const xp = earnedXP(task.duration);
    state.completions[key] = { done: true, minutes: task.duration, xp: xp, subject: task.subject, taskName: task.name, completedAt: ts };
    return { done: true, xp: xp };
  }
  function toggleSkip(state, task, dateKey, ts) {
    const key = completionKey(dateKey, task.id);
    if (state.completions[key]) return false;
    if (state.skips[key]) delete state.skips[key]; else state.skips[key] = ts;
    return true;
  }
  function restoreMissingPresets(state) {
    const have = {}; state.tasks.forEach((t) => { have[t.id] = 1; });
    let added = 0;
    defaultTasks().forEach((t) => { if (!have[t.id]) { state.tasks.push(normalizeTask(t)); added++; } });
    state.tasks.sort(taskOrder);
    return added;
  }

  /* ----------------------------------------------- metrics, XP & achievements */
  function entriesOf(state) {
    const out = [];
    Object.keys(state.completions).forEach((key) => {
      const v = state.completions[key]; if (!v || !v.done) return;
      const i = key.indexOf('|');
      out.push({ key: key, date: key.slice(0, i), taskId: key.slice(i + 1), minutes: v.minutes || 0, xp: v.xp || 0, subject: v.subject || 'Other', name: v.taskName || '' });
    });
    return out;
  }
  const RANKS = [[1, 'Recruit'], [4, 'Apprentice'], [8, 'Scholar'], [13, 'Strategist'], [19, 'Specialist'], [26, 'Elite'], [34, 'Master'], [43, 'Grandmaster'], [55, 'Bac Legend']];
  function rankFor(level) { let r = RANKS[0][1]; RANKS.forEach((x) => { if (level >= x[0]) r = x[1]; }); return r; }

  function computeMetrics(state, now) {
    const entries = entriesOf(state);
    const m = { entries: entries, completedCount: entries.length, minutes: 0, dayMinutes: {}, dayCounts: {}, weekMinutes: {}, weekSubject: {}, subjectMinutes: {} };
    let missionXP = 0;
    entries.forEach((e) => {
      m.minutes += e.minutes; missionXP += e.xp;
      m.dayMinutes[e.date] = (m.dayMinutes[e.date] || 0) + e.minutes;
      m.dayCounts[e.date] = (m.dayCounts[e.date] || 0) + 1;
      const ws = weekStart(e.date);
      m.weekMinutes[ws] = (m.weekMinutes[ws] || 0) + e.minutes;
      if (!m.weekSubject[ws]) m.weekSubject[ws] = {};
      m.weekSubject[ws][e.subject] = (m.weekSubject[ws][e.subject] || 0) + e.minutes;
      m.subjectMinutes[e.subject] = (m.subjectMinutes[e.subject] || 0) + e.minutes;
    });
    m.xp = missionXP + state.xpBonus;
    m.level = Math.floor(m.xp / LEVEL_XP) + 1;
    m.xpInLevel = m.xp % LEVEL_XP;
    m.rank = rankFor(m.level);

    const days = Object.keys(m.dayCounts).sort(), set = {};
    days.forEach((d) => { set[d] = 1; });
    let cur = 0, d = now.dateKey;
    if (!set[d]) d = shiftKey(d, -1);
    while (set[d]) { cur++; d = shiftKey(d, -1); }
    let best = 0, run = 0;
    days.forEach((day, i) => { run = i > 0 && shiftKey(days[i - 1], 1) === day ? run + 1 : 1; if (run > best) best = run; });
    m.currentStreak = cur; m.bestStreak = best;
    m.doneToday = Boolean(set[now.dateKey]);
    m.streakAtRisk = cur > 0 && !m.doneToday;
    m.maxDayCount = days.reduce((n, k) => Math.max(n, m.dayCounts[k]), 0);
    m.weekendDone = days.some((k) => dowOf(k) === 6 && set[shiftKey(k, 1)]);
    m.maxWeekMinutes = Object.keys(m.weekMinutes).reduce((n, k) => Math.max(n, m.weekMinutes[k]), 0);
    m.subjectsCompleted = Object.keys(m.subjectMinutes).length;
    m.allFiveStudied = MAIN_SUBJECTS.every((s) => (m.subjectMinutes[s] || 0) > 0);
    m.balancedWeek = Object.keys(m.weekSubject).some((w) => MAIN_SUBJECTS.every((s) => state.settings.weeklyTargets[s] > 0 && (m.weekSubject[w][s] || 0) >= state.settings.weeklyTargets[s]));
    m.scoreCount = state.scores.length;
    m.bestScore = state.scores.reduce((n, s) => Math.max(n, s.score), 0);
    m.hasBackup = Boolean(state.meta.lastBackupAt);
    return m;
  }

  const A = (id, icon, name, desc, tier, prog) => ({ id: id, icon: icon, name: name, desc: desc, tier: tier, prog: prog });
  const hrs = (h) => h * 60;
  const MASTER_GOALS = { 'Mathematics': 1200, 'Physics-Chemistry': 1200, 'SVT': 800, 'Philosophy': 400, 'English': 400 };
  const ACHIEVEMENTS = [
    A('first', '✦', 'First Clear', 'Complete your first mission.', 1, (m) => [m.completedCount, 1]),
    A('five', '✓', 'Getting Started', 'Complete 5 missions.', 1, (m) => [m.completedCount, 5]),
    A('twenty', '⚡', 'Momentum', 'Complete 20 missions.', 2, (m) => [m.completedCount, 20]),
    A('fifty', '◆', 'Fifty Clears', 'Complete 50 missions.', 3, (m) => [m.completedCount, 50]),
    A('hundred', '✪', 'Centurion', 'Complete 100 missions.', 4, (m) => [m.completedCount, 100]),
    A('fivehours', '◷', 'Time Invested', 'Complete 5 hours of planned study.', 1, (m) => [m.minutes, hrs(5)]),
    A('tenhours', '⌁', 'Deep Work', 'Complete 10 hours of planned study.', 2, (m) => [m.minutes, hrs(10)]),
    A('h50', '◈', 'Marathon Mind', 'Complete 50 hours of study.', 3, (m) => [m.minutes, hrs(50)]),
    A('h100', '☀', 'Hundred-Hour Club', 'Complete 100 hours of study.', 4, (m) => [m.minutes, hrs(100)]),
    A('streak3', '♨', 'On a Roll', 'Complete a mission 3 days in a row.', 1, (m) => [m.bestStreak, 3]),
    A('streak7', '✹', 'Unstoppable', 'Complete a mission 7 days in a row.', 2, (m) => [m.bestStreak, 7]),
    A('streak14', '▲', 'Two-Week Fortress', 'Keep a 14-day streak.', 3, (m) => [m.bestStreak, 14]),
    A('streak30', '✺', 'Iron Habit', 'Keep a 30-day streak.', 4, (m) => [m.bestStreak, 30]),
    A('xp500', '★', 'XP Hunter', 'Earn 500 XP.', 1, (m) => [m.xp, 500]),
    A('xp2500', '✩', 'XP Master', 'Earn 2,500 XP.', 3, (m) => [m.xp, 2500]),
    A('xp10000', '❖', 'XP Legend', 'Earn 10,000 XP.', 4, (m) => [m.xp, 10000]),
    A('balanced', '▦', 'Balanced Training', 'Complete a mission in 4 different subjects.', 2, (m) => [m.subjectsCompleted, 4]),
    A('allfive', '◎', 'Full Spectrum', 'Study all five main subjects at least once.', 2, (m) => [MAIN_SUBJECTS.filter((s) => (m.subjectMinutes[s] || 0) > 0).length, 5]),
    A('triple', '◉', 'Triple Threat', 'Complete 3 missions in a single day.', 2, (m) => [m.maxDayCount, 3]),
    A('weekend', '⚑', 'Weekend Warrior', 'Complete missions on both Saturday and Sunday.', 2, (m) => [m.weekendDone ? 1 : 0, 1]),
    A('fullweek', '◴', '15-Hour Week', 'Complete 15 hours of study in one week.', 3, (m) => [m.maxWeekMinutes, hrs(15)]),
    A('balancedweek', '⌖', 'Targets Locked', 'Reach every subject’s weekly target in the same week.', 4, (m) => [m.balancedWeek ? 1 : 0, 1])
  ].concat(MAIN_SUBJECTS.map((s) => A('master-' + s, '⬢', s + ' Master', 'Study ' + formatDuration(MASTER_GOALS[s]) + ' of ' + s + '.', 3, (m) => [m.subjectMinutes[s] || 0, MASTER_GOALS[s]])))
    .concat([
      A('backup', '⛨', 'Data Guardian', 'Export a backup file.', 1, (m) => [m.hasBackup ? 1 : 0, 1]),
      A('scorefirst', '✎', 'On the Record', 'Log your first real exam or test score.', 1, (m) => [m.scoreCount, 1]),
      A('score18', '⌬', 'Eighteen!', 'Log a score of 18/20 or more.', 4, (m) => [m.bestScore >= 18 ? 1 : 0, 1])
    ]);

  const achievementDone = (a, m) => { const p = a.prog(m); return p[0] >= p[1]; };
  const achievementRatio = (a, m) => { const p = a.prog(m); return Math.min(1, p[0] / p[1]); };
  // Achievements always follow your real history: untick a mission and a badge that depended on it locks again.
  // `silent` is used when loading/restoring, so we do not announce badges you already had.
  function syncAchievements(state, m, todayKey, silent) {
    const unlocked = [], relocked = [];
    ACHIEVEMENTS.forEach((a) => {
      const ok = achievementDone(a, m), has = Object.prototype.hasOwnProperty.call(state.achievements, a.id);
      if (ok && !has) { state.achievements[a.id] = silent ? '' : todayKey; if (!silent) unlocked.push(a); }
      else if (!ok && has) { delete state.achievements[a.id]; relocked.push(a.id); }
    });
    Object.keys(state.achievements).forEach((id) => { if (!ACHIEVEMENTS.some((a) => a.id === id)) delete state.achievements[id]; });
    return { unlocked: unlocked, relocked: relocked };
  }
  function nextAchievement(m) {
    let best = null, ratio = -1;
    ACHIEVEMENTS.forEach((a) => { if (achievementDone(a, m)) return; const r = achievementRatio(a, m); if (r > ratio) { ratio = r; best = a; } });
    return best;
  }

  /* ----------------------------------------------------------- statistics */
  function weeklySeries(m, now, count) {
    const out = [], cur = weekStart(now.dateKey);
    for (let i = count - 1; i >= 0; i--) { const s = shiftKey(cur, -7 * i); out.push({ start: s, minutes: m.weekMinutes[s] || 0, isCurrent: i === 0 }); }
    return out;
  }
  function heatmap(m, now, weeks) {
    const cols = [], cur = weekStart(now.dateKey);
    for (let w = weeks - 1; w >= 0; w--) {
      const s = shiftKey(cur, -7 * w);
      cols.push(Array.from({ length: 7 }, (_, i) => { const k = shiftKey(s, i); return { date: k, minutes: m.dayMinutes[k] || 0, future: k > now.dateKey }; }));
    }
    return cols;
  }
  function weekdayTotals(m) {
    const t = [0, 0, 0, 0, 0, 0, 0];
    Object.keys(m.dayMinutes).forEach((k) => { t[dowOf(k)] += m.dayMinutes[k]; });
    return t;
  }
  function scoreStats(state) {
    const by = {};
    state.scores.forEach((s) => { (by[s.subject] = by[s.subject] || []).push(s); });
    const rows = Object.keys(by).map((sub) => {
      const list = by[sub].slice().sort((a, b) => a.date.localeCompare(b.date));
      const avg = list.reduce((n, s) => n + s.score, 0) / list.length;
      return { subject: sub, count: list.length, average: Math.round(avg * 100) / 100, best: Math.max.apply(null, list.map((s) => s.score)), latest: list[list.length - 1].score };
    });
    const all = state.scores.reduce((n, s) => n + s.score, 0);
    return { rows: rows, overall: state.scores.length ? Math.round(all / state.scores.length * 100) / 100 : null };
  }
  function examCountdown(settings, now) { return settings.examDate ? diffDays(now.dateKey, settings.examDate) : null; }

  /* ------------------------------------------------------------ reminders
   * Returns the notifications that should be shown right now. Each one has a
   * unique key so it is shown only once. Windows are limited, so opening the
   * app late never causes a burst of old "missed" notifications.
   */
  function dueReminders(state, now) {
    const r = state.settings.reminders;
    if (!r.enabled) return [];
    const out = [], date = now.dateKey, cur = now.minutes;
    tasksOnDate(state, date).forEach((t) => {
      const ck = completionKey(date, t.id);
      if (state.completions[ck] || state.skips[ck]) return;
      const s = toMin(t.start), e = s + t.duration;
      const add = (kind, title, body) => { const key = date + '|' + t.id + '|' + kind; if (!state.notified[key]) out.push({ key: key, kind: kind, task: t, title: title, body: body }); };
      if (r.leadMinutes > 0 && cur >= s - r.leadMinutes && cur < s) add('before', 'Starting in ' + (s - cur) + ' min: ' + t.name, t.subject + ' · ' + formatDuration(t.duration) + ' at ' + t.start + '.');
      if (r.notifyStart && cur >= s && cur < Math.min(e, s + 15)) add('start', 'Time to study: ' + t.name, t.subject + ' · ' + formatDuration(t.duration) + '. Tick it off in BAC QUEST when you finish.');
      if (r.notifyOverdue && cur >= e && cur < e + 30) add('overdue', 'Not done yet: ' + t.name, 'Your ' + t.subject + ' session ended at ' + fromMin(e) + '. Finish it, skip it or reschedule it.');
    });
    return out;
  }

  /* ----------------------------------------- calendar export (.ics) for GNOME
   * A calendar app can remind you even when the browser is closed — this is
   * the dependable alternative to browser notifications. Times are "floating"
   * (plain wall-clock time), so they stay correct in Morocco's time changes.
   */
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function foldLine(line) {
    const enc = new TextEncoder();
    if (enc.encode(line).length <= 75) return line;
    const parts = []; let cur = '', bytes = 0, limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { parts.push(cur); cur = ch; bytes = b; limit = 74; } else { cur += ch; bytes += b; }
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }
  const icsLocal = (dateKey, minutes) => dateKey.replace(/-/g, '') + 'T' + pad(Math.floor(minutes / 60) % 24) + pad(minutes % 60) + '00';
  function buildICS(state, now, opts) {
    opts = opts || {};
    const lead = opts.leadMinutes == null ? state.settings.calendarLeadMinutes : opts.leadMinutes;
    const until = isDateKey(opts.until) ? opts.until : (state.settings.examDate || DEFAULT_EXAM_END);
    const stamp = new Date(now.ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BAC QUEST//Study Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:BAC QUEST study missions'];
    let count = 0;
    state.tasks.forEach((t) => {
      let first;
      if (t.repeat === 'once') { if (t.date < now.dateKey) return; first = t.date; }
      else { first = shiftKey(now.dateKey, (t.day - now.dow + 7) % 7); if (t.startDate && first < t.startDate) first = shiftKey(t.startDate, (t.day - dowOf(t.startDate) + 7) % 7); }
      if (first > until) return;
      const s = toMin(t.start);
      lines.push('BEGIN:VEVENT', 'UID:' + icsEscape(t.id) + '@bac-quest.local', 'DTSTAMP:' + stamp,
        'DTSTART:' + icsLocal(first, s), 'DTEND:' + icsLocal(s + t.duration >= 1440 ? shiftKey(first, 1) : first, (s + t.duration) % 1440));
      if (t.repeat !== 'once') lines.push('RRULE:FREQ=WEEKLY;BYDAY=' + BYDAY[t.day] + ';UNTIL=' + until.replace(/-/g, '') + 'T235959');
      lines.push('SUMMARY:' + icsEscape(t.subject + ' — ' + t.name),
        'DESCRIPTION:' + icsEscape(formatDuration(t.duration) + ' of focused study. Planned in BAC QUEST. Tick it off in the app when you finish.'),
        'CATEGORIES:Study', 'TRANSP:OPAQUE',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape('Study time: ' + t.name), 'TRIGGER:' + (lead > 0 ? '-PT' + lead + 'M' : 'PT0S'), 'END:VALARM', 'END:VEVENT');
      count++;
    });
    lines.push('END:VCALENDAR');
    return { text: lines.map(foldLine).join('\r\n') + '\r\n', events: count, until: until };
  }

  /* -------------------------------------------------- backups & validation */
  function summarizeState(state, now) {
    const m = computeMetrics(state, now || nowInfo(state.settings));
    const dates = m.entries.map((e) => e.date).sort();
    return { tasks: state.tasks.length, completions: m.completedCount, minutes: m.minutes, xp: m.xp, level: m.level, scores: state.scores.length, lastActivity: dates.length ? dates[dates.length - 1] : null, updatedAt: state.meta.updatedAt };
  }
  function buildBackup(state, nowIso) {
    const json = JSON.stringify(state);
    return JSON.stringify({ app: 'BAC QUEST', backupVersion: 3, appVersion: APP_VERSION, exportedAt: nowIso || new Date().toISOString(), checksum: checksum(json), state: state }, null, 2);
  }
  // Reads a backup file's text (current or any older format) and checks it carefully.
  function parseBackup(text, todayKey) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'The file is empty.' };
    if (text.length > 20 * 1024 * 1024) return { ok: false, error: 'The file is too large to be a BAC QUEST backup.' };
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'This is not a valid JSON file, so it cannot be a BAC QUEST backup.' }; }
    if (!isObj(obj)) return { ok: false, error: 'This file does not look like a BAC QUEST backup.' };
    if (obj.app && obj.app !== 'BAC QUEST') return { ok: false, error: 'This backup belongs to a different app (' + str(obj.app, 30) + ').' };
    const incoming = isObj(obj.state) ? obj.state : obj;
    if (!Array.isArray(incoming.tasks) || !isObj(incoming.completions)) return { ok: false, error: 'This file does not contain a BAC QUEST plan and history.' };
    const r = normalizeState(incoming, todayKey);
    const warnings = r.warnings.slice();
    let checksumOk = null;
    if (obj.checksum) { checksumOk = checksum(JSON.stringify(incoming)) === obj.checksum; if (!checksumOk) warnings.push('The checksum does not match: the file may have been edited or damaged.'); }
    if (incoming.schemaVersion && incoming.schemaVersion > SCHEMA_VERSION) warnings.push('This backup comes from a newer BAC QUEST version; some data may be ignored.');
    return { ok: true, state: r.state, warnings: warnings, checksumOk: checksumOk, exportedAt: isoOr(obj.exportedAt, null), summary: summarizeState(r.state, nowInfo(r.state.settings)) };
  }

  return {
    APP_VERSION, SCHEMA_VERSION, LEVEL_XP, DEFAULT_EXAM_END, MAIN_SUBJECTS, SUBJECTS, SCORE_SUBJECTS, SUBJECT_COLORS, DAY_NAMES, DAY_SHORT, WEEK_ORDER,
    DEFAULT_TARGETS, DEFAULT_TASKS, DEFAULT_SCHOOL, ACHIEVEMENTS, RANKS,
    pad, isObj, uid, checksum, isTime, toMin, fromMin, isDateKey, shiftKey, dowOf, diffDays, weekStart, weekKeys, formatDuration, formatDateKey, nowInfo,
    normalizeState, normalizeTask, normalizeSchool, createFreshState, defaultTasks, taskOrder,
    completionKey, earnedXP, isDone, isSkipped, tasksOnDate, orphansOnDate, validateTaskInput, findConflicts, conflictIdsForDay,
    weekPlan, schoolMinutes, taskStatus, nextMission, overdueToday, toggleCompletion, toggleSkip, restoreMissingPresets,
    entriesOf, rankFor, computeMetrics, achievementDone, achievementRatio, syncAchievements, nextAchievement,
    weeklySeries, heatmap, weekdayTotals, scoreStats, examCountdown, dueReminders, buildICS, foldLine, summarizeState, buildBackup, parseBackup
  };
});
