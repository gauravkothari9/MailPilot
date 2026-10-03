import { Icon } from './ui';

const OPS = [
  ['equals', 'is'], ['not_equals', 'is not'], ['contains', 'contains'], ['not_contains', 'does not contain'],
  ['starts_with', 'starts with'], ['ends_with', 'ends with'], ['not_empty', 'is filled in'], ['empty', 'is empty'],
];
const TAG_OPS = [['has', 'has tag'], ['not_has', 'does not have tag']];
const BASE = [['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['company', 'Company'], ['phone', 'Phone']];

/** Edits campaign.rules: [{ field, op, value }] — all rules must match (AND). */
export default function SegmentBuilder({ rules, onChange, fields, tags, disabled }) {
  const update = (i, patch) => onChange(rules.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, ...patch };
    if (patch.field) next.op = patch.field === 'tags' ? 'has' : r.field === 'tags' ? 'equals' : r.op;
    return next;
  }));

  return (
    <div className="segment">
      {rules.map((r, i) => {
        const isTag = r.field === 'tags';
        const ops = isTag ? TAG_OPS : OPS;
        return (
          <div key={i} className="seg-rule">
            <span className="small muted seg-and">{i === 0 ? 'Only if' : 'and'}</span>
            <select value={r.field} onChange={(e) => update(i, { field: e.target.value })} disabled={disabled}>
              <optgroup label="Contact">{BASE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</optgroup>
              <option value="tags">Tag</option>
              {fields.length > 0 && <optgroup label="From your Excel">{fields.map((f) => <option key={f.field} value={f.field}>{f.field}</option>)}</optgroup>}
            </select>
            <select value={r.op} onChange={(e) => update(i, { op: e.target.value })} disabled={disabled}>
              {ops.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {!['empty', 'not_empty'].includes(r.op) && (
              isTag
                ? <select value={r.value} onChange={(e) => update(i, { value: e.target.value })} disabled={disabled}>
                    <option value="">Choose tag…</option>
                    {tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag}</option>)}
                  </select>
                : <input type="text" value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" disabled={disabled} />
            )}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(rules.filter((_, j) => j !== i))} aria-label="Remove rule" disabled={disabled}>×</button>
          </div>
        );
      })}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...rules, { field: fields[0]?.field || 'company', op: 'equals', value: '' }])} disabled={disabled}>
        <Icon name="filter" />Add filter
      </button>
    </div>
  );
}
