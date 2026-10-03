import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Icon, Field, Spinner, Tabs, useConfirm } from './ui';

const MAX_MB = 4;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

function naturalSize(src) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = src;
  });
}

/** Email-safe image HTML: fixed width attribute, fluid on mobile, optional tracked link. */
export function imageHtml({ url, alt, width, full, align, link }) {
  const margin = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin-left:auto;' : '';
  const style = `display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;${full ? 'width:100%;' : ''}${margin}`;
  const img = `<img src="${esc(url)}" alt="${esc(alt)}" width="${full ? '100%' : Math.round(width)}" style="${style}" />`;
  const inner = link ? `<a href="${esc(link)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
  return `\n<div style="margin:0 0 16px;text-align:${align};">${inner}</div>\n`;
}

export default function ImageModal({ onInsert, onClose }) {
  const { businessId, toast } = useApp();
  const [tab, setTab] = useState('upload');
  const [library, setLibrary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState(null); // { url, name, width, height }
  const [opts, setOpts] = useState({ alt: '', width: 560, full: false, align: 'center', link: '' });
  const [linkUrl, setLinkUrl] = useState('');
  const [confirm, dialog] = useConfirm();
  const input = useRef();

  const loadLibrary = () => api.get(`/businesses/${businessId}/images`).then(setLibrary).catch((e) => toast(e.message, 'error'));
  useEffect(() => { loadLibrary(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (img) => {
    setPicked(img);
    const natural = img.width || 560;
    setOpts((o) => ({ ...o, alt: o.alt || img.name?.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || '', width: Math.min(natural, 560) }));
  };

  const uploadFile = async (file) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) return toast('Use a JPG, PNG, GIF or WebP image', 'error');
    if (file.size > MAX_MB * 1048576) return toast(`Image is ${kb(file.size)}; the limit is ${MAX_MB} MB. Compress it first (e.g. tinypng.com).`, 'error');
    setBusy(true);
    try {
      const objectUrl = URL.createObjectURL(file);
      const dims = await naturalSize(objectUrl);
      URL.revokeObjectURL(objectUrl);
      const fd = new FormData();
      fd.append('file', file);
      fd.append('width', dims.width);
      fd.append('height', dims.height);
      const img = await api.post(`/businesses/${businessId}/images`, fd);
      setLibrary((l) => [img, ...(l || [])]);
      pick(img);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const useLink = async (e) => {
    e.preventDefault();
    if (!/^https:\/\/\S+$/i.test(linkUrl)) return toast('Image links must start with https://', 'error');
    setBusy(true);
    const dims = await naturalSize(linkUrl);
    setBusy(false);
    if (!dims.width) return toast('Could not load an image from that link', 'error');
    pick({ url: linkUrl, name: linkUrl.split('/').pop(), ...dims });
  };

  const remove = async (img) => {
    if (!(await confirm({ title: 'Delete image?', danger: true, confirmLabel: 'Delete', message: 'Emails already sent with this image will show a broken image. Only delete images you never sent.' }))) return;
    await api.del(`/images/${img._id}`);
    setLibrary((l) => l.filter((x) => x._id !== img._id));
  };

  const insert = () => {
    if (opts.link && !/^(https?:\/\/|mailto:)/i.test(opts.link)) return toast('Link must start with https://', 'error');
    onInsert(imageHtml({ url: picked.url, ...opts }));
  };

  const set = (k) => (e) => setOpts({ ...opts, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <Modal title={picked ? 'Image settings' : 'Insert image'} onClose={onClose} wide
      footer={picked && <>
        <button className="btn" onClick={() => setPicked(null)}>Back</button>
        <button className="btn btn-primary" onClick={insert}><Icon name="plus" />Insert into email</button>
      </>}>
      {!picked ? (
        <>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'upload', label: 'Upload' },
            { value: 'library', label: 'Image library', count: library?.length },
            { value: 'link', label: 'From a link' },
          ]} />
          <div style={{ height: 16 }} />

          {tab === 'upload' && (
            <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current.click()}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); uploadFile(e.dataTransfer.files[0]); }}>
              {busy ? <Spinner /> : <Icon name="upload" />}
              <h3 style={{ marginTop: 10 }}>{busy ? 'Uploading…' : 'Drop an image here or click to choose'}</h3>
              <p className="muted small">JPG, PNG, GIF or WebP · up to {MAX_MB} MB · best width 600–1200 px</p>
              <input ref={input} type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden onChange={(e) => uploadFile(e.target.files[0])} />
            </div>
          )}

          {tab === 'library' && (
            !library ? <Spinner /> : library.length ? (
              <div className="img-grid">
                {library.map((img) => (
                  <div key={img._id} className="img-tile">
                    <button className="img-thumb" onClick={() => pick(img)} title="Use this image"><img src={img.url} alt={img.name} loading="lazy" /></button>
                    <div className="img-meta">
                      <span className="truncate small" title={img.name}>{img.name}</span>
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(img)} aria-label="Delete image"><Icon name="trash" /></button>
                    </div>
                    <div className="small muted">{img.width ? `${img.width}×${img.height} · ` : ''}{kb(img.size)}</div>
                  </div>
                ))}
              </div>
            ) : <div className="empty small">No images yet. Upload one and it will be saved here for reuse.</div>
          )}

          {tab === 'link' && (
            <form onSubmit={useLink}>
              <Field label="Image address" hint="Must be a public https:// link that ends in an image (e.g. from your website)">
                <input type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://example.com/banner.jpg" autoFocus />
              </Field>
              <button className="btn btn-primary" disabled={busy}>{busy ? <Spinner /> : 'Use this image'}</button>
            </form>
          )}
        </>
      ) : (
        <div className="img-settings">
          <div className="img-preview" style={{ textAlign: opts.align }}>
            <img src={picked.url} alt={opts.alt} style={{ width: opts.full ? '100%' : `${Math.min(opts.width, 560)}px`, maxWidth: '100%' }} />
          </div>
          <div>
            <Field label="Alt text" hint="Shown when images are blocked; helps deliverability and accessibility">
              <input type="text" value={opts.alt} onChange={set('alt')} placeholder="e.g. Diwali sale banner" />
            </Field>
            <div className="form-row">
              <Field label="Width (px)" hint={picked.width ? `Original: ${picked.width}px. Use 600 or less for email.` : undefined}>
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
            <Field label="Link when clicked (optional)" hint="Clicks are tracked like any other link">
              <input type="url" value={opts.link} onChange={set('link')} placeholder="https://yourshop.com/sale" />
            </Field>
            {picked.mime === 'image/webp' && <div className="alert warn small">WebP doesn't show in some Outlook versions. JPG or PNG is safer for email.</div>}
          </div>
        </div>
      )}
      {dialog}
    </Modal>
  );
}
