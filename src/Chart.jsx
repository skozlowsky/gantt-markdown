import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  schedule, projectSpan, fromDay, todayDay, weekday, isWeekend, fmtShort, monthLabel,
  getEst, addDur, daysBetween, dependsOn, moveTask, moveSection, newTask, removeTask, uid, DAY,
} from './model.js';

export const ROW = 34;
export const LEFT = 400;

/** Apply an in-progress drag to a project (pure). */
function applyDrag(p, sch, d) {
  if (!d.delta && d.kind !== 'link') return p;
  const shift = (t) => ({ ...t, start: fromDay(sch.get(t.id).start + d.delta) });
  switch (d.kind) {
    case 'move':
      return { ...p, tasks: p.tasks.map((t) => (t.id === d.taskId ? { ...shift(t), deps: [] } : t)) };
    case 'resize':
      return {
        ...p,
        tasks: p.tasks.map((t) => {
          if (t.id !== d.taskId) return t;
          const s = sch.get(t.id);
          const dur = Math.max(1, daysBetween(s.start, s.end + d.delta, p.excludeWeekends));
          return { ...t, duration: dur, useEstimate: false };
        }),
      };
    case 'section':
      return {
        ...p,
        tasks: p.tasks.map((t) => (t.sectionId === d.sectionId && !t.deps?.length ? shift(t) : t)),
      };
    case 'project':
      return { ...p, tasks: p.tasks.map((t) => (!t.deps?.length ? shift(t) : t)) };
    default:
      return p;
  }
}

