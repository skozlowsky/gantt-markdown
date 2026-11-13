import React, { useCallback, useEffect, useRef, useState } from 'react';
import Chart from './Chart.jsx';
import Editor from './Editor.jsx';
import MermaidPanel from './MermaidPanel.jsx';
import { normalize, sampleProject, emptyProject, fromMermaid, uid, newTask, removeTask } from './model.js';

const KEY = 'gantt-md:v1';

function loadLib() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY));
    if (j?.projects?.length) return j;
  } catch {
    /* ignore */
  }
  const p = sampleProject();
  return { currentId: p.id, projects: [p] };
}

/** Undo/redo history. Edits sharing a `key` within 1s are merged (e.g. typing). */
function useHistory(initial) {
  const [h, setH] = useState({ past: [], present: initial, future: [] });
  const last = useRef({ key: null, at: 0 });
  const commit = useCallback((updater, key) => {
    setH((s) => {
      let next = typeof updater === 'function' ? updater(s.present) : updater;
      if (next === s.present) return s;
      next = normalize(next);
      const now = Date.now();
      const merge = key && last.current.key === key && now - last.current.at < 1000;
      last.current = { key, at: now };
      if (merge) return { ...s, present: next };
      return { past: [...s.past.slice(-150), s.present], present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)), []);
  const reset = useCallback((p) => setH({ past: [], present: p, future: [] }), []);
  return { project: h.present, commit, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0 };
}

function ImportDialog({ onClose, onImport }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const doMermaid = () => {
    try {
      const p = fromMermaid(text);
      if (!p.tasks.length) throw new Error('Nie znaleziono żadnych zadań');
      onImport(p);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };
  const onFile = async (f) => {
    if (!f) return;
    const content = await f.text();
    try {
      if (f.name.endsWith('.json')) {
        const p = JSON.parse(content);
        if (!Array.isArray(p.tasks) || !Array.isArray(p.sections)) throw new Error('To nie wygląda na projekt z tej aplikacji');
        onImport({ ...p, id: uid('p') });
      } else {
        setText(content);
      }
    } catch (e) {
      setErr(String(e.message || e));
    }
  };
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Import</h3>
        <p className="muted small">
          Wklej kod Mermaid <code>gantt</code> (może być cały plik .md z blokiem <code>```mermaid</code>) albo wczytaj plik .json / .md.
          Import tworzy nowy projekt.
        </p>
        <textarea className="code" value={text} onChange={(e) => setText(e.target.value)} placeholder={'gantt\n    dateFormat YYYY-MM-DD\n    section A\n    Zadanie :t1, 2026-11-02, 3d'} />
        {err && <div className="err">{err}</div>}
        <div className="row-btns">
          <button onClick={() => fileRef.current.click()}>Wczytaj plik…</button>
          <input ref={fileRef} type="file" accept=".json,.md,.mmd,.txt" hidden onChange={(e) => onFile(e.target.files[0])} />
          <div className="spacer" />
          <button onClick={onClose}>Anuluj</button>
          <button className="primary" onClick={doMermaid} disabled={!text.trim()}>Importuj Mermaid</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [lib, setLib] = useState(loadLib);
  const initial = lib.projects.find((p) => p.id === lib.currentId) || lib.projects[0];
  const { project, commit, undo, redo, reset, canUndo, canRedo } = useHistory(initial);
  const [selectedId, setSelectedId] = useState(null);
  const [px, setPx] = useState(() => Number(localStorage.getItem('gantt-md:px')) || 26);
  const [showImport, setShowImport] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // keep library in sync + persist
  useEffect(() => {
    setLib((l) => {
      const exists = l.projects.some((p) => p.id === project.id);
      const projects = exists ? l.projects.map((p) => (p.id === project.id ? project : p)) : [...l.projects, project];
      return { currentId: project.id, projects };
    });
  }, [project]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(lib));
    } catch {
      notify('Nie udało się zapisać w localStorage');
    }
  }, [lib, notify]);
  useEffect(() => {
    localStorage.setItem('gantt-md:px', String(px));
  }, [px]);

  const switchTo = (p) => {
    setSelectedId(null);
    setLib((l) => ({ currentId: p.id, projects: l.projects.some((x) => x.id === p.id) ? l.projects : [...l.projects, p] }));
    reset(normalize(p));
  };

  const deleteProject = () => {
    if (!confirm(`Usunąć projekt „${project.title}”?`)) return;
    const rest = lib.projects.filter((p) => p.id !== project.id);
    const next = rest[0] || emptyProject();
    setLib({ currentId: next.id, projects: rest.length ? rest : [next] });
    setSelectedId(null);
    reset(next);
  };

  const exportJson = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
    a.download = `${(project.title || 'gantt').replace(/[^\w-]+/g, '_')}.json`;
    a.click();
  };

  const addTaskGlobal = () => {
    const sec = project.tasks.find((t) => t.id === selectedId)?.sectionId || project.sections[project.sections.length - 1]?.id;
    if (!sec) return notify('Najpierw dodaj sekcję');
    const t = newTask(project, sec);
    commit((p) => ({ ...p, tasks: [...p.tasks, t] }));
    setSelectedId(t.id);
  };

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !inField) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y' && !inField) {
        e.preventDefault();
        redo();
      } else if (!inField && (e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        commit((p) => removeTask(p, selectedId));
        setSelectedId(null);
      } else if (e.key === 'Escape' && !showImport) {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, commit, selectedId, showImport]);

  return (
    <div className={`app ${panelOpen ? '' : 'panel-closed'}`}>
      <header className="topbar">
        <div className="brand">▤ Gantt<span>→md</span></div>
        <select
          className="proj-select"
          value={project.id}
          onChange={(e) => switchTo(lib.projects.find((p) => p.id === e.target.value))}
          title="Projekty zapisane lokalnie"
        >
          {lib.projects.map((p) => (
            <option key={p.id} value={p.id}>{p.title || '(bez tytułu)'}</option>
          ))}
        </select>
        <button onClick={() => switchTo(emptyProject())} title="Nowy pusty projekt">Nowy</button>
        <button onClick={() => switchTo({ ...structuredClone(project), id: uid('p'), title: `${project.title} (kopia)` })}>Duplikuj</button>
        <button onClick={deleteProject} className="danger">Usuń</button>
        <span className="sep" />
        <button onClick={undo} disabled={!canUndo} title="Cofnij (Ctrl+Z)">↶</button>
        <button onClick={redo} disabled={!canRedo} title="Ponów (Ctrl+Shift+Z)">↷</button>
        <span className="sep" />
        <button className="primary" onClick={addTaskGlobal}>＋ Zadanie</button>
        <label className="zoom" title="Szerokość dnia">
          🔍
          <input type="range" min={6} max={64} value={px} onChange={(e) => setPx(Number(e.target.value))} />
        </label>
        <div className="spacer" />
        <button onClick={() => setShowImport(true)}>Import</button>
        <button onClick={exportJson}>Eksport JSON</button>
        <button onClick={() => setPanelOpen((v) => !v)}>{panelOpen ? 'Ukryj Mermaid' : 'Pokaż Mermaid'}</button>
      </header>

      <main className="main">
        <Chart project={project} commit={commit} px={px} selectedId={selectedId} setSelectedId={setSelectedId} notify={notify} />
        <aside className="side">
          <Editor project={project} commit={commit} selectedId={selectedId} setSelectedId={setSelectedId} />
        </aside>
      </main>

      {panelOpen && <MermaidPanel project={project} notify={notify} />}

      {showImport && (
        <ImportDialog
          onClose={() => setShowImport(false)}
          onImport={(p) => {
            setShowImport(false);
            switchTo(p);
            notify(`Zaimportowano ${p.tasks.length} zadań`);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
