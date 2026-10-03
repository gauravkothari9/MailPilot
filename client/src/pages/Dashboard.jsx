import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs, tz } from '../api';
import { useApp } from '../context';
import { Kpi, Loading, fmtNum, fmtPct, StatusBadge, Icon, usePoll, Empty } from '../components/ui';
import { TrendChart, Legend, Heatmap, SERIES } from '../components/charts';
import EventFeed from '../components/EventFeed';

const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shortDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function Dashboard() {
  const { businessId, business, toast } = useApp();
  const navigate = useNavigate();
  const [scope, setScope] = useState('business');
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState(null);

  const load = useCallback(() => {
    api.get(`/overview${qs({ business: scope === 'business' ? businessId : undefined, tz })}`).then(setData).catch((e) => toast(e.message, 'error'));
  }, [scope, businessId, toast]);

  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { api.get('/settings').then(setSettings).catch(() => {}); }, []);
  usePoll(load, 10000, true);

  if (!data) return <Loading />;
  const { totals: t, counts } = data;

  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 29 + i);
    return localDay(d);
  });
  const series = days.map((key) => {
    const row = { key, sent: 0, open: 0, click: 0 };
    data.daily.forEach((d) => { if (d.day === key && row[d.type] !== undefined) row[d.type] = d.n; });
    return row;
  });

  const localUrl = settings && /localhost|127\.0\.0\.1/.test(settings.public_url);
  const steps = [
    { done: counts.senders > 0, label: 'Connect a sender email', to: '/senders' },
    { done: counts.contacts > 0, label: 'Import contacts from Excel', to: '/contacts?import=1' },
    { done: counts.campaigns > 0, label: 'Create your first campaign', to: '/campaigns' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{scope === 'business' ? business?.name : 'All businesses'} · last 30 days of tracking, updated live</p>
        </div>
        <div className="seg">
          <button className={scope === 'business' ? 'active' : ''} onClick={() => setScope('business')}>This business</button>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All businesses</button>
        </div>
      </div>

      {localUrl && (
        <div className="alert warn">
          <Icon name="alert" size={18} />
          <div><b>Open & click tracking won't work for real recipients yet.</b> Your tracking address is <code>{settings.public_url}</code>, which only your computer can reach.
            {' '}<Link to="/settings">Set a public URL</Link> once the app is deployed (or use a tunnel like ngrok while testing).</div>
        </div>
      )}

      {steps.some((s) => !s.done) && scope === 'business' && (
        <div className="card card-pad onboarding">
          <h2>Get {business?.name} ready to send</h2>
          <div className="steps-list">
            {steps.map((s, i) => (
              <Link key={s.label} to={s.to} className={`step ${s.done ? 'done' : ''}`}>
                <span className="step-num">{s.done ? <Icon name="check" size={14} /> : i + 1}</span>{s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="kpis">
        <Kpi label="Emails delivered" value={fmtNum(t.sent)} sub={`${fmtNum(t.queued)} queued · ${fmtNum(t.failed)} failed`} dot={SERIES.sent.color} />
        <Kpi label="Open rate" value={fmtPct(t.open_rate)} sub={`${fmtNum(t.opened)} people · ${fmtNum(t.opens)} total opens`} dot={SERIES.open.color} />
        <Kpi label="Click rate" value={fmtPct(t.click_rate)} sub={`${fmtNum(t.clicked)} people · ${fmtPct(t.click_to_open)} of openers`} dot={SERIES.click.color} />
        <Kpi label="Unsubscribe rate" value={fmtPct(t.unsub_rate)} sub={`${fmtNum(t.unsubscribed)} unsubscribed`} />
        <Kpi label="Contacts" value={fmtNum(counts.contacts)} sub={`${fmtNum(counts.unsubscribed)} opted out · ${fmtNum(counts.senders)} senders`} />
      </div>

      <div className="grid g-main">
        <div className="card">
          <div className="card-head"><h2>Engagement over time</h2><Legend /></div>
          <div className="card-pad"><TrendChart data={series} xFormat={shortDay} /></div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Live activity</h2>
            {data.botEvents > 0 && <span className="small muted" title="Security scanners and link prefetchers are excluded from your stats"><Icon name="shield" size={13} /> {fmtNum(data.botEvents)} bot hits filtered</span>}
          </div>
          <div className="feed-scroll"><EventFeed events={data.recent} /></div>
        </div>
      </div>

      <div className="grid g-main" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card-head"><h2>Recent campaigns</h2><Link to="/campaigns" className="small">View all</Link></div>
          {data.recentCampaigns.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Campaign</th><th>Status</th><th>Delivered</th><th>Opened</th><th>Clicked</th></tr></thead>
                <tbody>
                  {data.recentCampaigns.map((c) => (
                    <tr key={c._id} className="clickable" onClick={() => navigate(c.status === 'draft' ? `/campaigns/${c._id}/edit` : `/campaigns/${c._id}`)}>
                      <td>
                        <div className="strong">{c.name}</div>
                        {scope === 'all' && <div className="small muted"><span className="dot" style={{ background: c.business?.color }} /> {c.business?.name}</div>}
                      </td>
                      <td><StatusBadge status={c.status} /></td>
                      <td>{fmtNum(c.stats.sent)}</td>
                      <td>{fmtPct(c.stats.open_rate)}</td>
                      <td>{fmtPct(c.stats.click_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No campaigns yet" action={<Link className="btn btn-primary" to="/campaigns">Create a campaign</Link>} />}
        </div>
        <div className="card">
          <div className="card-head"><h2>Best time to send</h2></div>
          <div className="card-pad"><Heatmap cells={data.heatmap} /></div>
        </div>
      </div>
    </>
  );
}