export default function Chart({ project, commit, px, selectedId, setSelectedId, notify }) {
  const [drag, setDrag] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const dragRef = useRef(null);
  dragRef.current = drag;
  const rowDrag = useRef(null);
  const bodyRef = useRef(null);
  const scrollRef = useRef(null);

  const baseSch = useMemo(() => schedule(project), [project]);
  const view = useMemo(() => (drag ? applyDrag(project, baseSch, drag) : project), [project, baseSch, drag]);
  const sch = useMemo(() => (view === project ? baseSch : schedule(view)), [view, project, baseSch]);

  // Timeline range is computed from the committed project, so it stays stable while dragging.
  const { min, max } = useMemo(() => {
    const span = projectSpan(project, baseSch);
    const today = todayDay();
    let a = span ? span.start - 7 : today - 7;
    let b = span ? span.end + 21 : today + 35;
    if (b - a < 49) b = a + 49;
    return { min: a, max: b };
  }, [project, baseSch]);
  const days = max - min;
  const width = days * px;
  const X = (day) => (day - min) * px;

  // Rows
  const rows = useMemo(() => {
    const r = [{ type: 'project', key: 'project' }];
    for (const s of view.sections) {
      r.push({ type: 'section', key: s.id, s });
      if (!s.collapsed) for (const t of view.tasks.filter((t) => t.sectionId === s.id)) r.push({ type: 'task', key: t.id, t });
    }
    return r;
  }, [view]);
  const rowIndex = useMemo(() => {
    const m = new Map();
    rows.forEach((r, i) => r.type === 'task' && m.set(r.t.id, i));
    return m;
  }, [rows]);

  // ---------- pointer dragging (bars) ----------
  const begin = (e, d) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({ ...d, x0: e.clientX, y0: e.clientY, cx: e.clientX, cy: e.clientY, delta: 0, moved: false });
  };

  const active = !!drag;
  useEffect(() => {
    if (!active) return;
    const move = (e) =>
      setDrag((d) =>
        d && {
          ...d,
          cx: e.clientX,
          cy: e.clientY,
          delta: Math.round((e.clientX - d.x0) / px),
          moved: d.moved || Math.abs(e.clientX - d.x0) > 3 || Math.abs(e.clientY - d.y0) > 3,
        },
      );
    const up = (e) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === 'link') {
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-task-id]');
        const target = el?.getAttribute('data-task-id');
        if (!target || target === d.taskId) return;
        commit((p) => {
          if (dependsOn(p, d.taskId, target)) {
            notify('Ta zależność utworzyłaby cykl');
            return p;
          }
          return {
            ...p,
            tasks: p.tasks.map((t) =>
              t.id === target && !t.deps.includes(d.taskId) ? { ...t, deps: [...t.deps, d.taskId] } : t,
            ),
          };
        });
        return;
      }
      if (!d.moved) {
        if (d.taskId) setSelectedId(d.taskId);
        return;
      }
      if (d.delta) {
        if (d.kind === 'move' && d.hadDeps) notify('Zadanie przesunięte ręcznie — usunięto jego zależności');
        commit((p) => applyDrag(p, schedule(p), d));
      }
    };
    const key = (e) => e.key === 'Escape' && setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    document.body.classList.add('dragging');
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      document.body.classList.remove('dragging');
    };
  }, [active, px, commit, setSelectedId, notify]);

  // ---------- row reordering (HTML5 DnD on grips) ----------
  const onGripStart = (e, item) => {
    rowDrag.current = item;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.id);
  };
  const onRowOver = (e, row) => {
    const rd = rowDrag.current;
    if (!rd) return;
    if (rd.type === 'section' && row.type !== 'section') return;
    if (row.type === 'project') return;
    e.preventDefault();
    setDropTarget(row.key);
  };
  const onRowDrop = (e, row) => {
    e.preventDefault();
    const rd = rowDrag.current;
    rowDrag.current = null;
    setDropTarget(null);
    if (!rd) return;
    if (rd.type === 'task') {
      if (row.type === 'task') commit((p) => moveTask(p, rd.id, row.t.id, row.t.sectionId));
      else if (row.type === 'section') commit((p) => moveTask(p, rd.id, null, row.s.id));
    } else if (rd.type === 'section' && row.type === 'section') {
      commit((p) => moveSection(p, rd.id, row.s.id));
    }
  };
  const onGripEnd = () => {
    rowDrag.current = null;
    setDropTarget(null);
  };

  // ---------- helpers ----------
  const updTask = (id, patch, key) => commit((p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), key);
  const updSection = (id, patch, key) =>
    commit((p) => ({ ...p, sections: p.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) }), key);
  const addTask = (sectionId) => {
    const t = newTask(project, sectionId);
    commit((p) => ({ ...p, sections: p.sections.map((s) => (s.id === sectionId ? { ...s, collapsed: false } : s)), tasks: [...p.tasks, t] }));
    setSelectedId(t.id);
  };
  const delSection = (s) => {
    const n = project.tasks.filter((t) => t.sectionId === s.id).length;
    if (n && !confirm(`Usunąć sekcję „${s.name}” razem z ${n} zadaniami?`)) return;
    commit((p) => {
      let q = p;
      for (const t of p.tasks.filter((t) => t.sectionId === s.id)) q = removeTask(q, t.id);
      return { ...q, sections: q.sections.filter((x) => x.id !== s.id) };
    });
  };

  const sectionSpan = (sid) => {
    let a = Infinity;
    let b = -Infinity;
    for (const t of view.tasks) {
      if (t.sectionId !== sid) continue;
      const r = sch.get(t.id);
      a = Math.min(a, r.start);
      b = Math.max(b, r.end);
    }
    return a === Infinity ? null : { start: a, end: b };
  };

  // Scroll to "today" / project start on first render
  useEffect(() => {
    const span = projectSpan(project, baseSch);
    if (scrollRef.current && span) scrollRef.current.scrollLeft = Math.max(0, X(span.start) - 2 * px);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // ---------- header ----------
  const months = [];
  const dayCells = [];
  for (let d = min; d < max; d++) {
    const dt = new Date(d * DAY);
    const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`;
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, start: d, end: d + 1 });
    else months[months.length - 1].end = d + 1;
    const showNum = px >= 20 || (px >= 9 && weekday(d) === 1);
    dayCells.push(
      <div key={d} className={`hday ${isWeekend(d) ? 'we' : ''} ${d === todayDay() ? 'today' : ''}`} style={{ left: X(d), width: px }}>
        {showNum ? dt.getUTCDate() : ''}
      </div>,
    );
  }
  const today = todayDay();
  const span = projectSpan(view, sch);

  // ---------- arrows ----------
  const arrows = [];
  for (const t of view.tasks) {
    const ti = rowIndex.get(t.id);
    if (ti == null) continue;
    for (const dId of t.deps || []) {
      const di = rowIndex.get(dId);
      if (di == null) continue;
      const a = sch.get(dId);
      const b = sch.get(t.id);
      const x1 = X(a.end);
      const y1 = di * ROW + ROW / 2;
      const x2 = X(b.start) + (t.milestone ? -6 : 0);
      const y2 = ti * ROW + ROW / 2;
      let path;
      if (x2 - x1 >= 14) path = `M${x1},${y1} H${x1 + 7} V${y2} H${x2 - 1}`;
      else {
        const ym = y1 + (y2 > y1 ? ROW / 2 : -ROW / 2);
        path = `M${x1},${y1} h7 V${ym} H${x2 - 8} V${y2} H${x2 - 1}`;
      }
      const hl = selectedId === t.id || selectedId === dId;
      arrows.push(<path key={`${dId}-${t.id}`} d={path} className={hl ? 'arrow hl' : 'arrow'} markerEnd={hl ? 'url(#ah-hl)' : 'url(#ah)'} />);
    }
  }

  let linkLine = null;
  if (drag?.kind === 'link' && bodyRef.current) {
    const rect = bodyRef.current.getBoundingClientRect();
    const r = sch.get(drag.taskId);
    const i = rowIndex.get(drag.taskId);
    if (r && i != null) {
      linkLine = <line className="link-line" x1={X(r.end)} y1={i * ROW + ROW / 2} x2={drag.cx - rect.left - LEFT} y2={drag.cy - rect.top} />;
    }
  }

  // ---------- render ----------
  const renderTaskBar = (t) => {
    const r = sch.get(t.id);
    const left = X(r.start);
    const e = getEst(t);
    const isDragged = drag && drag.taskId === t.id && drag.kind !== 'link';
    const cls = ['bar', t.status, t.crit ? 'crit' : '', selectedId === t.id ? 'sel' : '', isDragged ? 'dragged' : ''].join(' ');
    if (t.milestone) {
      return (
        <>
          <div
            className={`milestone ${cls}`}
            data-task-id={t.id}
            style={{ left: left - 8 }}
            title={`${t.name} — ${fromDay(r.start)}`}
            onPointerDown={(ev) => begin(ev, { kind: 'move', taskId: t.id, hadDeps: !!t.deps?.length })}
          />
          <span className="bar-label" style={{ left: left + 12 }}>{t.name}</span>
          <div className="link-dot ms" style={{ left: left + 4 }} title="Przeciągnij na inne zadanie, aby dodać zależność"
            onPointerDown={(ev) => begin(ev, { kind: 'link', taskId: t.id })} />
        </>
      );
    }
    const w = Math.max(X(r.end) - left, 4);
    let whisker = null;
    if (e) {
      const xo = X(addDur(r.start, Math.max(1, Math.ceil(e.o - 1e-9)), view.excludeWeekends));
      const xp = X(addDur(r.start, Math.max(1, Math.ceil(e.p - 1e-9)), view.excludeWeekends));
      whisker = (
        <div className="whisker" style={{ left: xo, width: Math.max(1, xp - xo) }} title={`Estymata: O=${e.o} M=${e.m} P=${e.p} → PERT ${e.mean.toFixed(1)}d ±${e.sd.toFixed(1)}`} />
      );
    }
    return (
      <>
        {whisker}
        <div
          className={cls}
          data-task-id={t.id}
          style={{ left, width: w }}
          title={`${t.name}\n${fromDay(r.start)} → ${fromDay(r.end - 1)} (${r.dur}d)`}
          onPointerDown={(ev) => begin(ev, { kind: 'move', taskId: t.id, hadDeps: !!t.deps?.length })}
        >
          <span className="bar-dur">{w > 26 ? `${r.dur}d` : ''}</span>
          <div className="handle-r" onPointerDown={(ev) => begin(ev, { kind: 'resize', taskId: t.id })} />
        </div>
        <div className="link-dot" style={{ left: left + w + 3 }} title="Przeciągnij na inne zadanie, aby dodać zależność"
          onPointerDown={(ev) => begin(ev, { kind: 'link', taskId: t.id })} />
        <span className="bar-label" style={{ left: left + w + 14 }}>{t.name}</span>
      </>
    );
  };

  const deltaBadge = drag && drag.moved && drag.kind !== 'link' && drag.delta !== 0 && (
    <div className="delta-badge" style={{ left: drag.cx + 14, top: drag.cy + 14 }}>
      {drag.kind === 'resize' ? 'czas ' : ''}
      {drag.delta > 0 ? '+' : ''}
      {drag.delta} d
    </div>
  );

  return (
    <div className="scroller" ref={scrollRef}>
      <div className="canvas" style={{ width: LEFT + width }}>
        <div className="head">
          <div className="head-left">
            <span className="hl-name">Zadanie</span>
            <span className="hl-start">Start</span>
            <span className="hl-dur">Dni</span>
          </div>
          <div className="head-time" style={{ width }}>
            <div className="months">
              {months.map((m) => (
                <div key={m.key} className="month" style={{ left: X(m.start), width: (m.end - m.start) * px }}>
                  <span>{monthLabel(m.start)}</span>
                </div>
              ))}
            </div>
            <div className="days">{dayCells}</div>
          </div>
        </div>

        <div className="body" ref={bodyRef} style={{ height: rows.length * ROW }}>
          <div className="bg" style={{ left: LEFT, width }}>
            {px >= 4 &&
              Array.from({ length: days }, (_, i) => min + i)
                .filter(isWeekend)
                .map((d) => <div key={d} className="we-col" style={{ left: X(d), width: px }} />)}
            {today >= min && today < max && <div className="today-line" style={{ left: X(today) + px / 2 }} />}
          </div>

          {rows.map((row, i) => {
            const dropCls = dropTarget === row.key ? 'drop' : '';
            if (row.type === 'project') {
              return (
                <div key="project" className="row project-row">
                  <div className="lc">
                    <span className="proj-title">{view.title || 'Projekt'}</span>
                    <span className="lc-start">{span ? fmtShort(span.start) : ''}</span>
                    <span className="lc-dur muted">{span ? daysBetween(span.start, span.end, view.excludeWeekends) : ''}</span>
                  </div>
                  <div className="cc" style={{ width }}>
                    {span && (
                      <div
                        className="summary project"
                        style={{ left: X(span.start), width: X(span.end) - X(span.start) }}
                        title="Przeciągnij, aby przesunąć cały harmonogram"
                        onPointerDown={(ev) => begin(ev, { kind: 'project' })}
                      />
                    )}
                  </div>
                </div>
              );
            }
            if (row.type === 'section') {
              const s = row.s;
              const ss = sectionSpan(s.id);
              const count = view.tasks.filter((t) => t.sectionId === s.id).length;
              return (
                <div key={s.id} className={`row section-row ${dropCls}`} onDragOver={(e) => onRowOver(e, row)} onDrop={(e) => onRowDrop(e, row)}
                  onDragLeave={() => setDropTarget(null)}>
                  <div className="lc">
                    <span className="grip" draggable onDragStart={(e) => onGripStart(e, { type: 'section', id: s.id })} onDragEnd={onGripEnd} title="Przeciągnij, aby zmienić kolejność sekcji">⠿</span>
                    <button className="icon" onClick={() => updSection(s.id, { collapsed: !s.collapsed })} title={s.collapsed ? 'Rozwiń' : 'Zwiń'}>
                      {s.collapsed ? '▸' : '▾'}
                    </button>
                    <input className="sec-name" value={s.name} onChange={(e) => updSection(s.id, { name: e.target.value }, `sname-${s.id}`)} />
                    <span className="muted small">{count}</span>
                    <button className="icon" onClick={() => addTask(s.id)} title="Dodaj zadanie do sekcji">＋</button>
                    <button className="icon danger" onClick={() => delSection(s)} title="Usuń sekcję">✕</button>
                  </div>
                  <div className="cc" style={{ width }}>
                    {ss && (
                      <div
                        className="summary"
                        style={{ left: X(ss.start), width: Math.max(X(ss.end) - X(ss.start), 4) }}
                        title="Przeciągnij, aby przesunąć całą sekcję"
                        onPointerDown={(ev) => begin(ev, { kind: 'section', sectionId: s.id })}
                      />
                    )}
                  </div>
                </div>
              );
            }
            const t = row.t;
            const r = sch.get(t.id);
            const e = getEst(t);
            const durLocked = t.milestone || (t.useEstimate && e);
            return (
              <div
                key={t.id}
                className={`row task-row ${selectedId === t.id ? 'selected' : ''} ${dropCls}`}
                onDragOver={(ev) => onRowOver(ev, row)}
                onDrop={(ev) => onRowDrop(ev, row)}
                onDragLeave={() => setDropTarget(null)}
              >
                <div className="lc" onMouseDown={() => setSelectedId(t.id)}>
                  <span className="grip" draggable onDragStart={(ev) => onGripStart(ev, { type: 'task', id: t.id })} onDragEnd={onGripEnd} title="Przeciągnij, aby zmienić kolejność / sekcję">⠿</span>
                  <span className={`dot ${t.status} ${t.crit ? 'crit' : ''}`} />
                  <input className="task-name" value={t.name} onChange={(ev) => updTask(t.id, { name: ev.target.value }, `name-${t.id}`)} />
                  <span className={`lc-start ${t.deps?.length ? 'linked' : ''}`} title={t.deps?.length ? `po: ${t.deps.join(', ')}` : fromDay(r.start)}>
                    {t.deps?.length ? '↳ ' : ''}
                    {fmtShort(r.start)}
                  </span>
                  {durLocked ? (
                    <span className="lc-dur muted" title={t.milestone ? 'Kamień milowy' : `Z estymaty PERT: ${e.mean.toFixed(2)}d`}>
                      {t.milestone ? '◆' : `~${r.dur}`}
                    </span>
                  ) : (
                    <input
                      className="lc-dur"
                      type="number"
                      min={1}
                      value={t.duration}
                      onChange={(ev) => updTask(t.id, { duration: Math.max(1, parseInt(ev.target.value || '1', 10)) }, `dur-${t.id}`)}
                    />
                  )}
                </div>
                <div className="cc" style={{ width }}>{renderTaskBar(t)}</div>
              </div>
            );
          })}

          <svg className="arrows" style={{ left: LEFT, width, height: rows.length * ROW }}>
            <defs>
              <marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="arrow-head" />
              </marker>
              <marker id="ah-hl" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="arrow-head hl" />
              </marker>
            </defs>
            {arrows}
            {linkLine}
          </svg>
        </div>

        <div className="add-row">
          <button
            onClick={() => {
              const id = uid('s');
              commit((p) => ({ ...p, sections: [...p.sections, { id, name: `Sekcja ${p.sections.length + 1}`, collapsed: false }] }));
            }}
          >
            ＋ Sekcja
          </button>
          <span className="hint">
            Przeciągaj paski (przesuwanie), prawą krawędź (czas), kropkę za paskiem na inne zadanie (zależność),
            pasek sekcji/projektu (całość), ⠿ (kolejność).
          </span>
        </div>
      </div>
      {deltaBadge}
    </div>
  );
}

