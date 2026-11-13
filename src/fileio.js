// Reading/writing files from the browser.
// Chromium (Chrome, Edge, Opera): File System Access API, so "Zapisz" writes back to the same file.
// Firefox / Safari: <input type=file> to open and a download to save.
import { fromMermaid, toMermaid, normalize, uid } from './model.js';

export const hasFS = typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;

const PICKER_TYPES = [
  { description: 'Markdown z wykresem Mermaid', accept: { 'text/markdown': ['.md', '.markdown'] } },
  { description: 'Mermaid', accept: { 'text/plain': ['.mmd', '.mermaid'] } },
  { description: 'Projekt JSON', accept: { 'application/json': ['.json'] } },
];
const ACCEPT = '.md,.markdown,.mmd,.mermaid,.json,.txt';

export function kindOf(name = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.json')) return 'json';
  if (n.endsWith('.mmd') || n.endsWith('.mermaid')) return 'mmd';
  return 'md';
}

export const slug = (s) =>
  (s || 'gantt').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gantt';

// ---------- (de)serialization ----------
const BLOCK_RE = /```mermaid[^\n]*\n([\s\S]*?)```/g;
const isGantt = (code) => /(^|\n)\s*gantt\b/.test(code);

/** Replace the first ```mermaid gantt block in `text`; append one if there is none. */
export function replaceGanttBlock(text, code) {
  const block = '```mermaid\n' + code + '\n```';
  let done = false;
  const out = text.replace(BLOCK_RE, (m, body) => {
    if (done || !isGantt(body)) return m;
    done = true;
    return block;
  });
  if (done) return out;
  return (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + block + '\n';
}

export function serialize(project, name, previousText = '', opts = {}) {
  const kind = kindOf(name);
  if (kind === 'json') return JSON.stringify(project, null, 2) + '\n';
  const code = toMermaid(project, opts);
  if (kind === 'mmd') return code + '\n';
  return replaceGanttBlock(previousText || `# ${project.title || 'Harmonogram'}\n`, code);
}

export function parseFile(name, text) {
  if (kindOf(name) === 'json') {
    const p = JSON.parse(text);
    if (!Array.isArray(p.tasks) || !Array.isArray(p.sections)) throw new Error('Ten JSON nie jest projektem z tej aplikacji');
    return normalize({ ...p, id: uid('p') });
  }
  const p = fromMermaid(text);
  if (!p.tasks.length) throw new Error(`W pliku ${name} nie znaleziono wykresu gantt`);
  if (!p.title) p.title = name.replace(/\.[^.]+$/, '');
  return p;
}

// ---------- open / save ----------
const isAbort = (e) => e?.name === 'AbortError';

/** Returns { name, text, handle } or null if the user cancelled. */
export async function openFile() {
  if (hasFS) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, excludeAcceptAllOption: false, multiple: false });
      const f = await handle.getFile();
      return { name: f.name, text: await f.text(), handle };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = async () => {
      const f = input.files[0];
      resolve(f ? { name: f.name, text: await f.text(), handle: null } : null);
    };
    input.click();
  });
}

/** Handle from a file dropped onto the page (Chromium gives a writable handle). */
export async function fromDrop(dataTransfer) {
  const item = [...(dataTransfer.items || [])].find((i) => i.kind === 'file');
  let handle = null;
  if (item?.getAsFileSystemHandle) {
    try {
      const h = await item.getAsFileSystemHandle();
      if (h?.kind === 'file') handle = h;
    } catch {
      /* ignore */
    }
  }
  const f = handle ? await handle.getFile() : dataTransfer.files[0];
  return f ? { name: f.name, text: await f.text(), handle } : null;
}

async function ensureWritable(handle) {
  const opts = { mode: 'readwrite' };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

export async function writeToHandle(handle, makeText) {
  if (!(await ensureWritable(handle))) throw new Error('Przeglądarka nie dała uprawnień do zapisu pliku');
  const previous = kindOf(handle.name) === 'md' ? await (await handle.getFile()).text() : '';
  const w = await handle.createWritable();
  await w.write(makeText(handle.name, previous));
  await w.close();
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Save under a new name. Returns { name, handle } or null if cancelled. */
export async function saveAs(suggestedName, makeText, previousText = '') {
  if (hasFS) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
      // A new file chosen via "save as" starts empty: only reuse the old text if it is the same file.
      const w = await handle.createWritable();
      await w.write(makeText(handle.name, handle.name === suggestedName ? previousText : ''));
      await w.close();
      return { name: handle.name, handle };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const name = window.prompt('Nazwa pliku (.md, .mmd albo .json):', suggestedName);
  if (!name) return null;
  download(name, makeText(name, previousText), kindOf(name) === 'json' ? 'application/json' : 'text/markdown');
  return { name, handle: null };
}

// ---------- remembering file handles across reloads (IndexedDB) ----------
const DB = 'gantt-md-files';
const STORE = 'handles';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function rememberHandle(projectId, handle) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction(STORE, 'readwrite');
      if (handle) tx.objectStore(STORE).put(handle, projectId);
      else tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* storage unavailable: the handle just won't survive a reload */
  }
}
export async function recallHandle(projectId) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const r = d.transaction(STORE).objectStore(STORE).get(projectId);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return null;
  }
}
