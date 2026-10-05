import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs, tz } from '../api';
import { useApp } from '../context';
import {
  Icon, Loading, Kpi, StatusBadge, Tabs, Pager, SearchInput, Modal, Badge, Progress, Empty,
  fmtNum, fmtPct, fmtDate, timeAgo, fullName, usePoll, useDebounced, useConfirm, EVENT_META,
} from '../components/ui';
import { TrendChart, Legend, Heatmap, RateBars, SERIES } from '../components/charts';
import EventFeed from '../components/EventFeed';

const hourLabel = (b) => new Date(b).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });

function MessageModal({ id, onClose }) {
  const [m, setM] = useState(null);
  useEffect(() => { api.get(`/messages/${id}`).then(setM); }, [id]);
  return (
    <Modal title={m ? m.email : 'Email'} onClose={onClose}>
      {!m ? <Loading /> : (
        <>
          <dl className="kv" style={{ marginBottom: 16 }}>
            <dt>Name</dt><dd>{fullName(m.contact) || '—'}</dd>
            <dt>Status</dt><dd><StatusBadge status={m.status} />{m.variant && <> <Badge color="violet">Subject {m.variant}</Badge></>}</dd>
            {m.error && <><dt>Error</dt><dd className="text-red small">{m.error}</dd></>}
            <dt>Delivered</dt><dd>{fmtDate(m.sentAt)}</dd>
            <dt>Opens</dt><dd>{m.openCount} {m.openedAt && <span className="muted small">· first {fmtDate(m.openedAt)}</span>}</dd>
            <dt>Clicks</dt><dd>{m.clickCount} {m.clickedAt && <span className="muted small">· first {fmtDate(m.clickedAt)}</span>}</dd>
            {m.unsubscribedAt && <><dt>Unsubscribed</dt><dd>{fmtDate(m.unsubscribedAt)}</dd></>}
          </dl>
          <h3 className="section-title">Timeline</h3>
          {m.events.length ? (
            <ul className="timeline">
              {m.events.map((e) => (
                <li key={e._id} className={e.type}>
                  <b>{EVENT_META[e.type]?.label}</b>{e.bot && <> <Badge><Icon name="bot" size={11} /> bot, not counted</Badge></>}
                  <div className="small muted">{fmtDate(e.createdAt)}{e.url ? ` · ${e.url}` : ''}</div>
                  {e.userAgent && <div className="small faint truncate" title={e.userAgent}>{e.userAgent}</div>}
                </li>
              ))}
            </ul>
          ) : <div className="muted small">No events yet.</div>}
        </>
      )}
    </Modal>
  );
}

