import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Loading, Empty, StatusBadge, Modal, Field, fmtNum, fmtPct, fmtDate, useConfirm, usePoll, Badge, Progress } from '../components/ui';

export default function Campaigns() {
  const { businessId, business, toast } = useApp();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [creating, setCreating] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [filter, setFilter] = useState('all');
  const [confirm, dialog] = useConfirm();

  const load = useCallback(() => api.get(`/businesses/${businessId}/campaigns`).then(setRows).catch((e) => toast(e.message, 'error')), [businessId, toast]);
  useEffect(() => { load(); }, [load]);
  usePoll(load, 5000, !!rows?.some((r) => ['sending', 'testing', 'scheduled'].includes(r.status)));

  const openCreate = () => {
    setCreating({ name: '', template: '' });
    api.get(`/businesses/${businessId}/templates`).then(setTemplates).catch(() => {});
  };
  const create = async (e) => {
    e.preventDefault();
    try {
      const c = await api.post(`/businesses/${businessId}/campaigns`, { name: creating.name || 'Untitled campaign' });
      if (creating.template) await api.post(`/campaigns/${c._id}/apply-template`, { templateId: creating.template });
      navigate(`/campaigns/${c._id}/edit`);
    } catch (err) { toast(err.message, 'error'); }
  };
  const duplicate = async (c) => {
    const copy = await api.post(`/campaigns/${c._id}/duplicate`);
    navigate(`/campaigns/${copy._id}/edit`);
  };
  const remove = async (c) => {
    if (!(await confirm({ title: `Delete “${c.name}”?`, danger: true, confirmLabel: 'Delete', message: 'The campaign and all of its tracking data (opens, clicks, recipients) are deleted permanently.' }))) return;
    await api.del(`/campaigns/${c._id}`);
    load();
  };

  if (!rows) return <Loading />;
  const shown = rows.filter((r) => filter === 'all' || (filter === 'active' ? ['sending', 'testing', 'scheduled', 'paused'].includes(r.status) : r.status === filter));
  const count = (f) => rows.filter((r) => (f === 'active' ? ['sending', 'testing', 'scheduled', 'paused'].includes(r.status) : r.status === f)).length;

  return (
    <>
      <div className="page-head">
        <div><h1>Campaigns</h1><p>{business?.name} · {fmtNum(rows.length)} campaigns</p></div>
        <button className="btn btn-primary" onClick={openCreate}><Icon name="plus" />New campaign</button>
      </div>

      <div className="card">
        <div className="tabs">
          {[['all', 'All', rows.length], ['draft', 'Drafts', count('draft')], ['active', 'In progress', count('active')], ['sent', 'Sent', count('sent')]].map(([v, l, n]) => (
            <button key={v} className={filter === v ? 'active' : ''} onClick={() => setFilter(v)}>{l}<span className="count">{n}</span></button>
          ))}
        </div>
        {shown.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Campaign</th><th>Status</th><th>Audience</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Unsub.</th><th /></tr></thead>
              <tbody>
                {shown.map((c) => {
                  const s = c.stats;
                  const editable = c.status === 'draft';
                  const progress = s.total ? (100 * (s.sent + s.failed + s.skipped)) / s.total : 0;
                  return (
                    <tr key={c._id} className="clickable" onClick={() => navigate(editable ? `/campaigns/${c._id}/edit` : `/campaigns/${c._id}`)}>
                      <td style={{ maxWidth: 320 }}>
                        <div className="strong truncate">{c.name}</div>
                        <div className="small muted truncate">{c.subject || 'No subject yet'}</div>
                        <div className="row" style={{ gap: 6, marginTop: 4 }}>
                          {c.abTest?.enabled && <Badge color="violet"><Icon name="split" size={11} /> A/B</Badge>}
                          {c.rules?.length > 0 && <Badge><Icon name="filter" size={11} /> {c.rules.length} rule{c.rules.length > 1 ? 's' : ''}</Badge>}
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={c.status} />
                        <div className="small muted" style={{ marginTop: 4 }}>
                          {c.status === 'scheduled' ? fmtDate(c.scheduledAt) : c.status === 'sent' ? fmtDate(c.finishedAt || c.startedAt) : c.status === 'draft' ? `Edited ${fmtDate(c.updatedAt, false)}` : ''}
                        </div>
                        {['sending', 'testing', 'paused'].includes(c.status) && <div style={{ marginTop: 6, width: 110 }}><Progress value={progress} /></div>}
                      </td>
                      <td className="small">
                        {c.audience === 'list' ? (c.list?.name || <span className="muted">No list</span>) : <>{c.audience === 'non_openers' ? 'Non-openers' : 'Non-clickers'} of <i>{c.sourceCampaign?.name}</i></>}
                        <div className="muted">{c.sender?.fromEmail || 'No sender'}</div>
                      </td>
                      <td>{fmtNum(s.sent)}{s.failed > 0 && <div className="small text-red">{fmtNum(s.failed)} failed</div>}</td>
                      <td>{fmtPct(s.open_rate)}<div className="small muted">{fmtNum(s.opened)}</div></td>
                      <td>{fmtPct(s.click_rate)}<div className="small muted">{fmtNum(s.clicked)}</div></td>
                      <td>{fmtNum(s.unsubscribed)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <button className="btn btn-sm btn-ghost" title="Duplicate" onClick={() => duplicate(c)}><Icon name="copy" /></button>
                          <button className="btn btn-sm btn-ghost btn-danger" title="Delete" onClick={() => remove(c)}><Icon name="trash" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={filter === 'all' ? 'No campaigns yet' : 'Nothing here'} action={filter === 'all' && <button className="btn btn-primary" onClick={openCreate}>Create your first campaign</button>}>
            {filter === 'all' && 'Write once, personalize for every contact, and track each email.'}
          </Empty>
        )}
      </div>

      {creating && (
        <Modal title="New campaign" onClose={() => setCreating(null)} wide
          footer={<><button className="btn" onClick={() => setCreating(null)}>Cancel</button><button className="btn btn-primary" form="new-campaign">Create & edit</button></>}>
          <form id="new-campaign" onSubmit={create}>
            <Field label="Campaign name" hint="Internal only. Recipients never see it."><input type="text" autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="e.g. Diwali sale 2026" /></Field>
            <span className="label-text">Start from</span>
            <div className="template-pick">
              <button type="button" className={`tpl-card ${!creating.template ? 'on' : ''}`} onClick={() => setCreating({ ...creating, template: '' })}>
                <div className="tpl-thumb blank"><Icon name="edit" size={22} /></div><b>Basic layout</b>
              </button>
              {templates.map((t) => (
                <button type="button" key={t._id} className={`tpl-card ${creating.template === t._id ? 'on' : ''}`} onClick={() => setCreating({ ...creating, template: t._id })}>
                  <iframe className="tpl-thumb" title={t.name} srcDoc={t.html} tabIndex={-1} sandbox="" />
                  <b className="truncate">{t.name}</b>{!t.builtIn && <span className="small muted">Saved</span>}
                </button>
              ))}
            </div>
          </form>
        </Modal>
      )}
      {dialog}
    </>
  );
}
