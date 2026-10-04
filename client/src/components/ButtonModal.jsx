import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Icon, Field, Spinner, Tabs, Badge, useConfirm } from './ui';
import LinkField, { validLink, loadFiles, uploadFile, MAX_MB, ACCEPT, kb } from './LinkField';
import { buttonsHtml, BUTTON_STYLE } from '../buttonHtml';
import { PLACEMENTS } from '../placement';

const MAX_FILES = 30;
const niceName = (name = '') => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
const fileItem = (f) => ({ key: f.url, name: f.name, link: f.url, text: `Download ${niceName(f.name)}`.slice(0, 60) });

/**
 * Insert one or more buttons, the same way images are inserted: pick files (upload, file library,
 * from a link) or web pages, then set each button's text and link, the layout and the style.
 */
export default function ButtonModal({ onInsert, onClose, hasCursor = false, spots = {} }) {
  const { businessId, toast } = useApp();
  const [tab, setTab] = useState('upload');
  const [files, setFiles] = useState(null);
  const [selected, setSelected] = useState([]); // ordered [{ key, name, link, text }]
  const [uploads, setUploads] = useState([]);
  const [over, setOver] = useState(false);
  const [step, setStep] = useState('pick'); // pick | settings
  const [items, setItems] = useState([]);
  const [style, setStyle] = useState(BUTTON_STYLE);
  const [placement, setPlacement] = useState(hasCursor ? 'cursor' : spots.endContent !== null ? 'endContent' : 'top');
  const [fileUrl, setFileUrl] = useState('');
  const [web, setWeb] = useState({ text: '', link: '' });
  const [busy, setBusy] = useState(false);
  const [confirm, dialog] = useConfirm();
  const input = useRef();
  const uploading = uploads.some((u) => u.status === 'uploading' || u.status === 'waiting');

  useEffect(() => { loadFiles(businessId).then(setFiles).catch((e) => toast(e.message, 'error')); }, [businessId, toast]);
  const refreshFiles = async () => setFiles(await loadFiles(businessId, true));

  const addSelected = (list) => setSelected((s) => [...s, ...list.filter((x) => !s.some((y) => y.key === x.key))]);
  const toggle = (f) => setSelected((s) => (s.some((x) => x.key === f.url) ? s.filter((x) => x.key !== f.url) : [...s, fileItem(f)]));

  const uploadFiles = async (fileList) => {
    let list = [...(fileList || [])];
    if (!list.length) return;
    if (list.length > MAX_FILES) {
      toast(`Up to ${MAX_FILES} files at a time. Uploading the first ${MAX_FILES}.`, 'error');
      list = list.slice(0, MAX_FILES);
    }
    const status = list.map((f) => (f.size > MAX_MB * 1048576 ? { name: f.name, status: 'error', error: `${kb(f.size)}: over ${MAX_MB} MB` } : { name: f.name, status: 'waiting' }));
    setUploads(status);
    const done = [];
    // One at a time: each request must stay under the hosting upload limit.
    for (let i = 0; i < list.length; i++) {
      if (status[i].status === 'error') continue;
      setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'uploading' } : x)));
      try {
        done.push(await uploadFile(businessId, list[i], (p) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, progress: p } : x)))));
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'done' } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'error', error: e.message } : x)));
      }
    }
    if (done.length) {
      await refreshFiles();
      addSelected(done.map(fileItem));
      toast(`${done.length} file${done.length > 1 ? 's' : ''} uploaded and selected`, 'success');
    }
  };

  // The server downloads the file and keeps a copy, so the button keeps working if the other site changes.
  const addFileLink = async (e) => {
    e.preventDefault();
    const url = fileUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return toast('Paste a link starting with https://', 'error');
    setBusy(true);
    try {
      const f = await api.post(`/businesses/${businessId}/files/from-url`, { url });
      await refreshFiles();
      addSelected([fileItem(f)]);
      setFileUrl('');
      toast(`${f.name} saved to your files and selected`, 'success');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const addWeb = (e) => {
    e.preventDefault();
    const link = web.link.trim();
    if (!validLink(link)) return toast('Add a link starting with https:// (or mailto:)', 'error');
    addSelected([{ key: `${link}#${Date.now()}`, name: link, link, text: web.text.trim() || 'Learn more' }]);
    setWeb({ text: '', link: '' });
    toast('Button added to your selection', 'success');
  };

  const remove = async (f) => {
    if (!(await confirm({ title: 'Delete file?', danger: true, confirmLabel: 'Delete', message: `Buttons linking to “${f.name}” in emails already sent will stop working.` }))) return;
    try {
      await api.del(`/images/${f._id}`);
      await refreshFiles();
      setSelected((s) => s.filter((x) => x.key !== f.url));
    } catch (e) { toast(e.message, 'error'); }
  };

  const goToSettings = () => {
    setItems(selected.map((s) => ({ ...s })));
    setStyle((o) => ({ ...o, layout: selected.length > 1 && selected.length <= 3 ? `grid${selected.length}` : 'stack' }));
    setStep('settings');
  };
  const startBlank = () => {
    setItems([{ key: `new#${Date.now()}`, name: 'Button', link: '', text: '' }]);
    setStyle((o) => ({ ...o, layout: 'stack' }));
    setStep('settings');
  };

  const setItem = (i, patch) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => setItems((list) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });
  const drop = (i) => setItems((list) => list.filter((_, j) => j !== i));
  const addRow = () => setItems((list) => [...list, { key: `new#${Date.now()}`, name: 'Button', link: '', text: '' }]);

  const insert = () => {
    const empty = items.findIndex((it) => !it.text.trim());
    if (empty >= 0) return toast(`Add the text for button ${empty + 1}`, 'error');
    const bad = items.findIndex((it) => !validLink(it.link));
    if (bad >= 0) return toast(`Button “${items[bad].text}” needs a link starting with https://, or a file`, 'error');
    const clean = items.map((it) => ({ text: it.text.trim(), link: it.link.trim() }));
    onInsert(buttonsHtml(clean, style), clean.length, placement);
  };

  const set = (k) => (e) => setStyle({ ...style, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const multi = items.length > 1;
  const grid = multi && style.layout !== 'stack';

  const pickFooter = (
    <>
      <button className="btn btn-ghost" onClick={startBlank} style={{ marginRight: 'auto' }} title="Skip choosing and type the link yourself">Blank button</button>
      <span className="small muted">{selected.length ? `${selected.length} selected` : 'Select one or more files or links'}</span>
      {selected.length > 0 && <button className="btn" onClick={() => setSelected([])}>Clear</button>}
      <button className="btn btn-primary" disabled={!selected.length || uploading} onClick={goToSettings}>
        Next{selected.length > 1 ? `: arrange ${selected.length} buttons` : ''}
      </button>
    </>
  );
  const settingsFooter = (
    <>
      <button className="btn" onClick={() => setStep('pick')}>Back</button>
      <button className="btn btn-primary" onClick={insert} disabled={!items.length}><Icon name="plus" />Insert {multi ? `${items.length} buttons` : 'button'}</button>
    </>
  );

  return (
    <Modal title={step === 'settings' ? (multi ? `Arrange ${items.length} buttons` : 'Button settings') : 'Insert buttons'} onClose={onClose} wide
      footer={step === 'settings' ? settingsFooter : pickFooter}>
      {step === 'pick' ? (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'upload', label: 'Upload file' },
            { value: 'library', label: 'File library', count: files?.length },
            { value: 'link', label: 'File from a link' },
            { value: 'web', label: 'Web page' },
          ]} />
          {selected.length > 0 && (
            <div className="picked">
              <span className="small muted">Selected:</span>
              {selected.map((s, i) => (
                <span key={s.key} className="picked-chip" title={s.link}>
                  <b>{i + 1}</b><Icon name={s.link.startsWith('/i/') ? 'file' : 'link'} size={13} /><span className="truncate">{s.link.startsWith('/i/') ? s.name : s.text}</span>
                  <button type="button" onClick={() => setSelected((x) => x.filter((y) => y.key !== s.key))} aria-label={`Remove ${s.name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ height: 16 }} />

          {tab === 'upload' && (
            <>
              <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => !uploading && input.current.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}>
                {uploading ? <Spinner /> : <Icon name="upload" />}
                <h3 style={{ marginTop: 10 }}>{uploading ? 'Uploading…' : 'Drop files here or click to choose'}</h3>
                <p className="muted small">Each file becomes a download button · PDF, Word, Excel, PowerPoint, ZIP, CSV, TXT, MP3, MP4 or images · up to {MAX_MB} MB each</p>
                <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {uploads.length > 0 && (
                <ul className="upload-list">
                  {uploads.map((u, i) => (
                    <li key={i}>
                      <span className="truncate">{u.name}</span>
                      {u.status === 'waiting' && <span className="muted small">waiting</span>}
                      {u.status === 'uploading' && <span className="row small muted" style={{ gap: 6 }}><Spinner />{Math.round((u.progress || 0) * 100)}%</span>}
                      {u.status === 'done' && <Badge color="green">✓ uploaded</Badge>}
                      {u.status === 'error' && <Badge color="red" title={u.error}>✕ {u.error}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {!uploading && uploads.some((u) => u.status === 'done') && (
                <p className="small muted">Uploaded files are selected. Click <b>Next</b> to set the button text, or open the library to add more.</p>
              )}
            </>
          )}

          {tab === 'library' && (
            !files ? <Spinner /> : files.length ? (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="small muted">Click files to select them. Buttons are inserted in the order you pick.</span>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => addSelected(files.map(fileItem))}>Select all</button>
                </div>
                <ul className="file-list file-list-lg">
                  {files.map((f) => {
                    const n = selected.findIndex((s) => s.key === f.url);
                    return (
                      <li key={f._id} className={n >= 0 ? 'on' : ''}>
                        <button type="button" className="file-pick" onClick={() => toggle(f)} aria-pressed={n >= 0}>
                          {n >= 0 ? <span className="img-check file-check">{n + 1}</span> : <Icon name="file" size={15} />}
                          <span className="truncate">{f.name}</span><span className="small muted">{kb(f.size)}</span>
                        </button>
                        <a className="btn btn-sm btn-ghost" href={f.url} target="_blank" rel="noreferrer" title="Open"><Icon name="eye" /></a>
                        <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}><Icon name="trash" /></button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : <div className="empty small">No files yet. Upload some and they'll be saved here for reuse.</div>
          )}

          {tab === 'link' && (
            <form onSubmit={addFileLink}>
              <Field label="File address" hint="A public link to a PDF or other file (up to 10 MB). Google Drive and Dropbox share links work too. A copy is saved to your file library, so the button keeps working if the other site changes.">
                <input type="url" value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="https://example.com/brochure.pdf" autoFocus />
              </Field>
              <button className="btn" disabled={busy}>{busy ? <><Spinner />Downloading…</> : <><Icon name="plus" />Add to selection</>}</button>
            </form>
          )}

          {tab === 'web' && (
            <form onSubmit={addWeb}>
              <div className="form-row">
                <Field label="Button text"><input type="text" value={web.text} onChange={(e) => setWeb({ ...web, text: e.target.value })} placeholder="e.g. Shop now" autoFocus /></Field>
                <Field label="Opens" hint="A web page, or mailto:you@example.com"><input type="text" value={web.link} onChange={(e) => setWeb({ ...web, link: e.target.value })} placeholder="https://example.com/offer" /></Field>
              </div>
              <button className="btn"><Icon name="plus" />Add to selection</button>
            </form>
          )}
        </>
      ) : (
        <div className="img-settings">
          <div>
            <div className="img-preview">
              <div className="img-preview-email" style={{ padding: '24px 16px 8px' }} onClick={(e) => e.preventDefault()}
                dangerouslySetInnerHTML={{ __html: buttonsHtml(items.map((it) => ({ text: it.text || 'Button text', link: '#' })), style) }} />
            </div>
            <p className="small muted">Preview at email width. Buttons side by side shrink to fit on phones.</p>
          </div>
          <div>
            <Field label="Where to put it">
              <select value={placement} onChange={(e) => setPlacement(e.target.value)}>
                {PLACEMENTS.map(([k, label]) => {
                  const unavailable = k === 'cursor' ? !hasCursor : spots[k] === null;
                  return <option key={k} value={k} disabled={unavailable}>{label}{unavailable ? (k === 'cursor' ? ' (click in the HTML first)' : ' (not in this email)') : ''}</option>;
                })}
              </select>
            </Field>
            {multi && (
              <div className="field">
                <span className="label-text">Layout</span>
                <div className="seg">
                  {[['stack', 'One below another'], ['grid2', '2 per row'], ['grid3', '3 per row']].map(([v, l]) => (
                    <button type="button" key={v} className={style.layout === v ? 'active' : ''} onClick={() => setStyle({ ...style, layout: v })}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="form-row">
              <Field label="Button colour"><input type="color" value={style.bg} onChange={set('bg')} /></Field>
              <Field label="Text colour"><input type="color" value={style.color} onChange={set('color')} /></Field>
              <Field label="Corners (px)"><input type="number" min="0" max="40" value={style.radius} onChange={set('radius')} /></Field>
            </div>
            <div className="field">
              <span className="label-text">Size</span>
              <div className="seg">
                {[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([v, l]) => <button type="button" key={v} className={style.size === v ? 'active' : ''} onClick={() => setStyle({ ...style, size: v })}>{l}</button>)}
              </div>
            </div>
            {!grid && (
              <div className="row" style={{ marginBottom: 14 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <span className="label-text">Alignment</span>
                  <div className="seg">
                    {['left', 'center', 'right'].map((a) => <button type="button" key={a} disabled={style.full} className={style.align === a ? 'active' : ''} onClick={() => setStyle({ ...style, align: a })}>{a[0].toUpperCase() + a.slice(1)}</button>)}
                  </div>
                </div>
                <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={style.full} onChange={set('full')} />Full width</label>
              </div>
            )}

            <span className="label-text">{multi ? 'Each button' : 'Details'}</span>
            <div className="img-items">
              {items.map((it, i) => (
                <div key={it.key} className="img-item btn-item">
                  <div className="img-item-fields">
                    <input type="text" value={it.text} onChange={(e) => setItem(i, { text: e.target.value })} placeholder="Button text" aria-label={`Text for button ${i + 1}`} />
                    <LinkField value={it.link} onChange={(link) => setItem(i, { link })} placeholder="https://… or choose a file" ariaLabel={`Link for button ${i + 1}`} />
                  </div>
                  <div className="img-item-order">
                    {multi && <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>}
                    {multi && <button type="button" className="btn btn-sm btn-ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>}
                    <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => drop(i)} aria-label="Remove button">×</button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={addRow}><Icon name="plus" />Add another button</button>
          </div>
        </div>
      )}
      {dialog}
    </Modal>
  );
}
