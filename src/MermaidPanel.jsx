import React, { useEffect, useMemo, useState } from 'react';
import { toMermaid } from './model.js';

let mermaidPromise = null;
let renderN = 0;
const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: m }) => {
      m.initialize({ startOnLoad: false, theme: dark() ? 'dark' : 'default', securityLevel: 'strict', gantt: { useMaxWidth: true } });
      return m;
    });
  }
  return mermaidPromise;
}

function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s) => (s || 'gantt').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'gantt';

export default function MermaidPanel({ project, notify }) {
  const [withEst, setWithEst] = useState(true);
  const [tab, setTab] = useState('both');
  const code = useMemo(() => toMermaid(project, { estimates: withEst }), [project, withEst]);
  const fenced = '```mermaid\n' + code + '\n```\n';
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const h = setTimeout(async () => {
      try {
        const m = await getMermaid();
        const id = `mmd-${++renderN}`;
        const { svg } = await m.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e?.message || e));
        document.getElementById(`dmmd-${renderN}`)?.remove();
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [code]);

  const copy = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`Skopiowano ${label}`);
    } catch {
      notify('Nie udało się skopiować — zaznacz tekst ręcznie');
    }
  };

  return (
    <div className="mermaid-panel">
      <div className="mp-bar">
        <div className="tabs">
          {[
            ['both', 'Kod + podgląd'],
            ['code', 'Kod'],
            ['preview', 'Podgląd'],
          ].map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <label className="inline small">
          <input type="checkbox" checked={withEst} onChange={(e) => setWithEst(e.target.checked)} />
          estymaty jako komentarze <code>%%</code>
        </label>
        <div className="spacer" />
        <button onClick={() => copy(fenced, 'blok ```mermaid')}>Kopiuj do MD</button>
        <button onClick={() => copy(code, 'kod Mermaid')}>Kopiuj kod</button>
        <button onClick={() => download(`${slug(project.title)}.md`, `# ${project.title}\n\n${fenced}`, 'text/markdown')}>Pobierz .md</button>
        <button disabled={!svg || !!err} onClick={() => download(`${slug(project.title)}.svg`, svg, 'image/svg+xml')}>Pobierz SVG</button>
      </div>
      <div className={`mp-body ${tab}`}>
        {tab !== 'preview' && <textarea className="code" readOnly value={fenced} spellCheck={false} onFocus={(e) => e.target.select()} />}
        {tab !== 'code' && (
          <div className="preview">
            {err ? <pre className="err">{err}</pre> : <div dangerouslySetInnerHTML={{ __html: svg }} />}
          </div>
        )}
      </div>
    </div>
  );
}
