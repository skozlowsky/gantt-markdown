// ---------- Dates (days as integers since epoch, UTC) ----------
export const DAY = 86400000;

export function todayDay() {
  const d = new Date();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

export function toDay(s) {
  if (typeof s === 'number') return s;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
  if (m) return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY);
  const d = new Date(s);
  if (isNaN(d)) return todayDay();
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

export const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
export const weekday = (n) => new Date(n * DAY).getUTCDay();
export const isWeekend = (n) => {
  const w = weekday(n);
  return w === 0 || w === 6;
};

export function snap(n, excl) {
  if (excl) while (isWeekend(n)) n++;
  return n;
}

/** End (exclusive) after `dur` days, skipping weekends when excl. */
export function addDur(start, dur, excl) {
  if (!excl) return start + dur;
  let d = start;
  let left = dur;
  while (left > 0) {
    if (!isWeekend(d)) left--;
    d++;
  }
  return d;
}

export function daysBetween(a, b, excl) {
  if (!excl) return b - a;
  let n = 0;
  for (let d = a; d < b; d++) if (!isWeekend(d)) n++;
  return n;
}

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
export function fmtShort(n) {
  const d = new Date(n * DAY);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
export function monthLabel(n) {
  const d = new Date(n * DAY);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------- Estimates (PERT) ----------
const num = (v) => (v === '' || v == null ? NaN : Number(v));

export function getEst(t) {
  if (!t.est) return null;
  const m = num(t.est.m);
  if (!(m > 0)) return null;
  const o = num(t.est.o) > 0 ? num(t.est.o) : m;
  const p = num(t.est.p) > 0 ? num(t.est.p) : m;
  return { o, m, p, mean: (o + 4 * m + p) / 6, sd: (p - o) / 6 };
}

const ceilDays = (x) => Math.max(1, Math.ceil(x - 1e-9));

/** mode: 'expected' | 'o' | 'p' */
export function effDur(t, mode = 'expected') {
  if (t.milestone) return 0;
  const e = getEst(t);
  if (e) {
    if (mode === 'o') return ceilDays(e.o);
    if (mode === 'p') return ceilDays(e.p);
    if (t.useEstimate) return ceilDays(e.mean);
  }
  return Math.max(1, Math.round(Number(t.duration) || 1));
}

// ---------- Scheduling ----------
export function schedule(p, mode = 'expected') {
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const res = new Map();
  const visiting = new Set();
  const excl = !!p.excludeWeekends;
  const calc = (t) => {
    if (res.has(t.id)) return res.get(t.id);
    if (visiting.has(t.id)) return null; // cycle guard
    visiting.add(t.id);
    const deps = (t.deps || []).map((id) => byId.get(id)).filter(Boolean);
    let start;
    if (deps.length) {
      const ends = deps.map((d) => calc(d)).filter(Boolean).map((r) => r.end);
      start = ends.length ? Math.max(...ends) : toDay(t.start);
    } else start = toDay(t.start);
    start = snap(start, excl);
    const dur = effDur(t, mode);
    const end = dur === 0 ? start : addDur(start, dur, excl);
    const r = { start, end, dur };
    res.set(t.id, r);
    visiting.delete(t.id);
    return r;
  };
  p.tasks.forEach(calc);
  return res;
}

export function projectSpan(p, sch) {
  let min = Infinity;
  let max = -Infinity;
  for (const t of p.tasks) {
    const s = sch.get(t.id);
    if (!s) continue;
    min = Math.min(min, s.start);
    max = Math.max(max, s.end);
  }
  return min === Infinity ? null : { start: min, end: max };
}

/** Does task `a` depend (transitively) on task `b`? */
export function dependsOn(p, a, b) {
  const byId = new Map(p.tasks.map((t) => [t.id, t]));
  const seen = new Set();
  const stack = [a];
  while (stack.length) {
    const id = stack.pop();
    if (id === b) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of byId.get(id)?.deps || []) stack.push(d);
  }
  return false;
}

/** Keep `start` of dependent tasks in sync with their computed start,
 *  so removing a dependency never makes a task jump. */
export function normalize(p) {
  const sch = schedule(p);
  let changed = false;
  const tasks = p.tasks.map((t) => {
    if (!t.deps?.length) return t;
    const s = fromDay(sch.get(t.id).start);
    if (s === t.start) return t;
    changed = true;
    return { ...t, start: s };
  });
  return changed ? { ...p, tasks } : p;
}

// ---------- IDs ----------
let uidN = 0;
export const uid = (prefix = 'x') =>
  `${prefix}${Date.now().toString(36)}${(uidN++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function nextTaskId(p) {
  const used = new Set(p.tasks.map((t) => t.id));
  let n = p.tasks.length + 1;
  while (used.has(`t${n}`)) n++;
  return `t${n}`;
}

export const validId = (id) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);

// ---------- Mutations ----------
export function renameTask(p, oldId, newId) {
  return {
    ...p,
    tasks: p.tasks.map((t) => ({
      ...t,
      id: t.id === oldId ? newId : t.id,
      deps: (t.deps || []).map((d) => (d === oldId ? newId : d)),
    })),
  };
}

export function removeTask(p, id) {
  return {
    ...p,
    tasks: p.tasks.filter((t) => t.id !== id).map((t) => ({ ...t, deps: (t.deps || []).filter((d) => d !== id) })),
  };
}

export function moveTask(p, taskId, beforeTaskId, sectionId) {
  const t = p.tasks.find((x) => x.id === taskId);
  if (!t || taskId === beforeTaskId) return p;
  const rest = p.tasks.filter((x) => x.id !== taskId);
  const moved = { ...t, sectionId };
  let idx = beforeTaskId ? rest.findIndex((x) => x.id === beforeTaskId) : -1;
  if (idx < 0) {
    // after the last task in that section, or at end
    let last = -1;
    rest.forEach((x, i) => x.sectionId === sectionId && (last = i));
    idx = last < 0 ? rest.length : last + 1;
  }
  rest.splice(idx, 0, moved);
  return { ...p, tasks: rest };
}

export function moveSection(p, sid, beforeSid) {
  if (sid === beforeSid) return p;
  const s = p.sections.find((x) => x.id === sid);
  const rest = p.sections.filter((x) => x.id !== sid);
  let idx = beforeSid ? rest.findIndex((x) => x.id === beforeSid) : rest.length;
  if (idx < 0) idx = rest.length;
  rest.splice(idx, 0, s);
  return { ...p, sections: rest };
}

// ---------- Mermaid export ----------
const clean = (s) => String(s || '').replace(/:/g, ' -').replace(/[;#]/g, '').replace(/\s+/g, ' ').trim();

export function toMermaid(p, { estimates = true } = {}) {
  const sch = schedule(p);
  const L = ['gantt'];
  if (p.title) L.push(`    title ${clean(p.title)}`);
  L.push('    dateFormat YYYY-MM-DD');
  if (p.axisFormat) L.push(`    axisFormat ${p.axisFormat}`);
  if (p.excludeWeekends) L.push('    excludes weekends');
  for (const s of p.sections) {
    const tasks = p.tasks.filter((t) => t.sectionId === s.id);
    if (!tasks.length) continue;
    L.push('');
    L.push(`    section ${clean(s.name) || 'Sekcja'}`);
    for (const t of tasks) {
      const r = sch.get(t.id);
      const tags = [];
      if (t.status === 'done') tags.push('done');
      if (t.status === 'active') tags.push('active');
      if (t.crit) tags.push('crit');
      if (t.milestone) tags.push('milestone');
      tags.push(t.id);
      tags.push(t.deps?.length ? `after ${t.deps.join(' ')}` : fromDay(r.start));
      tags.push(`${r.dur}d`);
      const e = getEst(t);
      if (estimates && e) {
        L.push(`    %% est ${t.id} O=${e.o} M=${e.m} P=${e.p}${t.useEstimate ? ' use' : ''}`);
      }
      L.push(`    ${clean(t.name) || t.id} :${tags.join(', ')}`);
    }
  }
  return L.join('\n');
}

// ---------- Mermaid import ----------
const TAGS = new Set(['done', 'active', 'crit', 'milestone']);
const KEYWORDS = /^(dateFormat|axisFormat|tickInterval|todayMarker|includes|weekday|weekend|inclusiveEndDates|topAxis|displayMode|accTitle|accDescr|click)\b/;

export function extractMermaid(text) {
  const blocks = [...text.matchAll(/```mermaid[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (!blocks.length) return text;
  return blocks.find((b) => /(^|\n)\s*gantt\b/.test(b)) || blocks[0];
}

export function fromMermaid(text) {
  const lines = extractMermaid(text).split(/\r?\n/);
  const p = { id: uid('p'), title: '', excludeWeekends: false, sections: [], tasks: [] };
  const ests = {};
  let section = null;
  let prevId = null;
  let auto = 1;
  const usedIds = new Set();
  const durRe = /^(\d+(?:\.\d+)?)\s*(d|w|h|m|s|ms|y|M)?$/;
  const durToDays = (n, u) =>
    u === 'w' ? n * 7 : u === 'h' ? Math.max(1, Math.ceil(n / 24)) : u === 'M' ? n * 30 : u === 'y' ? n * 365 : u === 'm' || u === 's' || u === 'ms' ? 1 : n;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === 'gantt') continue;
    const em = /^%%\s*est\s+(\S+)\s+O=([\d.]+)\s+M=([\d.]+)\s+P=([\d.]+)(\s+use)?/i.exec(line);
    if (em) {
      ests[em[1]] = { o: +em[2], m: +em[3], p: +em[4], use: !!em[5] };
      continue;
    }
    if (line.startsWith('%%')) continue;
    if (/^title\s/.test(line)) {
      p.title = line.slice(6).trim();
      continue;
    }
    if (/^excludes\s/.test(line)) {
      if (/weekends/i.test(line)) p.excludeWeekends = true;
      continue;
    }
    if (/^section\s/.test(line)) {
      section = { id: uid('s'), name: line.slice(8).trim(), collapsed: false };
      p.sections.push(section);
      continue;
    }
    if (KEYWORDS.test(line)) continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    if (!section) {
      section = { id: uid('s'), name: 'Zadania', collapsed: false };
      p.sections.push(section);
    }
    const name = line.slice(0, ci).trim();
    const parts = line.slice(ci + 1).split(',').map((x) => x.trim()).filter(Boolean);
    const t = {
      id: '',
      name,
      sectionId: section.id,
      start: fromDay(todayDay()),
      duration: 1,
      deps: [],
      status: 'none',
      crit: false,
      milestone: false,
      est: null,
      useEstimate: false,
    };
    while (parts.length && TAGS.has(parts[0])) {
      const tag = parts.shift();
      if (tag === 'done' || tag === 'active') t.status = tag;
      if (tag === 'crit') t.crit = true;
      if (tag === 'milestone') t.milestone = true;
    }
    let id = null;
    let startPart = null;
    let endPart = null;
    if (parts.length >= 3) [id, startPart, endPart] = parts;
    else if (parts.length === 2) [startPart, endPart] = parts;
    else if (parts.length === 1) [endPart] = parts;

    if (!id || usedIds.has(id) || !validId(id)) {
      do id = `t${auto++}`;
      while (usedIds.has(id));
    }
    t.id = id;
    usedIds.add(id);

    if (startPart && /^after\s/.test(startPart)) t.deps = startPart.slice(6).trim().split(/\s+/);
    else if (startPart) t.start = fromDay(toDay(startPart));
    else if (prevId) t.deps = [prevId];

    if (endPart) {
      const dm = durRe.exec(endPart);
      if (dm) t.duration = Math.max(t.milestone ? 0 : 1, Math.round(durToDays(+dm[1], dm[2] || 'd')));
      else if (/^until\s/.test(endPart)) t.duration = 1;
      else if (!t.deps.length) {
        const endDay = toDay(endPart);
        t.duration = Math.max(1, daysBetween(toDay(t.start), endDay, p.excludeWeekends));
      }
    }
    if (t.milestone) t.duration = 1;
    p.tasks.push(t);
    prevId = id;
  }
  // drop dependencies on unknown ids, attach estimates
  const ids = new Set(p.tasks.map((t) => t.id));
  for (const t of p.tasks) {
    t.deps = t.deps.filter((d) => ids.has(d) && d !== t.id);
    const e = ests[t.id];
    if (e) {
      t.est = { o: e.o, m: e.m, p: e.p };
      t.useEstimate = e.use;
    }
  }
  if (!p.sections.length) p.sections.push({ id: uid('s'), name: 'Zadania', collapsed: false });
  return normalize(p);
}

