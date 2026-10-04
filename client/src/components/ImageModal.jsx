import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Icon, Field, Spinner, Tabs, Badge, useConfirm } from './ui';
import { imagesHtml, CONTENT_WIDTH } from '../imageHtml';
import { PLACEMENTS } from '../placement';
import LinkField, { validLink } from './LinkField';

const MAX_MB = 4;
const MAX_FILES = 30;
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const niceAlt = (name = '') => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();

function naturalSize(src) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

export default function ImageModal({ onInsert, onClose, hasCursor = false, spots = {}, onLibraryChange }) {
  const { businessId, toast } = useApp();
  const [tab, setTab] = useState('upload');
  const [library, setLibrary] = useState(null);
  const [selected, setSelected] = useState([]); // ordered list of image objects
  const [uploads, setUploads] = useState([]); // [{ name, status, error }]
  const [over, setOver] = useState(false);
  const [step, setStep] = useState('pick'); // pick | settings
  const [items, setItems] = useState([]); // [{ url, name, width, height, mime, alt, link }]
  const [opts, setOpts] = useState({ layout: 'stack', width: CONTENT_WIDTH, full: false, align: 'center' });
  const [linkUrl, setLinkUrl] = useState('');
  const [placement, setPlacement] = useState(hasCursor ? 'cursor' : 'top');
  const [busy, setBusy] = useState(false);
  const [confirm, dialog] = useConfirm();
  const [renaming, setRenaming] = useState(null); // { id, value }
  const input = useRef();
  // Keep the editor's image chips in sync with uploads, renames and deletes.
  useEffect(() => { if (library) onLibraryChange?.(library); }, [library]); // eslint-disable-line react-hooks/exhaustive-deps
  const uploading = uploads.some((u) => u.status === 'uploading' || u.status === 'waiting');

  useEffect(() => {
    api.get(`/businesses/${businessId}/images`).then(setLibrary).catch((e) => toast(e.message, 'error'));
  }, [businessId, toast]);

  const toggle = (img) => setSelected((s) => (s.some((x) => x.url === img.url) ? s.filter((x) => x.url !== img.url) : [...s, img]));

  const goToSettings = (list) => {
    setItems(list.map((img) => ({ ...img, alt: niceAlt(img.name), link: '' })));
    const minNatural = Math.min(...list.map((i) => i.width || CONTENT_WIDTH));
    setOpts((o) => ({ ...o, layout: list.length > 1 ? 'grid2' : 'stack', width: Math.min(minNatural, CONTENT_WIDTH) }));
    setStep('settings');
  };

  const uploadFiles = async (fileList) => {
    let files = [...(fileList || [])];
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      toast(`Up to ${MAX_FILES} images at a time. Uploading the first ${MAX_FILES}.`, 'error');
      files = files.slice(0, MAX_FILES);
    }
    const status = files.map((f) => {
      if (!/^image\/(jpeg|png|gif|webp)$/.test(f.type)) return { name: f.name, status: 'error', error: 'Not a JPG, PNG, GIF or WebP' };
      if (f.size > MAX_MB * 1048576) return { name: f.name, status: 'error', error: `${kb(f.size)}: over ${MAX_MB} MB` };
      return { name: f.name, status: 'waiting' };
    });
    setUploads(status);
    const done = [];
    // One at a time: each request must stay under the hosting upload limit.
    for (let i = 0; i < files.length; i++) {
      if (status[i].status === 'error') continue;
      setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'uploading' } : x)));
      try {
        const objectUrl = URL.createObjectURL(files[i]);
        const dims = await naturalSize(objectUrl);
        URL.revokeObjectURL(objectUrl);
        const fd = new FormData();
        fd.append('file', files[i]);
        fd.append('width', dims.width);
        fd.append('height', dims.height);
        const img = await api.post(`/businesses/${businessId}/images`, fd);
        done.push(img);
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'done' } : x)));
      } catch (e) {
        setUploads((u) => u.map((x, j) => (j === i ? { ...x, status: 'error', error: e.message } : x)));
      }
    }
    if (done.length) {
      setLibrary((l) => [...done.slice().reverse(), ...(l || [])]);
      setSelected((s) => [...s, ...done.filter((d) => !s.some((x) => x.url === d.url))]);
      toast(`${done.length} image${done.length > 1 ? 's' : ''} uploaded and selected`, 'success');
    }
  };

  // The server downloads the image and saves a copy in the library: the browser can't load many
  // links (hotlink protection, share pages, http://), and emails shouldn't depend on another site.
  const addLink = async (e) => {
    e.preventDefault();
    const url = linkUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return toast('Paste a link starting with https://', 'error');
    setBusy(true);
    try {
      const img = await api.post(`/businesses/${businessId}/images/from-url`, { url });
      setLibrary((l) => [img, ...(l || [])]);
      setSelected((s) => [...s, img]);
      setLinkUrl('');
      toast('Image saved to your library and selected', 'success');
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const copyUrl = async (img) => {
    const text = new URL(img.url, window.location.origin).href;
    try { await navigator.clipboard.writeText(text); toast('Image address copied', 'success'); } catch { toast(text); }
  };

  const remove = async (img) => {
    if (!(await confirm({ title: 'Delete image?', danger: true, confirmLabel: 'Delete', message: 'Emails already sent with this image will show a broken image. Only delete images you never sent.' }))) return;
    await api.del(`/images/${img._id}`);
    setLibrary((l) => l.filter((x) => x._id !== img._id));
    setSelected((s) => s.filter((x) => x.url !== img.url));
  };

  const copyTag = async (img) => {
    const text = `{{image:${img.tag}}}`;
    try { await navigator.clipboard.writeText(text); toast(`Copied ${text}`, 'success'); } catch { toast(text); }
  };
  const saveTag = async (img, value) => {
    setRenaming(null);
    if (!value || value === img.tag) return;
    try {
      const updated = await api.put(`/images/${img._id}`, { tag: value });
      setLibrary((l) => l.map((x) => (x._id === img._id ? { ...x, tag: updated.tag } : x)));
      toast(`Renamed to {{image:${updated.tag}}}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  const setItem = (i, patch) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i, d) => setItems((list) => {
    const next = [...list];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    return next;
  });

  const insert = () => {
    const bad = items.find((it) => it.link && !validLink(it.link));
    if (bad) return toast(`Link for “${bad.name}” must start with https://, or choose a file`, 'error');
    onInsert(imagesHtml(items, opts), items.length, placement);
  };

  const set = (k) => (e) => setOpts({ ...opts, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const multi = items.length > 1;
  const grid = multi && opts.layout !== 'stack';
  const cols = opts.layout === 'grid3' ? 3 : 2;

  const pickFooter = (
    <>
      <span className="small muted" style={{ marginRight: 'auto' }}>{selected.length ? `${selected.length} selected` : 'Select one or more images'}</span>
      {selected.length > 0 && <button className="btn" onClick={() => setSelected([])}>Clear</button>}
      <button className="btn btn-primary" disabled={!selected.length || uploading} onClick={() => goToSettings(selected)}>
        Next{selected.length > 1 ? `: arrange ${selected.length} images` : ''}
      </button>
    </>
  );
  const settingsFooter = (
    <>
      <button className="btn" onClick={() => setStep('pick')}>Back</button>
      <button className="btn btn-primary" onClick={insert}><Icon name="plus" />Insert {multi ? `${items.length} images` : 'image'}</button>
    </>
  );

  return (
    <Modal title={step === 'settings' ? (multi ? `Arrange ${items.length} images` : 'Image settings') : 'Insert images'} onClose={onClose} wide
      footer={step === 'settings' ? settingsFooter : pickFooter}>
      {step === 'pick' ? (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'upload', label: 'Upload' },
            { value: 'library', label: 'Image library', count: library?.length },
            { value: 'link', label: 'From a link' },
          ]} />
          <div style={{ height: 16 }} />

          {tab === 'upload' && (
            <>
              <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => !uploading && input.current.click()}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); if (!uploading) uploadFiles(e.dataTransfer.files); }}>
                {uploading ? <Spinner /> : <Icon name="upload" />}
                <h3 style={{ marginTop: 10 }}>{uploading ? 'Uploading…' : 'Drop images here or click to choose'}</h3>
                <p className="muted small">Select several at once · JPG, PNG, GIF or WebP · up to {MAX_MB} MB each · max {MAX_FILES} per batch</p>
                <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/gif,image/webp" hidden
                  onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {uploads.length > 0 && (
                <ul className="upload-list">
                  {uploads.map((u, i) => (
                    <li key={i}>
                      <span className="truncate">{u.name}</span>
                      {u.status === 'waiting' && <span className="muted small">waiting</span>}
                      {u.status === 'uploading' && <Spinner />}
                      {u.status === 'done' && <Badge color="green">✓ uploaded</Badge>}
                      {u.status === 'error' && <Badge color="red" title={u.error}>✕ {u.error}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              {!uploading && uploads.some((u) => u.status === 'done') && (
                <p className="small muted">Uploaded images are selected. Click <b>Next</b> to arrange them, or open the library to add more.</p>
              )}
            </>
          )}

          {tab === 'library' && (
            !library ? <Spinner /> : library.length ? (
              <>
                <div className="row" style={{ marginBottom: 10 }}>
                  <span className="small muted">Click images to select them. They're inserted in the order you pick.</span>
                  <span className="spacer" />
                  <button className="btn btn-sm" onClick={() => setSelected(library)}>Select all</button>
                </div>
                <div className="img-grid">
                  {library.map((img) => {
                    const n = selected.findIndex((s) => s.url === img.url);
                    return (
                      <div key={img._id} className={`img-tile ${n >= 0 ? 'on' : ''}`}>
                        <button className="img-thumb" onClick={() => toggle(img)} aria-pressed={n >= 0} title={n >= 0 ? 'Unselect' : 'Select'}>
                          <img src={img.url} alt={img.name} loading="lazy" />
                          {n >= 0 && <span className="img-check">{n + 1}</span>}
                        </button>
                        {renaming?.id === img._id ? (
                          <form className="tag-edit" onSubmit={(e) => { e.preventDefault(); saveTag(img, renaming.value); }}>
                            <input autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} onBlur={() => saveTag(img, renaming.value)}
                              onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Image tag name" />
                          </form>
                        ) : (
                          <button type="button" className="tag-chip" title="Click to copy · double-click to rename"
                            onClick={() => copyTag(img)} onDoubleClick={() => setRenaming({ id: img._id, value: img.tag })}>
                            {`{{image:${img.tag}}}`}
                          </button>
                        )}
                        <div className="img-meta">
                          <span className="truncate small" title={img.name}>{img.name}</span>
                          <button className="btn btn-sm btn-ghost" onClick={() => copyUrl(img)} aria-label="Copy image address" title="Copy image address"><Icon name="link" /></button>
                          <button className="btn btn-sm btn-ghost" onClick={() => setRenaming({ id: img._id, value: img.tag })} aria-label="Rename tag" title="Rename tag"><Icon name="edit" /></button>
                          <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(img)} aria-label="Delete image"><Icon name="trash" /></button>
                        </div>
                        <div className="small muted">{img.width ? `${img.width}×${img.height} · ` : ''}{kb(img.size)}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : <div className="empty small">No images yet. Upload some and they'll be saved here for reuse.</div>
          )}

          {tab === 'link' && (
            <form onSubmit={addLink}>
              <Field label="Image address" hint="A public link to a JPG, PNG, GIF or WebP image (up to 10 MB). Google Drive and Dropbox share links work too. A copy is saved to your image library, so the email keeps working if the other site changes.">
                <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com/banner.jpg" autoFocus />
              </Field>
              <button className="btn" disabled={busy}>{busy ? <><Spinner />Downloading…</> : <><Icon name="plus" />Add to selection</>}</button>
              <p className="small muted">Tip: on a web page, right-click the image and choose <b>Copy image address</b>. A link to the page itself won't work.</p>
            </form>
          )}
        </>
      ) : (
        <div className="img-settings">
          <div>
            <div className="img-preview">
              <div className="img-preview-email" dangerouslySetInnerHTML={{ __html: imagesHtml(items, opts) }} />
            </div>
            <p className="small muted">Preview at email width. Galleries shrink to fit on phones.</p>
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
                    <button type="button" key={v} className={opts.layout === v ? 'active' : ''} onClick={() => setOpts({ ...opts, layout: v })}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            {!grid && (
              <>
                <div className="form-row">
                  <Field label="Width (px)" hint="600 or less works best in email">
                    <input type="number" min="20" max="1200" value={opts.width} onChange={set('width')} disabled={opts.full} />
                  </Field>
                  <label className="check" style={{ marginTop: 24 }}><input type="checkbox" checked={opts.full} onChange={set('full')} />Full width</label>
                </div>
                <div className="field">
                  <span className="label-text">Alignment</span>
                  <div className="seg">
                    {['left', 'center', 'right'].map((a) => <button type="button" key={a} className={opts.align === a ? 'active' : ''} onClick={() => setOpts({ ...opts, align: a })}>{a[0].toUpperCase() + a.slice(1)}</button>)}
                  </div>
                </div>
              </>
            )}
            {grid && <p className="small muted">Each image gets {Math.floor(100 / cols)}% of the row. Images with the same shape line up best.</p>}

            <span className="label-text">{multi ? 'Each image' : 'Details'}</span>
            <div className="img-items">
              {items.map((it, i) => (
                <div key={it.url} className="img-item">
                  <img src={it.url} alt="" />
                  <div className="img-item-fields">
                    <input type="text" value={it.alt} onChange={(e) => setItem(i, { alt: e.target.value })} placeholder="Alt text (shown if images are blocked)" aria-label={`Alt text for ${it.name}`} />
                    <LinkField value={it.link} onChange={(link) => setItem(i, { link })} placeholder="Link when clicked: https://… (optional)" ariaLabel={`Link for ${it.name}`} />
                  </div>
                  {multi && (
                    <div className="img-item-order">
                      <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                      <button type="button" className="btn btn-sm btn-ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {items.some((it) => it.mime === 'image/webp') && <div className="alert warn small" style={{ marginTop: 12 }}>WebP doesn't show in some Outlook versions. JPG or PNG is safer for email.</div>}
          </div>
        </div>
      )}
      {dialog}
    </Modal>
  );
}
