import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from '../api';
import { useApp } from '../context';
import { Icon, Loading, Pager, SearchInput, Empty, Badge, ScorePill, fullName, fmtNum, timeAgo, useDebounced, useConfirm, Modal, Field } from '../components/ui';
import ImportModal from '../components/ImportModal';
import ContactModal from '../components/ContactModal';

export default function Contacts() {
  const { businessId, business, toast } = useApp();
  const [params, setParams] = useSearchParams();
  const [lists, setLists] = useState([]);
  const [tags, setTags] = useState([]);
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(new Set());
  const [open, setOpen] = useState(null);
  const [importing, setImporting] = useState(params.get('import') === '1');
  const [bulk, setBulk] = useState(null);
  const [confirm, dialog] = useConfirm();
  const dq = useDebounced(q);
  const list = params.get('list') || '';
  const status = params.get('status') || '';
  const tag = params.get('tag') || '';

  const setFilter = (k, v) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    p.delete('import');
    setParams(p);
    setPage(1);
  };

  const filters = { q: dq, list, status, tag };
  const load = useCallback(() => {
    api.get(`/businesses/${businessId}/contacts${qs({ ...filters, page, per: 50 })}`).then(setData).catch((e) => toast(e.message, 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, dq, list, status, tag, page, toast]);
  const loadMeta = useCallback(() => {
    api.get(`/businesses/${businessId}/lists`).then(setLists).catch(() => {});
    api.get(`/businesses/${businessId}/tags`).then(setTags).catch(() => {});
  }, [businessId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadMeta(); }, [loadMeta]);
  useEffect(() => { setSelected(new Set()); }, [dq, list, status, tag, page]);

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => (s.size === data.rows.length ? new Set() : new Set(data.rows.map((r) => r._id))));

  const runBulk = async (action, extra = {}) => {
    if (action === 'delete' && !(await confirm({ title: `Delete ${selected.size} contacts?`, danger: true, confirmLabel: 'Delete', message: 'Their email history stays in campaign reports, but the contacts are removed.' }))) return;
    const r = await api.post('/contacts/bulk', { action, ids: [...selected], ...extra });
    toast(`${fmtNum(r.affected)} contacts updated`, 'success');
    setSelected(new Set());
    setBulk(null);
    load();
    loadMeta();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Contacts</h1><p>{business?.name} · {data ? `${fmtNum(data.total)} contacts` : '…'}</p></div>
        <div className="row">
          <a className="btn" href={`/api/businesses/${businessId}/contacts/export${qs(filters)}`}><Icon name="download" />Export CSV</a>
          <button className="btn" onClick={() => setOpen('new')}><Icon name="plus" />Add contact</button>
          <button className="btn btn-primary" onClick={() => setImporting(true)}><Icon name="upload" />Import Excel / CSV</button>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, email, company, phone…" />
            <select style={{ width: 'auto' }} value={list} onChange={(e) => setFilter('list', e.target.value)}>
              <option value="">All lists</option>
              {lists.map((l) => <option key={l._id} value={l._id}>{l.name} ({fmtNum(l.contacts)})</option>)}
            </select>
            <select style={{ width: 'auto' }} value={tag} onChange={(e) => setFilter('tag', e.target.value)}>
              <option value="">All tags</option>
              {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({fmtNum(t.count)})</option>)}
            </select>
            <select style={{ width: 'auto' }} value={status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">Any status</option>
              <option value="subscribed">Subscribed</option>
              <option value="unsubscribed">Unsubscribed</option>
              <option value="bounced">Bounced</option>
            </select>
          </div>
          {selected.size > 0 && (
            <div className="row bulk-bar">
              <b>{selected.size} selected</b>
              <button className="btn btn-sm" onClick={() => setBulk({ action: 'addToList' })}><Icon name="list" />Add to list</button>
              <button className="btn btn-sm" onClick={() => setBulk({ action: 'addTag' })}><Icon name="tag" />Tag</button>
              <button className="btn btn-sm" onClick={() => runBulk('unsubscribe')}><Icon name="userx" />Unsubscribe</button>
              <button className="btn btn-sm btn-danger" onClick={() => runBulk('delete')}><Icon name="trash" />Delete</button>
            </div>
          )}
        </div>

        {!data ? <Loading /> : data.rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" aria-label="Select all" checked={selected.size === data.rows.length} onChange={toggleAll} /></th>
                    <th>Contact</th><th>Company</th><th>Lists & tags</th><th>Emails</th><th title="Engagement score 0–100 from opens, clicks and recency">Score</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r._id} className="clickable" onClick={() => setOpen(r._id)}>
                      <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.email}`} checked={selected.has(r._id)} onChange={() => toggle(r._id)} /></td>
                      <td><div className="strong">{fullName(r) || '—'}</div><div className="small muted">{r.email}</div></td>
                      <td>{r.company || <span className="muted">—</span>}</td>
                      <td><div className="chips">{r.listNames.map((n) => <Badge key={n}>{n}</Badge>)}{(r.tags || []).map((t) => <Badge key={t} color="violet">#{t}</Badge>)}</div></td>
                      <td className="small nowrap">{fmtNum(r.sent)} sent · {fmtNum(r.opened)} opened · {fmtNum(r.clicked)} clicked{r.lastOpen && <div className="muted">last open {timeAgo(r.lastOpen)}</div>}</td>
                      <td><ScorePill score={r.score} /></td>
                      <td>{r.unsubscribed ? <Badge color="amber">Unsubscribed</Badge> : r.bounced ? <Badge color="red">Bounced</Badge> : <Badge color="green">Subscribed</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} per={data.per} total={data.total} onPage={setPage} />
          </>
        ) : (
          <Empty title={q || list || status || tag ? 'No contacts match these filters' : 'No contacts yet'}
            action={!(q || list || status || tag) && <button className="btn btn-primary" onClick={() => setImporting(true)}><Icon name="upload" />Import your Excel sheet</button>}>
            {!(q || list || status || tag) && 'Upload an Excel or CSV file with an email column. Names, companies and any other columns come along too.'}
          </Empty>
        )}
      </div>

      {importing && <ImportModal lists={lists} defaultListId={list} onClose={() => setImporting(false)} onDone={() => { load(); loadMeta(); }} />}
      {open && <ContactModal id={open === 'new' ? null : open} lists={lists} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); loadMeta(); }} />}
      {bulk && (
        <Modal title={bulk.action === 'addTag' ? `Tag ${selected.size} contacts` : `Add ${selected.size} contacts to a list`} onClose={() => setBulk(null)}
          footer={<><button className="btn" onClick={() => setBulk(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={!bulk.value} onClick={() => runBulk(bulk.action, bulk.action === 'addTag' ? { tag: bulk.value } : { listId: bulk.value })}>Apply</button></>}>
          {bulk.action === 'addTag' ? (
            <Field label="Tag" hint="Comma separate to add several"><input type="text" autoFocus value={bulk.value || ''} onChange={(e) => setBulk({ ...bulk, value: e.target.value })} list="tag-options" />
              <datalist id="tag-options">{tags.map((t) => <option key={t.tag} value={t.tag} />)}</datalist></Field>
          ) : (
            <Field label="List"><select value={bulk.value || ''} onChange={(e) => setBulk({ ...bulk, value: e.target.value })}><option value="">Choose a list…</option>{lists.map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</select></Field>
          )}
        </Modal>
      )}
      {dialog}
    </>
  );
}
