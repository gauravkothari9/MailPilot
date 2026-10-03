import { Link } from 'react-router-dom';
import { Icon, EVENT_META, timeAgo, fmtDate, Badge } from './ui';

export default function EventFeed({ events, showCampaign = true, onSelect }) {
  if (!events?.length) return <div className="empty small">No activity yet. Sends, opens, clicks and unsubscribes appear here live.</div>;
  return (
    <ul className="feed">
      {events.map((e) => {
        const meta = EVENT_META[e.type] || { icon: 'activity', label: e.type };
        return (
          <li key={e._id} className={onSelect ? 'clickable' : ''} onClick={onSelect ? () => onSelect(e) : undefined}>
            <span className={`ic ${e.type}`}><Icon name={meta.icon} /></span>
            <div className="body">
              <div className="truncate">
                <b>{e.email}</b> <span className="muted">{meta.label.toLowerCase()}</span>
                {e.bot && <> <Badge><Icon name="bot" size={11} /> bot</Badge></>}
              </div>
              <div className="small muted truncate">
                {e.type === 'click' && e.url && <span title={e.url}>{e.url} · </span>}
                {e.type === 'failed' && e.url && <span className="text-red">{e.url} · </span>}
                {showCampaign && e.campaign?.name && <Link to={`/campaigns/${e.campaign._id}`} onClick={(ev) => ev.stopPropagation()}>{e.campaign.name}</Link>}
              </div>
            </div>
            <span className="time" title={fmtDate(e.createdAt)}>{timeAgo(e.createdAt)}</span>
          </li>
        );
      })}
    </ul>
  );
}
