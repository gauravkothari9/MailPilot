import { useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Icon, Field, Spinner, fmtNum } from './ui';

const TARGETS = [
  ['email', 'Email address', true],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fullName', 'Full name (split automatically)'],
  ['company', 'Company'],
  ['phone', 'Phone'],
];
const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';

export default function ImportModal({ lists, defaultListId, onClose, onDone }) {
  const { businessId, toast } = useApp();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState({});
  const [target, setTarget] = useState(defaultListId ? 'existing' : 'new');
  const [listId, setListId] = useState(defaultListId || lists[0]?._id || '');
  const [newListName, setNewListName] = useState('');
  const [tags, setTags] = useState('');
  const [extraColumns, setExtraColumns] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [over, setOver] = useState(false);
  const input = useRef();

  const upload = async (f, sheet) => {
    if (!f) return;
    setFile(f);
    setBusy(true);
    const fd = new FormData();
    fd.append('file', f);
    if (sheet) fd.append('sheet', sheet);
    try {
      const p = await api.post(`/businesses/${businessId}/import/preview`, fd);
      setPreview(p);
      setMapping(p.mapping);
      if (!newListName) setNewListName(f.name.replace(/\.[^.]+$/, ''));
      setStep(2);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/businesses/${businessId}/import/commit`, {
        uploadId: preview.uploadId, mapping, extraColumns, updateExisting, tags,
        listId: target === 'existing' ? listId : undefined, newListName: target === 'new' ? newListName : undefined,
      });
      setResult(r);
      setStep(3);
      onDone?.();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  const mapped = new Set(Object.values(mapping).filter(Boolean));
  const extras = preview ? preview.headers.filter((h) => !mapped.has(h)) : [];

  const footer = step === 2 ? (
    <>
      <button className="btn" onClick={() => setStep(1)}>Back</button>
      <button className="btn btn-primary" onClick={commit} disabled={busy || !mapping.email || (target === 'existing' && !listId)}>
        {busy ? <><Spinner /> Importing…</> : `Import ${fmtNum(preview?.total)} rows`}
      </button>
    </>
  ) : step === 3 ? <button className="btn btn-primary" onClick={onClose}>Done</button> : null;

  return (
    <Modal title="Import contacts from Excel / CSV" onClose={onClose} wide footer={footer}>
      <div className="steps">
        <span className={step === 1 ? 'on' : ''}>1. Upload</span>
        <span className={step === 2 ? 'on' : ''}>2. Match columns</span>
        <span className={step === 3 ? 'on' : ''}>3. Done</span>
      </div>

      {step === 1 && (
        <>
          <div className={`dropzone ${over ? 'over' : ''}`} onClick={() => input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files[0]); }}>
            {busy ? <Spinner /> : <Icon name="upload" />}
            <h3 style={{ marginTop: 10 }}>{busy ? `Reading ${file?.name}…` : 'Drop your Excel or CSV file here'}</h3>
            <p className="muted small">or click to browse · .xlsx, .xls, .csv up to 25 MB · first row must be column headers</p>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv,.ods,.txt" hidden onChange={(e) => upload(e.target.files[0])} />
          </div>
          <p className="muted small" style={{ marginTop: 14 }}>
            Tip: any extra columns (City, Plan, Birthday…) are saved too and become merge tags like <code>{'{{city}}'}</code> and segment filters.
          </p>
        </>
      )}

      {step === 2 && preview && (
        <>
          <div className="row" style={{ marginBottom: 14 }}>
            <Icon name="check" size={16} style={{ color: 'var(--green)' }} />
            <b>{preview.filename}</b><span className="muted">· {fmtNum(preview.total)} rows · {preview.headers.length} columns</span>
            {preview.sheets.length > 1 && (
              <select style={{ width: 'auto', marginLeft: 'auto' }} value={preview.sheet} onChange={(e) => upload(file, e.target.value)}>
                {preview.sheets.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
          </div>

          <div className="grid g2" style={{ alignItems: 'start' }}>
            <div>
              <h3 className="section-title" style={{ marginTop: 0 }}>Match your columns</h3>
              <div className="map-grid">
                {TARGETS.map(([key, label, req]) => (
                  <label key={key} style={{ display: 'contents' }}>
                    <span className="small strong">{label}{req && <span className="text-red"> *</span>}</span>
                    <select value={mapping[key] || ''} onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || undefined })}>
                      <option value="">— skip —</option>
                      {preview.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <label className="check" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={extraColumns} onChange={(e) => setExtraColumns(e.target.checked)} />
                Keep the other {extras.length} columns as custom fields
              </label>
              {extraColumns && extras.length > 0 && (
                <div className="chips" style={{ margin: '8px 0 0 24px' }}>{extras.map((h) => <span key={h} className="chip static">{`{{${slug(h)}}}`}</span>)}</div>
              )}
            </div>
            <div>
              <h3 className="section-title" style={{ marginTop: 0 }}>Add to list</h3>
              <div className="seg" style={{ marginBottom: 10 }}>
                <button type="button" className={target === 'new' ? 'active' : ''} onClick={() => setTarget('new')}>New list</button>
                <button type="button" className={target === 'existing' ? 'active' : ''} onClick={() => setTarget('existing')} disabled={!lists.length}>Existing list</button>
              </div>
              {target === 'new'
                ? <Field><input type="text" value={newListName} onChange={(e) => setNewListName(e.target.value)} placeholder="List name" /></Field>
                : <Field><select value={listId} onChange={(e) => setListId(e.target.value)}>{lists.map((l) => <option key={l._id} value={l._id}>{l.name} ({fmtNum(l.contacts)})</option>)}</select></Field>}
              <Field label="Tags (optional)" hint="Comma separated, e.g. “expo-2026, wholesale”"><input type="text" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
              <label className="check"><input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />Update contacts that already exist</label>
            </div>
          </div>

          <h3 className="section-title">Preview</h3>
          <div className="table-wrap preview-table">
            <table>
              <thead><tr>{preview.headers.map((h) => <th key={h} className={mapped.has(h) ? 'mapped' : ''}>{h}</th>)}</tr></thead>
              <tbody>{preview.sample.map((r, i) => <tr key={i}>{preview.headers.map((h) => <td key={h} className="truncate" style={{ maxWidth: 200 }}>{String(r[h] ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {step === 3 && result && (
        <div>
          <div className="alert success"><Icon name="check" size={18} /><div>Import finished into <b>{result.listName}</b>.</div></div>
          <div className="kpis" style={{ marginBottom: 12 }}>
            <div className="card kpi"><div className="label">New contacts</div><div className="value">{fmtNum(result.added)}</div></div>
            <div className="card kpi"><div className="label">Updated</div><div className="value">{fmtNum(result.updated + result.existing)}</div></div>
            <div className="card kpi"><div className="label">Duplicates in file</div><div className="value">{fmtNum(result.duplicateInFile)}</div></div>
            <div className="card kpi"><div className="label">Invalid emails</div><div className="value">{fmtNum(result.invalid)}</div></div>
          </div>
          {result.invalidRows.length > 0 && (
            <>
              <h3 className="section-title">Skipped rows (invalid email)</h3>
              <div className="small muted">{result.invalidRows.map((r) => `Row ${r.row}: “${r.value || 'empty'}”`).join(' · ')}{result.invalid > result.invalidRows.length && ' …'}</div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
