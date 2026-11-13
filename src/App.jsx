import React, { useCallback, useEffect, useRef, useState } from 'react';
import Chart from './Chart.jsx';
import Editor from './Editor.jsx';
import MermaidPanel from './MermaidPanel.jsx';
import { normalize, sampleProject, emptyProject, fromMermaid, uid, newTask, removeTask } from './model.js';
import {
  hasFS, kindOf, slug, serialize, parseFile, openFile, fromDrop, writeToHandle, saveAs, download, rememberHandle, recallHandle,
} from './fileio.js';

const KEY = 'gantt-md:v1';
const FILES_KEY = 'gantt-md:files';

/** Cheap content hash, used to tell whether a project differs from what was last saved to its file. */
function hashProject(p) {
  const s = JSON.stringify({ ...p, sections: p.sections.map(({ collapsed, ...x }) => x) });
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h;
}

function loadFiles() {
  try {
    return JSON.parse(localStorage.getItem(FILES_KEY)) || {};
  } catch {
    return {};
  }
}

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
  const doImport = () => {
    try {
      const p = fromMermaid(text);
      if (!p.tasks.length) throw new Error('Nie znaleziono żadnych zadań');
      onImport(p);
    } catch (e) {
      setErr(String(e.message || e));
    }
  };
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Wklej Mermaid</h3>
        <p className="muted small">
          Wklej kod <code>gantt</code> albo cały tekst Markdown z blokiem <code>```mermaid</code>. Powstanie nowy projekt.
          Pliki otwierasz przyciskiem „Otwórz” albo przeciągając je na okno.
        </p>
        <textarea className="code" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={'gantt\n    dateFormat YYYY-MM-DD\n    section A\n    Zadanie :t1, 2026-11-02, 3d'} />
        {err && <div className="err">{err}</div>}
        <div className="row-btns">
          <div className="spacer" />
          <button onClick={onClose}>Anuluj</button>
          <button className="primary" onClick={doImport} disabled={!text.trim()}>Importuj</button>
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
  // projectId -> { name, hash } of the file the project was last opened from / saved to
  const [files, setFiles] = useState(loadFiles);
  const handles = useRef(new Map()); // projectId -> FileSystemFileHandle (also kept in IndexedDB)
  const sources = useRef(new Map()); // projectId -> original .md text (fallback when there is no handle)
  const [dropping, setDropping] = useState(false);

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
  useEffect(() => {
    localStorage.setItem(FILES_KEY, JSON.stringify(files));
  }, [files]);

  const file = files[project.id];
  const dirty = !!file && file.hash !== hashProject(project);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const switchTo = (p) => {
    setSelectedId(null);
    const np = normalize(p);
    setLib((l) => ({
      currentId: np.id,
      projects: l.projects.some((x) => x.id === np.id) ? l.projects.map((x) => (x.id === np.id ? np : x)) : [...l.projects, np],
    }));
    reset(np);
    return np;
  };

  const markSaved = (p, name) => setFiles((f) => ({ ...f, [p.id]: { name, hash: hashProject(p) } }));

  // ---------- files ----------
  const openResult = (res) => {
    if (!res) return;
    try {
      let p = parseFile(res.name, res.text);
      // Re-opening a file that is already in the library replaces that project instead of duplicating it.
      const existing = Object.keys(files).find((id) => files[id].name === res.name && lib.projects.some((x) => x.id === id));
      if (existing) {
        if (existing === project.id && dirty && !confirm(`Masz niezapisane zmiany w „${res.name}”. Wczytać plik od nowa?`)) return;
        p = { ...p, id: existing };
      }
      p = switchTo(p);
      if (res.handle) {
        handles.current.set(p.id, res.handle);
        rememberHandle(p.id, res.handle);
      } else {
        handles.current.delete(p.id);
        rememberHandle(p.id, null);
      }
      if (kindOf(res.name) === 'md') sources.current.set(p.id, res.text);
      markSaved(p, res.name);
      notify(`Otwarto ${res.name} (${p.tasks.length} zadań)`);
    } catch (e) {
      notify(`Nie udało się otworzyć: ${e.message || e}`);
    }
  };

  const doOpen = async () => {
    try {
      openResult(await openFile());
    } catch (e) {
      notify(`Nie udało się otworzyć: ${e.message || e}`);
    }
  };

  const doSave = async (forceAs = false) => {
    const p = project;
    const make = (name, prev) => serialize(p, name, prev);
    try {
      let handle = handles.current.get(p.id);
      if (!handle && file && hasFS) handle = await recallHandle(p.id);
      if (!forceAs && handle) {
        await writeToHandle(handle, make);
        handles.current.set(p.id, handle);
        markSaved(p, handle.name);
        return notify(`Zapisano ${handle.name}`);
      }
      if (!forceAs && file && !hasFS) {
        download(file.name, make(file.name, sources.current.get(p.id) || ''), kindOf(file.name) === 'json' ? 'application/json' : 'text/markdown');
        markSaved(p, file.name);
        return notify(`Pobrano ${file.name}`);
      }
      const res = await saveAs(file?.name || `${slug(p.title)}.md`, make, sources.current.get(p.id) || '');
      if (!res) return;
      if (res.handle) {
        handles.current.set(p.id, res.handle);
        rememberHandle(p.id, res.handle);
      }
      markSaved(p, res.name);
      notify(hasFS ? `Zapisano ${res.name}` : `Pobrano ${res.name}`);
    } catch (e) {
      notify(`Błąd zapisu: ${e.message || e}`);
    }
  };

  const onDragOver = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDropping(true);
  };
  const onDrop = async (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDropping(false);
    try {
      openResult(await fromDrop(e.dataTransfer));
    } catch (err) {
      notify(`Nie udało się otworzyć: ${err.message || err}`);
    }
  };

  const deleteProject = () => {
    if (!confirm(`Usunąć projekt „${project.title}”?`)) return;
    const rest = lib.projects.filter((p) => p.id !== project.id);
    const next = rest[0] || emptyProject();
    setLib({ currentId: next.id, projects: rest.length ? rest : [next] });
    setSelectedId(null);
    reset(next);
    setFiles(({ [project.id]: _, ...f }) => f);
    rememberHandle(project.id, null);
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
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        doSave(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        doOpen();
      } else if (mod && e.key.toLowerCase() === 'z' && !inField) {
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
  });

  return (
    <div className={`app ${panelOpen ? '' : 'panel-closed'}`} onDragOver={onDragOver} onDragLeave={(e) => !e.relatedTarget && setDropping(false)} onDrop={onDrop}>
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
        {file && (
          <span className={`file-chip ${dirty ? 'dirty' : ''}`} title={dirty ? 'Niezapisane zmiany' : 'Zapisane'}>
            {file.name}
            {dirty ? ' ●' : ''}
          </span>
        )}
        <button onClick={doOpen} title="Otwórz .md / .mmd / .json (Ctrl+O)">Otwórz</button>
        <button onClick={() => doSave(false)} title={file ? `Zapisz do ${file.name} (Ctrl+S)` : 'Zapisz do pliku (Ctrl+S)'}>
          {hasFS || !file ? 'Zapisz' : 'Pobierz'}
        </button>
        <button onClick={() => doSave(true)} title="Zapisz jako… (Ctrl+Shift+S)">Zapisz jako…</button>
        <button onClick={() => setShowImport(true)} title="Wklej kod Mermaid">Wklej</button>
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
      {dropping && <div className="drop-overlay">Upuść plik .md, .mmd albo .json, aby go otworzyć</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
