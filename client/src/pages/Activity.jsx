import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../api';
import { useApp } from '../context';
import { Loading, Pager, SearchInput, useDebounced, usePoll, fmtNum } from '../components/ui';
import EventFeed from '../components/EventFeed';

export default function Activity() {
  const { businessId, business, toast } = useApp();
  const [type, setType] = useState('');
  const [campaign, setCampaign] = useState('');
  const [bots, setBots] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [live, setLive] = useState(true);
  const dq = useDebounced(q);

  const load = useCallback(() => api.get(`/businesses/${businessId}/activity${qs({ type, campaign, q: dq, bots, page })}`).then(setData).catch((e) => toast(e.message, 'error')),
    [businessId, type, campaign, dq, bots, page, toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { api.get(`/businesses/${businessId}/campaigns`).then(setCampaigns).catch(() => {}); }, [businessId]);
  usePoll(load, 4000, live && page === 1);

  const reset = (fn) => (e) => { fn(e.target.value); setPage(1); };

  return (
    <>
      <div className="page-head">
        <div><h1>Live activity</h1><p>Every delivery, open, click, unsubscribe and failure for {business?.name}.</p></div>
        <label className="check"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /><span className="live-dot" /> Auto-refresh</label>
      </div>
      <div className="card">
        <div className="card-head">
          <div className="row">
            <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search email…" />
            <select style={{ width: 'auto' }} value={type} onChange={reset(setType)}>
              <option value="">All events</option>
              <option value="sent">Delivered</option>
              <option value="open">Opens</option>
              <option value="click">Clicks</option>
              <option value="unsubscribe">Unsubscribes</option>
              <option value="failed">Failures</option>
            </select>
            <select style={{ width: 'auto' }} value={campaign} onChange={reset(setCampaign)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
            <select style={{ width: 'auto' }} value={bots} onChange={reset(setBots)}>
              <option value="">Humans only</option>
              <option value="include">Include bot hits</option>
              <option value="only">Bot hits only</option>
            </select>
          </div>
          {data && <span className="small muted">{fmtNum(data.total)} events</span>}
        </div>
        {!data ? <Loading /> : (
          <>
            <EventFeed events={data.rows} />
            <Pager page={data.page} per={data.per} total={data.total} onPage={setPage} />
          </>
        )}
      </div>
    </>
  );
}
