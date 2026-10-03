import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Field, Modal, Icon, fmtNum, useConfirm, Empty } from '../components/ui';

const COLORS = ['#4f46e5', '#0d9488', '#dc2626', '#d97706', '#7c3aed', '#2563eb', '#db2777', '#16a34a'];

function BusinessForm({ initial, onSaved, onCancel, submitLabel = 'Save' }) {
  const { toast } = useApp();
  const [f, setF] = useState({ name: '', website: '', address: '', color: COLORS[0], ...initial });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = initial?._id ? await api.put(`/businesses/${initial._id}`, f) : await api.post('/businesses', f);
      onSaved(r);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit}>
      <Field label="Business name"><input type="text" value={f.name} onChange={set('name')} required autoFocus placeholder="e.g. Acme Bakery" /></Field>
      <Field label="Website" hint="Available as {{business_website}} in emails"><input type="url" value={f.website} onChange={set('website')} placeholder="https://" /></Field>
      <Field label="Postal address" hint="Shown in the email footer. Anti-spam laws (CAN-SPAM) require a physical address in marketing emails."><input type="text" value={f.address} onChange={set('address')} /></Field>
      <div className="field">
        <span className="label-text">Color</span>
        <div className="row">{COLORS.map((c) => (
          <button type="button" key={c} className={`color-dot ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setF({ ...f, color: c })} aria-label={c} />
        ))}</div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-primary" disabled={busy}>{submitLabel}</button>
      </div>
    </form>
  );
}

export function FirstBusiness() {
  const { refreshBusinesses, setBusinessId } = useApp();
  return (
    <div className="center-card">
      <div className="card card-pad" style={{ maxWidth: 520, width: '100%' }}>
        <h1>Add your first business</h1>
        <p className="muted">Each business gets its own sender emails, contacts, lists, campaigns and reports. You can add more businesses any time.</p>
        <BusinessForm submitLabel="Create business" onSaved={async (b) => { await refreshBusinesses(); setBusinessId(b._id); }} />
      </div>
    </div>
  );
}

export default function Businesses() {
  const { businesses, refreshBusinesses, setBusinessId, businessId, toast } = useApp();
  const [editing, setEditing] = useState(null);
  const [confirm, dialog] = useConfirm();
  const navigate = useNavigate();

  const remove = async (b) => {
    if (!(await confirm({ title: `Delete ${b.name}?`, danger: true, confirmLabel: 'Delete everything',
      message: `This permanently deletes ${b.name} with its ${fmtNum(b.contacts)} contacts, ${fmtNum(b.senders)} sender accounts, ${fmtNum(b.campaigns)} campaigns and all tracking data.` }))) return;
    await api.del(`/businesses/${b._id}`);
    toast('Business deleted', 'success');
    refreshBusinesses();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Businesses</h1><p>Run campaigns for several brands from one place. Each one is fully separate.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" />Add business</button>
      </div>
      {businesses.length ? (
        <div className="grid g3">
          {businesses.map((b) => (
            <div key={b._id} className={`card biz-card ${b._id === businessId ? 'current' : ''}`}>
              <div className="row">
                <span className="avatar" style={{ background: b.color }}>{b.name[0]?.toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <h3 className="truncate">{b.name}</h3>
                  <div className="small muted truncate">{b.website || 'No website'}</div>
                </div>
              </div>
              <div className="stat-inline">
                <span><b>{fmtNum(b.contacts)}</b> contacts</span>
                <span><b>{fmtNum(b.senders)}</b> senders</span>
                <span><b>{fmtNum(b.campaigns)}</b> campaigns</span>
              </div>
              <div className="row">
                {b._id === businessId ? <span className="badge indigo">Current</span>
                  : <button className="btn btn-sm" onClick={() => { setBusinessId(b._id); navigate('/'); }}>Switch to</button>}
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(b)}><Icon name="edit" /></button>
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(b)}><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : <div className="card"><Empty title="No businesses yet" action={<button className="btn btn-primary" onClick={() => setEditing({})}>Add business</button>} /></div>}

      {editing && (
        <Modal title={editing._id ? 'Edit business' : 'Add business'} onClose={() => setEditing(null)}>
          <BusinessForm initial={editing} onCancel={() => setEditing(null)} onSaved={async (r) => {
            setEditing(null);
            await refreshBusinesses();
            if (!editing._id && r?._id) setBusinessId(r._id);
            toast('Saved', 'success');
          }} />
        </Modal>
      )}
      {dialog}
    </>
  );
}
