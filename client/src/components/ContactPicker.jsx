import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Spinner, useDebounced } from './ui';

const label = (c) => [c.firstName, c.lastName].filter(Boolean).join(' ');

/** Search subscribed contacts and pick some as campaign recipients. value: [{ _id, email, firstName, lastName }]. */
export default function ContactPicker({ value, onChange }) {
  const { businessId } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const query = useDebounced(q.trim(), 300);

  useEffect(() => {
    if (!query) return setRows(null);
    let live = true;
    api.get(`/businesses/${businessId}/contacts?status=subscribed&per=8&q=${encodeURIComponent(query)}`)
      .then((d) => live && setRows(d.rows)).catch(() => live && setRows([]));
    return () => { live = false; };
  }, [query, businessId]);

  const picked = new Set(value.map((c) => c._id));
  const add = (c) => { onChange([...value, { _id: c._id, email: c.email, firstName: c.firstName, lastName: c.lastName }]); setQ(''); };
  const remove = (id) => onChange(value.filter((c) => c._id !== id));

  return (
    <div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by email, name or company…" />
      {query && (
        <ul className="upload-list" style={{ marginTop: 6 }}>
          {rows === null ? <li><Spinner /></li>
            : !rows.length ? <li className="muted">No subscribed contacts match “{query}”</li>
            : rows.map((c) => (
              <li key={c._id}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.email}{label(c) && <span className="muted"> · {label(c)}</span>}</span>
                {picked.has(c._id)
                  ? <span className="muted small"><Icon name="check" size={14} /> Added</span>
                  : <button type="button" className="btn btn-sm" onClick={() => add(c)}><Icon name="plus" size={14} />Add</button>}
              </li>
            ))}
        </ul>
      )}
      <div className="chips" style={{ marginTop: 10 }}>
        {value.map((c) => (
          <span key={c._id} className="chip-check on" title={label(c)}>
            {c.email}
            <button type="button" onClick={() => remove(c._id)} aria-label={`Remove ${c.email}`} style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', display: 'inline-flex' }}><Icon name="x" size={14} /></button>
          </span>
        ))}
        {!value.length && <span className="muted small">No contacts picked yet</span>}
      </div>
    </div>
  );
}
