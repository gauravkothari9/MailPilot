import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Spinner, useConfirm } from './ui';

export const MAX_MB = 100;

/**
 * Uploads a file to the file library in parts (the hosting proxy limits each request to ~4.5 MB).
 * onProgress(0..1) is called after each part. Resolves the saved file.
 */
export async function uploadFile(businessId, file, onProgress) {
  const base = `/businesses/${businessId}/files/uploads`;
  const { uploadId, partSize } = await api.post(base, { name: file.name, size: file.size });
  const parts = Math.ceil(file.size / partSize);
  for (let i = 0; i < parts; i++) {
    const fd = new FormData();
    fd.append('file', file.slice(i * partSize, (i + 1) * partSize), file.name);
    // One retry per part: a dropped connection shouldn't cost the whole upload.
    try { await api.post(`${base}/${uploadId}/parts/${i}`, fd); } catch { await api.post(`${base}/${uploadId}/parts/${i}`, fd); }
    onProgress?.((i + 1) / parts);
  }
  return api.post(`${base}/${uploadId}/finish`, { name: file.name, parts });
}
export const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.csv,.txt,.mp3,.mp4,.jpg,.jpeg,.png,.gif,.webp';
export const kb =(n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

// One file list per business, shared by every LinkField on the page.
const cache = new Map();
export const loadFiles = (businessId, fresh) => {
  if (fresh || !cache.has(businessId)) cache.set(businessId, api.get(`/businesses/${businessId}/files`).catch((e) => { cache.delete(businessId); throw e; }));
  return cache.get(businessId);
};

/** True for links this app accepts on buttons and images. */
export const validLink = (v) => /^(https?:\/\/\S+|mailto:\S+|tel:\S+|\/i\/\S+|\{\{\s*\w+\s*\}\})$/i.test(String(v || '').trim());

/**
 * A link input with a "File" picker: upload a PDF/document (or pick one uploaded before)
 * and the link points to it. Uploaded files get a public address on this server.
 */
export default function LinkField({ value, onChange, placeholder = 'https://example.com', ariaLabel = 'Link', autoFocus }) {
  const { businessId, toast } = useApp();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirm, dialog] = useConfirm();
  const input = useRef();

  useEffect(() => {
    // Also load when the link already points to a file, to show the file's name.
    if ((open || value?.startsWith('/i/')) && !files) loadFiles(businessId).then(setFiles).catch((e) => toast(e.message, 'error'));
  }, [open, value, files, businessId, toast]);

  const current = files?.find((f) => f.url === value) || (value?.startsWith('/i/') ? { name: 'Uploaded file' } : null);

  const upload = async (file) => {
    if (!file) return;
    if (file.size > MAX_MB * 1048576) return toast(`${file.name} is ${kb(file.size)}. Files can be up to ${MAX_MB} MB.`, 'error');
    setBusy(true);
    try {
      const f = await uploadFile(businessId, file, (p) => setProgress(p));
      setFiles(await loadFiles(businessId, true));
      onChange(f.url);
      setOpen(false);
      toast(`${f.name} uploaded and linked`, 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); setProgress(0); }
  };

  const remove = async (f) => {
    if (!(await confirm({ title: 'Delete file?', danger: true, confirmLabel: 'Delete', message: `Links to “${f.name}” in emails already sent will stop working.` }))) return;
    try {
      await api.del(`/images/${f._id}`);
      setFiles(await loadFiles(businessId, true));
      if (value === f.url) onChange('');
    } catch (e) { toast(e.message, 'error'); }
  };

  return (
    <div className="link-field">
      <div className="link-field-row">
        {current ? (
          <div className="link-file-chip" title={value}>
            <Icon name="file" size={14} /><span className="truncate">{current.name}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange('')} aria-label="Remove file link">×</button>
          </div>
        ) : (
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} />
        )}
        <button type="button" className={`btn btn-sm ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} title="Link to a PDF or other file">
          <Icon name="file" />File
        </button>
      </div>
      {open && (
        <div className="link-files">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">Link to a file: PDF, Word, Excel, PowerPoint, ZIP… up to {MAX_MB} MB</span>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => input.current.click()}>
              {busy ? <><Spinner />{Math.round(progress * 100)}%</> : <><Icon name="upload" />Upload file</>}
            </button>
            <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ''; }} />
          </div>
          {!files ? <Spinner /> : files.length ? (
            <ul className="file-list">
              {files.map((f) => (
                <li key={f._id} className={f.url === value ? 'on' : ''}>
                  <button type="button" className="file-pick" onClick={() => { onChange(f.url); setOpen(false); }}>
                    <Icon name="file" size={15} /><span className="truncate">{f.name}</span><span className="small muted">{kb(f.size)}</span>
                  </button>
                  <a className="btn btn-sm btn-ghost" href={f.url} target="_blank" rel="noreferrer" title="Open">
                    <Icon name="eye" />
                  </a>
                  <button type="button" className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(f)} aria-label={`Delete ${f.name}`}><Icon name="trash" /></button>
                </li>
              ))}
            </ul>
          ) : <p className="small muted" style={{ margin: '8px 0 0' }}>No files yet. Upload one and it's saved here for reuse.</p>}
        </div>
      )}
      {dialog}
    </div>
  );
}