export default function CampaignReport() {
  const { id } = useParams();
  const { toast } = useApp();
  const navigate = useNavigate();
  const [rep, setRep] = useState(null);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [recips, setRecips] = useState(null);
  const [msg, setMsg] = useState(null);
  const [confirm, dialog] = useConfirm();
  const dq = useDebounced(q);

  const loadReport = useCallback(() => api.get(`/campaigns/${id}/report${qs({ tz })}`).then(setRep).catch((e) => toast(e.message, 'error')), [id, toast]);
  const loadRecips = useCallback(() => api.get(`/campaigns/${id}/recipients${qs({ filter, q: dq, page })}`).then(setRecips).catch(() => {}), [id, filter, dq, page]);
  useEffect(() => { loadReport(); }, [loadReport]);
  useEffect(() => { loadRecips(); }, [loadRecips]);
  const live = !!rep && ['sending', 'testing', 'scheduled'].includes(rep.campaign.status);
  const refresh = useCallback(() => { loadReport(); loadRecips(); }, [loadReport, loadRecips]);
  usePoll(refresh, live ? 3000 : 15000, !!rep);

  if (!rep) return <Loading />;
  const { campaign: c, stats: s } = rep;

  const action = async (path, body, okMsg) => {
    try {
      const r = await api.post(`/campaigns/${id}/${path}`, body);
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'success');
      refresh();
      return r;
    } catch (e) { toast(e.message, 'error'); return null; }
  };
  const stop = async () => {
    if (!(await confirm({ title: c.status === 'scheduled' ? 'Cancel schedule?' : 'Stop sending?', danger: c.status !== 'scheduled', confirmLabel: c.status === 'scheduled' ? 'Back to draft' : 'Stop campaign',
      message: c.status === 'scheduled' ? 'The campaign goes back to draft so you can edit it.' : `${fmtNum(s.queued)} queued emails will not be sent. This can't be undone.` }))) return;
    await action('cancel');
    if (c.status === 'scheduled') navigate(`/campaigns/${id}/edit`);
  };
  const followUp = async (audience) => {
    const r = await action('follow-up', { audience });
    if (r) navigate(`/campaigns/${r._id}/edit`);
  };
  const duplicate = async () => {
    const r = await action('duplicate');
    if (r) navigate(`/campaigns/${r._id}/edit`);
  };

  const done = s.sent + s.failed + s.skipped;
  const timeline = (() => {
    const map = new Map();
    rep.timeline.forEach((t) => {
      if (!map.has(t.bucket)) map.set(t.bucket, { key: t.bucket, sent: 0, open: 0, click: 0 });
      map.get(t.bucket)[t.type] = t.n;
    });
    return [...map.values()];
  })();
  const deviceTotal = Object.values(rep.devices).reduce((a, b) => a + b, 0);
  const v = rep.variants;
  const metricKey = c.abTest?.metric === 'clicks' ? 'clickRate' : 'openRate';

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link to="/campaigns" className="small muted back"><Icon name="arrowLeft" size={14} /> Campaigns</Link>
          <div className="row" style={{ gap: 10 }}><h1 className="truncate">{c.name}</h1><StatusBadge status={c.status} /></div>
          <p className="truncate">
            “{c.subject}” · {c.sender?.fromEmail || 'no sender'} → {c.audience === 'all' ? 'all subscribers' : c.audience === 'list' ? c.list?.name || 'deleted list' : `${c.audience === 'non_openers' ? 'non-openers' : 'non-clickers'} of ${c.sourceCampaign?.name || 'a campaign'}`}
            {c.rules?.length > 0 && ` (${c.rules.length} filter${c.rules.length > 1 ? 's' : ''})`}
          </p>
        </div>
        <div className="row">
          {['sending', 'testing'].includes(c.status) && <button className="btn" onClick={() => action('pause', null, 'Paused')}><Icon name="pause" />Pause</button>}
          {c.status === 'paused' && <Link className="btn" to={`/campaigns/${id}/edit`}><Icon name="edit" />Edit</Link>}
          {c.status === 'paused' && <button className="btn btn-primary" onClick={() => action('resume', null, 'Resumed')}><Icon name="play" />Resume</button>}
          {['sending', 'testing', 'paused', 'scheduled'].includes(c.status) && <button className="btn btn-danger" onClick={stop}>{c.status === 'scheduled' ? 'Cancel schedule' : 'Stop'}</button>}
          {s.failed > 0 && !['sending', 'testing'].includes(c.status) && <button className="btn" onClick={() => action('retry-failed', null, (r) => `${r.requeued} emails queued again`)}><Icon name="refresh" />Retry {fmtNum(s.failed)} failed</button>}
          {c.status === 'sent' && (
            <div className="dropdown">
              <button className="btn btn-primary"><Icon name="send" />Follow up</button>
              <div className="dropdown-menu">
                <button onClick={() => followUp('non_openers')}>Resend to {fmtNum(s.sent - s.opened)} non-openers</button>
                <button onClick={() => followUp('non_clickers')}>Follow up with {fmtNum(s.sent - s.clicked)} non-clickers</button>
              </div>
            </div>
          )}
          <button className="btn btn-ghost" title="Duplicate" onClick={duplicate}><Icon name="copy" /></button>
        </div>
      </div>

      {c.status === 'scheduled' && <div className="alert info"><Icon name="clock" size={16} />Scheduled to send on <b>{fmtDate(c.scheduledAt)}</b>. Recipients are picked at that moment, so contacts you add before then are included.</div>}
      {c.note === 'daily-limit' && <div className="alert warn"><Icon name="clock" size={16} />Daily sending limit reached for {c.sender?.fromEmail}. Sending resumes automatically tomorrow.</div>}
      {c.note === 'ab-waiting' && <div className="alert info"><Icon name="split" size={16} />A/B test group sent. The winner is picked automatically at <b>{fmtDate(c.abTest.testEndsAt)}</b> and sent to everyone else.</div>}
      {c.note && !['daily-limit', 'ab-waiting'].includes(c.note) && <div className={`alert ${c.status === 'paused' ? 'warn' : 'info'}`}><Icon name="alert" size={16} />{c.note}{/Sender error/.test(c.note) && <> · <Link to="/senders">Check sender settings</Link></>}</div>}

      {(['sending', 'testing', 'paused'].includes(c.status) || s.queued > 0) && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <b>{fmtNum(done)} of {fmtNum(s.total)} processed</b>
            <span className="small muted">{fmtNum(s.queued)} in queue{live && <> · <span className="live-dot" /> live</>}</span>
          </div>
          <Progress value={s.total ? (100 * done) / s.total : 0} />
        </div>
      )}

      <div className="kpis">
        <Kpi label="Delivered" value={fmtNum(s.sent)} sub={`${fmtPct(s.delivered_rate)} of attempted`} dot={SERIES.sent.color} />
        <Kpi label="Opened" value={fmtPct(s.open_rate)} sub={`${fmtNum(s.opened)} people · ${fmtNum(s.opens)} opens`} dot={SERIES.open.color} />
        <Kpi label="Clicked" value={fmtPct(s.click_rate)} sub={`${fmtNum(s.clicked)} people · ${fmtPct(s.click_to_open)} click-to-open`} dot={SERIES.click.color} />
        <Kpi label="Unsubscribed" value={fmtNum(s.unsubscribed)} sub={fmtPct(s.unsub_rate)} />
        <Kpi label="Failed" value={fmtNum(s.failed)} sub={`${fmtNum(s.skipped)} skipped`} />
        <Kpi label="Bot hits filtered" value={fmtNum(rep.botEvents)} sub="scanners & prefetchers" icon="shield" />
      </div>

      {v && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2><Icon name="split" size={16} /> A/B subject test</h2>
            {c.abTest.winner ? <Badge color="green">Winner: subject {c.abTest.winner}</Badge> : c.status === 'testing' ? <Badge color="violet" pulse>Testing until {fmtDate(c.abTest.testEndsAt)}</Badge> : null}
          </div>
          <div className="card-pad grid g2">
            {['A', 'B'].map((k) => (
              <div key={k} className={`ab-variant ${c.abTest.winner === k ? 'winner' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}><b>Subject {k}</b>{c.abTest.winner === k && <Badge color="green">🏆 Winner</Badge>}</div>
                <div className="ab-subject">{k === 'A' ? c.subject : c.abTest.subjectB}</div>
                <RateBars rows={[
                  { label: 'Open rate', value: v[k].openRate, color: SERIES.open.color },
                  { label: 'Click rate', value: v[k].clickRate, color: SERIES.click.color },
                ]} />
                <div className="small muted" style={{ marginTop: 8 }}>{fmtNum(v[k].sent)} sent · {fmtNum(v[k].opened)} opened · {fmtNum(v[k].clicked)} clicked</div>
                {c.status === 'testing' && !c.abTest.winner && (
                  <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => action('ab-winner', { winner: k }, `Subject ${k} is now being sent to everyone else`)}>Pick {k} now</button>
                )}
              </div>
            ))}
          </div>
          <div className="small muted" style={{ padding: '0 20px 16px' }}>Winner chosen by {c.abTest.metric === 'clicks' ? 'click' : 'open'} rate in the test group. Current leader: subject {v.B[metricKey] > v.A[metricKey] ? 'B' : 'A'}.</div>
        </div>
      )}

      <div className="grid g-main">
        <div className="card">
          <div className="card-head"><h2>Engagement by hour</h2><Legend /></div>
          <div className="card-pad">{timeline.length ? <TrendChart data={timeline} xFormat={hourLabel} /> : <div className="empty small">Activity shows up here once emails go out.</div>}</div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Live activity</h2></div>
          <div className="feed-scroll"><EventFeed events={rep.recent.filter((e) => !e.bot).slice(0, 30)} showCampaign={false} /></div>
        </div>
      </div>

      <div className="grid g3" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Link clicks</h2></div>
          {rep.links.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Link</th><th>Clicks</th><th>People</th></tr></thead>
                <tbody>{rep.links.map((l) => <tr key={l._id}><td className="truncate" style={{ maxWidth: 220 }}><a href={l.url} target="_blank" rel="noreferrer" title={l.url}>{l.url.replace(/^https?:\/\//, '')}</a></td><td>{fmtNum(l.clicks)}</td><td>{fmtNum(l.uniqueClicks)}</td></tr>)}</tbody>
              </table>
            </div>
          ) : <div className="empty small">No tracked links yet.</div>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Opens by device</h2></div>
          <div className="card-pad">
            {deviceTotal ? <RateBars rows={Object.entries(rep.devices).map(([k, n]) => ({ label: k, value: +((100 * n) / deviceTotal).toFixed(1), display: `${fmtNum(n)}` }))} />
              : <div className="empty small">No opens yet.</div>}
            <p className="small muted" style={{ marginBottom: 0 }}>Gmail loads images through its own proxy, so the device behind those opens is hidden.</p>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>When people opened</h2></div>
          <div className="card-pad"><Heatmap cells={rep.heatmap} /></div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head">
          <h2>Every recipient</h2>
          <div className="row">
            <SearchInput value={q} onChange={(x) => { setQ(x); setPage(1); }} placeholder="Search email…" />
            <a className="btn" href={`/api/campaigns/${id}/recipients/export${qs({ filter, q: dq })}`}><Icon name="download" />Export CSV</a>
          </div>
        </div>
        <Tabs value={filter} onChange={(f) => { setFilter(f); setPage(1); }} tabs={[
          { value: '', label: 'All', count: s.total },
          { value: 'sent', label: 'Delivered', count: s.sent },
          { value: 'opened', label: 'Opened', count: s.opened },
          { value: 'not_opened', label: 'Not opened', count: s.sent - s.opened },
          { value: 'clicked', label: 'Clicked', count: s.clicked },
          { value: 'unsubscribed', label: 'Unsubscribed', count: s.unsubscribed },
          { value: 'failed', label: 'Failed', count: s.failed },
          { value: 'queued', label: 'Queued', count: s.queued },
          { value: 'skipped', label: 'Skipped', count: s.skipped },
        ]} />
        {!recips ? <Loading /> : recips.rows.length ? (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Recipient</th><th>Status</th><th>Delivered</th><th>Opened</th><th>Clicked</th><th>Unsubscribed</th></tr></thead>
                <tbody>
                  {recips.rows.map((r) => (
                    <tr key={r._id} className="clickable" onClick={() => setMsg(r._id)}>
                      <td><div className="strong">{r.email}</div><div className="small muted">{fullName(r.contact)}{r.variant && <> · subject {r.variant}</>}</div></td>
                      <td><StatusBadge status={r.status} />{r.error && <div className="small text-red truncate" style={{ maxWidth: 240 }} title={r.error}>{r.error}</div>}</td>
                      <td className="small">{r.sentAt ? fmtDate(r.sentAt) : '—'}</td>
                      <td className="small">{r.openedAt ? <><Icon name="eye" size={12} /> {r.openCount}× <span className="muted">· {timeAgo(r.openedAt)}</span></> : '—'}</td>
                      <td className="small">{r.clickedAt ? <><Icon name="click" size={12} /> {r.clickCount}× <span className="muted">· {timeAgo(r.clickedAt)}</span></> : '—'}</td>
                      <td className="small">{r.unsubscribedAt ? fmtDate(r.unsubscribedAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={recips.page} per={recips.per} total={recips.total} onPage={setPage} />
          </>
        ) : <Empty title={c.status === 'scheduled' ? 'Recipients are added when sending starts' : 'No recipients in this view'} />}
      </div>

      {msg && <MessageModal id={msg} onClose={() => setMsg(null)} />}
      {dialog}
    </>
  );
}
