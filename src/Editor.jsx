import React, { useEffect, useMemo, useState } from 'react';
import {
  schedule, projectSpan, fromDay, toDay, getEst, dependsOn, renameTask, removeTask, validId,
  daysBetween, nextTaskId, snap,
} from './model.js';

function IdField({ task, project, commit, setSelectedId }) {
  const [val, setVal] = useState(task.id);
  useEffect(() => setVal(task.id), [task.id]);
  const err = val !== task.id && (!validId(val) ? 'Tylko litery, cyfry, _ i -' : project.tasks.some((t) => t.id === val) ? 'ID zajęte' : null);
  const apply = () => {
    if (val === task.id) return;
    if (err) return setVal(task.id);
    commit((p) => renameTask(p, task.id, val));
    setSelectedId(val);
  };
  return (
    <label className="field">
      <span>ID (Mermaid)</span>
      <input value={val} onChange={(e) => setVal(e.target.value.trim())} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} className={err ? 'invalid' : ''} />
      {err && <small className="err">{err}</small>}
    </label>
  );
}

function TaskEditor({ task: t, project, commit, setSelectedId }) {
  const sch = useMemo(() => schedule(project), [project]);
  const r = sch.get(t.id);
  const e = getEst(t);
  const upd = (patch, key) => commit((p) => ({ ...p, tasks: p.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }), key);
  const updEst = (k, v) => upd({ est: { ...(t.est || {}), [k]: v === '' ? '' : Number(v) } }, `est-${k}-${t.id}`);

  const candidates = project.tasks.filter((x) => x.id !== t.id && !t.deps.includes(x.id) && !dependsOn(project, x.id, t.id));

  return (
    <div className="editor">
      <div className="editor-head">
        <h3>Zadanie</h3>
        <button className="icon" onClick={() => setSelectedId(null)} title="Zamknij (Esc)">✕</button>
      </div>

      <label className="field">
        <span>Nazwa</span>
        <input value={t.name} onChange={(ev) => upd({ name: ev.target.value }, `name-${t.id}`)} />
      </label>

      <div className="two">
        <IdField task={t} project={project} commit={commit} setSelectedId={setSelectedId} />
        <label className="field">
          <span>Sekcja</span>
          <select value={t.sectionId} onChange={(ev) => upd({ sectionId: ev.target.value })}>
            {project.sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="two">
        <label className="field">
          <span>Status</span>
          <select value={t.status} onChange={(ev) => upd({ status: ev.target.value })}>
            <option value="none">—</option>
            <option value="active">active (w toku)</option>
            <option value="done">done (zrobione)</option>
          </select>
        </label>
        <div className="field checks">
          <label><input type="checkbox" checked={t.crit} onChange={(ev) => upd({ crit: ev.target.checked })} /> krytyczne</label>
          <label><input type="checkbox" checked={t.milestone} onChange={(ev) => upd({ milestone: ev.target.checked })} /> kamień milowy</label>
        </div>
      </div>

      <div className="two">
        <label className="field">
          <span>Start {t.deps.length ? '(z zależności)' : ''}</span>
          <input
            type="date"
            value={fromDay(r.start)}
            disabled={t.deps.length > 0}
            onChange={(ev) => ev.target.value && upd({ start: ev.target.value }, `start-${t.id}`)}
          />
        </label>
        <label className="field">
          <span>Czas (dni{project.excludeWeekends ? ' robocze' : ''})</span>
          <input
            type="number"
            min={1}
            value={t.milestone ? 0 : t.useEstimate && e ? r.dur : t.duration}
            disabled={t.milestone || (t.useEstimate && !!e)}
            onChange={(ev) => upd({ duration: Math.max(1, parseInt(ev.target.value || '1', 10)) }, `dur-${t.id}`)}
          />
        </label>
      </div>
      <div className="muted small">
        {fromDay(r.start)} → {fromDay(Math.max(r.start, r.end - 1))}
        {!t.milestone && ` · ${r.end - r.start} dni kalendarzowych`}
      </div>

      <fieldset className="est">
        <legend>Estymata (PERT, w dniach)</legend>
        <div className="three">
          <label className="field">
            <span title="Optymistyczna">O</span>
            <input type="number" min={0} step="0.5" value={t.est?.o ?? ''} onChange={(ev) => updEst('o', ev.target.value)} placeholder="opt." />
          </label>
          <label className="field">
            <span title="Najbardziej prawdopodobna">M</span>
            <input type="number" min={0} step="0.5" value={t.est?.m ?? ''} onChange={(ev) => updEst('m', ev.target.value)} placeholder="realna" />
          </label>
          <label className="field">
            <span title="Pesymistyczna">P</span>
            <input type="number" min={0} step="0.5" value={t.est?.p ?? ''} onChange={(ev) => updEst('p', ev.target.value)} placeholder="pesym." />
          </label>
        </div>
        {e ? (
          <>
            <div className="pert">
              E = (O + 4M + P) / 6 = <b>{e.mean.toFixed(2)} d</b> · σ = {e.sd.toFixed(2)} d
              <br />
              <span className="muted small">68%: {(e.mean - e.sd).toFixed(1)}–{(e.mean + e.sd).toFixed(1)} d · 95%: {(e.mean - 2 * e.sd).toFixed(1)}–{(e.mean + 2 * e.sd).toFixed(1)} d</span>
            </div>
            <label className="inline">
              <input type="checkbox" checked={!!t.useEstimate} onChange={(ev) => upd({ useEstimate: ev.target.checked })} />
              Czas trwania = estymata PERT (zaokr. w górę: {Math.max(1, Math.ceil(e.mean - 1e-9))} d)
            </label>
            <div className="row-btns">
              <button onClick={() => upd({ duration: Math.max(1, Math.ceil(e.m)), useEstimate: false })}>Ustaw czas = M</button>
              <button onClick={() => upd({ est: null, useEstimate: false })}>Usuń estymatę</button>
            </div>
          </>
        ) : (
          <div className="muted small">Wpisz co najmniej M. Na wykresie zakres O–P pokaże się jako „wąs” pod paskiem.</div>
        )}
      </fieldset>

      <div className="field">
        <span>Zależy od (start po zakończeniu)</span>
        <div className="chips">
          {t.deps.map((d) => {
            const dt = project.tasks.find((x) => x.id === d);
            return (
              <span key={d} className="chip">
                {dt?.name || d} <code>{d}</code>
                <button onClick={() => upd({ deps: t.deps.filter((x) => x !== d) })} title="Usuń zależność">✕</button>
              </span>
            );
          })}
          {!t.deps.length && <span className="muted small">brak — start ustalany ręcznie</span>}
        </div>
        {candidates.length > 0 && (
          <select value="" onChange={(ev) => ev.target.value && upd({ deps: [...t.deps, ev.target.value] })}>
            <option value="">＋ dodaj zależność…</option>
            {candidates.map((x) => (
              <option key={x.id} value={x.id}>{x.name} ({x.id})</option>
            ))}
          </select>
        )}
      </div>

      <div className="row-btns">
        <button
          onClick={() => {
            const id = nextTaskId(project);
            commit((p) => {
              const i = p.tasks.findIndex((x) => x.id === t.id);
              const copy = { ...t, id, name: `${t.name} (kopia)`, deps: [...t.deps] };
              const tasks = [...p.tasks];
              tasks.splice(i + 1, 0, copy);
              return { ...p, tasks };
            });
            setSelectedId(id);
          }}
        >
          Duplikuj
        </button>
        <button
          className="danger"
          onClick={() => {
            commit((p) => removeTask(p, t.id));
            setSelectedId(null);
          }}
        >
          Usuń zadanie
        </button>
      </div>
    </div>
  );
}

function ProjectPanel({ project, commit }) {
  const stats = useMemo(() => {
    const exp = schedule(project);
    const span = projectSpan(project, exp);
    if (!span) return null;
    const o = projectSpan(project, schedule(project, 'o'));
    const pp = projectSpan(project, schedule(project, 'p'));
    const withEst = project.tasks.filter((t) => getEst(t));
    const sumE = withEst.reduce((a, t) => a + getEst(t).mean, 0);
    const sumSd = Math.sqrt(withEst.reduce((a, t) => a + getEst(t).sd ** 2, 0));
    const sumDur = project.tasks.reduce((a, t) => a + (exp.get(t.id)?.dur || 0), 0);
    return { span, o, p: pp, withEst: withEst.length, sumE, sumSd, sumDur };
  }, [project]);
  const excl = project.excludeWeekends;
  const shiftStart = (dateStr) => {
    if (!dateStr || !stats) return;
    const delta = snap(toDay(dateStr), excl) - stats.span.start;
    if (!delta) return;
    commit((p) => {
      const s = schedule(p);
      return { ...p, tasks: p.tasks.map((t) => (t.deps?.length ? t : { ...t, start: fromDay(s.get(t.id).start + delta) })) };
    });
  };

  return (
    <div className="editor">
      <div className="editor-head">
        <h3>Projekt</h3>
      </div>
      <label className="field">
        <span>Tytuł</span>
        <input value={project.title} onChange={(e) => commit((p) => ({ ...p, title: e.target.value }), 'title')} />
      </label>
      <div className="two">
        <label className="field">
          <span>Start projektu</span>
          <input type="date" value={stats ? fromDay(stats.span.start) : ''} onChange={(e) => shiftStart(e.target.value)} disabled={!stats} />
        </label>
        <label className="field">
          <span>Format osi (axisFormat)</span>
          <input value={project.axisFormat || ''} placeholder="np. %d.%m" onChange={(e) => commit((p) => ({ ...p, axisFormat: e.target.value }), 'axis')} />
        </label>
      </div>
      <label className="inline">
        <input type="checkbox" checked={excl} onChange={(e) => commit((p) => ({ ...p, excludeWeekends: e.target.checked }))} />
        Pomijaj weekendy (<code>excludes weekends</code>)
      </label>

      {stats ? (
        <table className="stats">
          <tbody>
            <tr><td>Zadania</td><td>{project.tasks.length} ({stats.withEst} z estymatą)</td></tr>
            <tr><td>Start</td><td>{fromDay(stats.span.start)}</td></tr>
            <tr><td>Koniec</td><td>{fromDay(stats.span.end - 1)}</td></tr>
            <tr><td>Długość</td><td>{daysBetween(stats.span.start, stats.span.end, excl)} dni {excl ? 'roboczych' : ''} ({stats.span.end - stats.span.start} kal.)</td></tr>
            <tr><td>Suma pracy</td><td>{stats.sumDur} dni</td></tr>
            {stats.withEst > 0 && (
              <>
                <tr><td>Koniec (opt.)</td><td>{fromDay(stats.o.end - 1)}</td></tr>
                <tr><td>Koniec (pesym.)</td><td>{fromDay(stats.p.end - 1)}</td></tr>
                <tr><td>Σ estymat</td><td>{stats.sumE.toFixed(1)} d ± {stats.sumSd.toFixed(1)}</td></tr>
              </>
            )}
          </tbody>
        </table>
      ) : (
        <p className="muted">Brak zadań. Dodaj zadanie przyciskiem ＋ przy sekcji.</p>
      )}
      <p className="muted small">
        Kliknij pasek lub wiersz, aby edytować zadanie. „Koniec opt./pesym.” liczy cały harmonogram z wartościami O / P
        dla zadań z estymatą (z uwzględnieniem zależności).
      </p>
    </div>
  );
}

export default function Editor({ project, commit, selectedId, setSelectedId }) {
  const task = project.tasks.find((t) => t.id === selectedId);
  return task ? (
    <TaskEditor key={task.id} task={task} project={project} commit={commit} setSelectedId={setSelectedId} />
  ) : (
    <ProjectPanel project={project} commit={commit} />
  );
}