// ---------- Factories ----------
export function newTask(p, sectionId, overrides = {}) {
  const sch = schedule(p);
  const inSection = p.tasks.filter((t) => t.sectionId === sectionId);
  const last = inSection[inSection.length - 1];
  const span = projectSpan(p, sch);
  const start = last ? sch.get(last.id).end : span ? span.start : snap(todayDay(), p.excludeWeekends);
  return {
    id: nextTaskId(p),
    name: 'Nowe zadanie',
    sectionId,
    start: fromDay(start),
    duration: 3,
    deps: [],
    status: 'none',
    crit: false,
    milestone: false,
    est: null,
    useEstimate: false,
    ...overrides,
  };
}

export function emptyProject(title = 'Nowy projekt') {
  return {
    id: uid('p'),
    title,
    excludeWeekends: true,
    sections: [{ id: uid('s'), name: 'Sekcja 1', collapsed: false }],
    tasks: [],
  };
}

export function sampleProject() {
  let monday = todayDay();
  while (weekday(monday) !== 1) monday--;
  const s1 = uid('s');
  const s2 = uid('s');
  const s3 = uid('s');
  const base = { status: 'none', crit: false, milestone: false, est: null, useEstimate: false, deps: [], start: fromDay(monday) };
  return normalize({
    id: uid('p'),
    title: 'Przykładowy projekt',
    excludeWeekends: true,
    sections: [
      { id: s1, name: 'Analiza', collapsed: false },
      { id: s2, name: 'Implementacja', collapsed: false },
      { id: s3, name: 'Wdrożenie', collapsed: false },
    ],
    tasks: [
      { ...base, id: 't1', name: 'Zbieranie wymagań', sectionId: s1, duration: 3, status: 'done', est: { o: 2, m: 3, p: 5 } },
      { ...base, id: 't2', name: 'Projekt architektury', sectionId: s1, duration: 4, status: 'active', deps: ['t1'], est: { o: 3, m: 4, p: 7 }, useEstimate: true },
      { ...base, id: 't3', name: 'Backend API', sectionId: s2, duration: 8, crit: true, deps: ['t2'], est: { o: 6, m: 8, p: 14 } },
      { ...base, id: 't4', name: 'Frontend', sectionId: s2, duration: 7, deps: ['t2'], est: { o: 5, m: 7, p: 12 } },
      { ...base, id: 't5', name: 'Testy integracyjne', sectionId: s3, duration: 4, deps: ['t3', 't4'] },
      { ...base, id: 't6', name: 'Release', sectionId: s3, duration: 1, milestone: true, deps: ['t5'] },
    ],
  });
}
