import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Modal, Field, Loading, Tabs, StatusBadge, fmtDate, fmtNum, timeAgo, EVENT_META, Badge } from './ui';

/** Create (no id) or view/edit a contact with its full email history. */
export default function ContactModal({ id, lists, onClose, onSaved }) {
  const { businessId, toast } = useApp();
  const [c, setC] = useState(id ? null : { email: '', firstName: '', lastName: '', company: '', phone: '', lists: [], tags: [], fields: {} });
  const [tab, setTab] = useState('details');
  const [busy, setBusy] = useState(false);
  const [tagText, setTagText] = useState('');

  useEffect(() => {
    if (id) api.get(`/contacts/${id}`).then((d) => { setC(d); setTagText((d.tags || []).join(', ')); }).catch((e) => toast(e.message, 'error'));
  }, [id, toast]);

  const set = (k) => (e) => setC({ ...c, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const toggleList = (lid) => setC({ ...c, lists: c.lists.includes(lid) ? c.lists.filter((x) => x !== lid) : [...c.lists, lid] });
  const setField = (k, v) => setC({ ...c, fields: { ...c.fields, [k]: v } });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { ...c, tags: tagText };
      if (id) await api.put(`/contacts/${id}`, body);
      else await api.post(`/businesses/${businessId}/contacts`, body);
      toast('Contact saved', 'success');
      onSaved();
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const opened = c?.messages?.filter((m) => m.openedAt).length || 0;
  const clicked = c?.messages?.filter((m) => m.clickedAt).length || 0;

  return (
    <Modal title={id ? (c ? c.email : 'Contact') : 'Add contact'} onClose={onClose} wide
      footer={tab === 'details' && <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="contact-form" disabled={busy || !c}>Save</button></>}>
      {!c ? <Loading /> : (
        <>
          {id && (
            <>
              <div className="stat-inline" style={{ marginBottom: 12 }}>
                <span><b>{fmtNum(c.messages.length)}</b> emails</span>
                <span><b>{fmtNum(opened)}</b> opened</span>
                <span><b>{fmtNum(clicked)}</b> clicked</span>
                <span>Added {fmtDate(c.createdAt, false)}</span>
                {c.unsubscribed && <Badge color="amber">Unsubscribed {timeAgo(c.unsubscribedAt)}</Badge>}
                {c.bounced && <Badge color="red">Bounced</Badge>}
              </div>
              <Tabs value={tab} onChange={setTab} tabs={[
                { value: 'details', label: 'Details' },
                { value: 'emails', label: 'Emails', count: c.messages.length },
                { value: 'activity', label: 'Activity', count: c.events.length },
              ]} />
              <div style={{ height: 16 }} />
            </>
          )}

          {tab === 'details' && (
            <form id="contact-form" onSubmit={save}>
              <div className="form-row">
                <Field label="Email"><input type="email" value={c.email} onChange={set('email')} required /></Field>
                <Field label="Phone"><input type="text" value={c.phone} onChange={set('phone')} /></Field>
              </div>
              <div className="form-row">
                <Field label="First name"><input type="text" value={c.firstName} onChange={set('firstName')} /></Field>
                <Field label="Last name"><input type="text" value={c.lastName} onChange={set('lastName')} /></Field>
              </div>
              <div className="form-row">
                <Field label="Company"><input type="text" value={c.company} onChange={set('company')} /></Field>
                <Field label="Tags" hint="Comma separated"><input type="text" value={tagText} onChange={(e) => setTagText(e.target.value)} /></Field>
              </div>
              {Object.keys(c.fields || {}).length > 0 && (
                <>
                  <h3 className="section-title">Custom fields</h3>
                  <div className="form-row">
                    {Object.entries(c.fields).map(([k, v]) => (
                      <Field key={k} label={<code>{`{{${k}}}`}</code>}><input type="text" value={v} onChange={(e) => setField(k, e.target.value)} /></Field>
                    ))}
                  </div>
                </>
              )}
              <h3 className="section-title">Lists</h3>
              <div className="chips">
                {lists.map((l) => (
                  <label key={l._id} className={`chip-check ${c.lists.includes(l._id) ? 'on' : ''}`}>
                    <input type="checkbox" checked={c.lists.includes(l._id)} onChange={() => toggleList(l._id)} />{l.name}
                  </label>
                ))}
                {!lists.length && <span className="muted small">No lists yet</span>}
              </div>
              {id && (
                <>
                  <h3 className="section-title">Status</h3>
                  <div className="row">
                    <label className="check"><input type="checkbox" checked={!!c.unsubscribed} onChange={set('unsubscribed')} />Unsubscribed</label>
                    <label className="check"><input type="checkbox" checked={!!c.bounced} onChange={set('bounced')} />Bounced</label>
                  </div>
                  <p className="small muted">Only re-subscribe someone if they asked you to. Unsubscribed and bounced contacts are skipped by every campaign.</p>
                </>
              )}
            </form>
          )}

          {tab === 'emails' && (
            c.messages.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Opened</th><th>Clicked</th></tr></thead>
                  <tbody>
                    {c.messages.map((m) => (
                      <tr key={m._id}>
                        <td><Link to={`/campaigns/${m.campaign?._id}`}>{m.campaign?.name || 'Deleted campaign'}</Link><div className="small muted truncate" style={{ maxWidth: 260 }}>{m.campaign?.subject}</div></td>
                        <td><StatusBadge status={m.status} />{m.error && <div className="small text-red">{m.error}</div>}</td>
                        <td className="small">{fmtDate(m.sentAt)}</td>
                        <td className="small">{m.openedAt ? <>{fmtDate(m.openedAt)}<div className="muted">{m.openCount}×</div></> : '—'}</td>
                        <td className="small">{m.clickedAt ? <>{fmtDate(m.clickedAt)}<div className="muted">{m.clickCount}×</div></> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty small">No emails sent to this contact yet.</div>
          )}

          {tab === 'activity' && (
            c.events.length ? (
              <ul className="timeline">
                {c.events.map((e) => (
                  <li key={e._id} className={e.type}>
                    <b>{EVENT_META[e.type]?.label || e.type}</b>{e.bot && <> <Badge>bot</Badge></>} <span className="muted">· {e.campaign?.name}</span>
                    <div className="small muted">{fmtDate(e.createdAt)}{e.url ? ` · ${e.url}` : ''}</div>
                  </li>
                ))}
              </ul>
            ) : <div className="empty small">No activity yet.</div>
          )}
        </>
      )}
    </Modal>
  );
}
