import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Loading, Empty, Modal, Field, fmtNum, fmtDate } from '../components/ui';
import ImportModal from '../components/ImportModal';

export default function Lists() {
  const { businessId, business, toast } = useApp();
  const [lists, setLists] = useState(null);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [withContacts, setWithContacts] = useState(false);

  const load = useCallback(() => api.get(`/businesses/${businessId}/lists`).then(setLists).catch((e) => toast(e.message, 'error')), [businessId, toast]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (editing._id) await api.put(`/lists/${editing._id}`, { name: editing.name });
      else await api.post(`/businesses/${businessId}/lists`, { name: editing.name });
      setEditing(null);
      load();
    } catch (err) { toast(err.message, 'error'); }
  };
  const remove = async () => {
    await api.del(`/lists/${deleting._id}${withContacts ? '?withContacts=1' : ''}`);
    setDeleting(null);
    toast('List deleted', 'success');
    load();
  };

  if (!lists) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div><h1>Lists</h1><p>Groups of {business?.name} contacts to send campaigns to. A contact can be in many lists.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setEditing({ name: '' })}><Icon name="plus" />New empty list</button>
          <button className="btn btn-primary" onClick={() => setImporting('new')}><Icon name="upload" />Import Excel into new list</button>
        </div>
      </div>
      <div className="card">
        {lists.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>List</th><th>Contacts</th><th>Can receive email</th><th>Created</th><th /></tr></thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l._id}>
                    <td><Link className="strong" to={`/contacts?list=${l._id}`}>{l.name}</Link></td>
                    <td>{fmtNum(l.contacts)}</td>
                    <td>{fmtNum(l.active)} <span className="muted small">({fmtNum(l.contacts - l.active)} unsubscribed/bounced)</span></td>
                    <td className="small muted">{fmtDate(l.createdAt, false)}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm" onClick={() => setImporting(l._id)}><Icon name="upload" />Add contacts</button>
                        <a className="btn btn-sm btn-ghost" href={`/api/businesses/${businessId}/contacts/export?list=${l._id}`} title="Export CSV"><Icon name="download" /></a>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(l)} title="Rename"><Icon name="edit" /></button>
                        <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { setDeleting(l); setWithContacts(false); }} title="Delete"><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No lists yet" action={<button className="btn btn-primary" onClick={() => setImporting('new')}><Icon name="upload" />Import your first Excel sheet</button>}>
            Importing a file creates a list automatically.
          </Empty>
        )}
      </div>

      {editing && (
        <Modal title={editing._id ? 'Rename list' : 'New list'} onClose={() => setEditing(null)}
          footer={<><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn btn-primary" form="list-form">Save</button></>}>
          <form id="list-form" onSubmit={save}><Field label="List name"><input type="text" autoFocus required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field></form>
        </Modal>
      )}
      {deleting && (
        <Modal title={`Delete “${deleting.name}”?`} onClose={() => setDeleting(null)}
          footer={<><button className="btn" onClick={() => setDeleting(null)}>Cancel</button><button className="btn btn-danger-solid" onClick={remove}>Delete list</button></>}>
          <p>The list is removed. Campaigns already sent keep their reports.</p>
          <label className="check"><input type="checkbox" checked={withContacts} onChange={(e) => setWithContacts(e.target.checked)} />Also delete contacts that are only in this list</label>
        </Modal>
      )}
      {importing && <ImportModal lists={lists} defaultListId={importing === 'new' ? '' : importing} onClose={() => setImporting(null)} onDone={load} />}
    </>
  );
}
