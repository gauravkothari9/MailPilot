import { useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { fmtNum } from './ui';

// Categorical slots 1–3 of the validated reference palette (adjacent CVD ΔE ≥ 9).
export const SERIES = {
  sent: { color: '#2a78d6', label: 'Delivered' },
  open: { color: '#eb6834', label: 'Opens' },
  click: { color: '#1baf7a', label: 'Clicks' },
};

function ChartTooltip({ active, payload, label, labelFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{labelFormat ? labelFormat(label) : label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tip-row">
          <span className="swatch-line" style={{ background: p.color }} />
          <span>{SERIES[p.dataKey]?.label || p.name}</span>
          <b>{fmtNum(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ keys = ['sent', 'open', 'click'] }) {
  return (
    <div className="legend">
      {keys.map((k) => <span key={k}><i className="swatch-line" style={{ background: SERIES[k].color }} />{SERIES[k].label}</span>)}
    </div>
  );
}

/** Rows [{ key, sent, open, click }], one line per series on a single shared axis. */
export function TrendChart({ data, xFormat, labelFormat, height = 240 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="key" tickFormatter={xFormat} tick={{ fill: 'var(--faint)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} minTickGap={24} />
          <YAxis allowDecimals={false} tick={{ fill: 'var(--faint)', fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip content={<ChartTooltip labelFormat={labelFormat || xFormat} />} cursor={{ stroke: 'var(--faint)', strokeDasharray: '3 3' }} />
          {Object.entries(SERIES).map(([k, s]) => (
            <Line key={k} type="monotone" dataKey={k} stroke={s.color} strokeWidth={2} dot={false}
              activeDot={{ r: 4.5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Single-hue sequential ramp (blue), light → dark.
const RAMP = ['#eef4fc', '#cfe0f6', '#a6c6ee', '#78a8e4', '#4f8cdb', '#2a78d6', '#1d5eaf', '#154887'];
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

/** Opens by weekday × hour, plus the single best slot called out as text. */
export function Heatmap({ cells }) {
  const [hover, setHover] = useState(null);
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  (cells || []).forEach((c) => { grid[c.day][c.hour] = c.n; });
  const max = Math.max(0, ...grid.flat());
  if (!max) return <div className="empty small">Not enough opens yet. The best-time map fills in as people open your emails.</div>;
  let best = { d: 0, h: 0, n: 0 };
  grid.forEach((row, d) => row.forEach((n, h) => { if (n > best.n) best = { d, h, n }; }));
  const color = (n) => (n ? RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(((n / max) * (RAMP.length - 2)) + 0.0001))] : 'var(--surface-2)');

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-best">Best time to send: <b>{['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][best.d]} around {hourLabel(best.h)}</b> ({fmtNum(best.n)} opens)</div>
      <div className="heatmap" role="table" aria-label="Opens by weekday and hour">
        <div />
        {Array.from({ length: 24 }, (_, h) => <div key={h} className="hm-hour">{h % 3 === 0 ? hourLabel(h) : ''}</div>)}
        {grid.map((row, d) => [
          <div key={`d${d}`} className="hm-day">{DAYS[d]}</div>,
          ...row.map((n, h) => (
            <div key={`${d}-${h}`} className="hm-cell" style={{ background: color(n) }} role="cell" aria-label={`${DAYS[d]} ${hourLabel(h)}: ${n} opens`}
              onMouseEnter={() => setHover({ d, h, n })} onMouseLeave={() => setHover(null)} />
          )),
        ])}
      </div>
      <div className="hm-foot">
        <span className="muted small">{hover ? `${DAYS[hover.d]} ${hourLabel(hover.h)}: ${fmtNum(hover.n)} opens` : 'Hover a cell for details'}</span>
        <span className="hm-scale"><span className="muted small">Fewer</span>{RAMP.slice(1).map((c) => <i key={c} style={{ background: c }} />)}<span className="muted small">More</span></span>
      </div>
    </div>
  );
}

/** Horizontal rate bars, e.g. A vs B open rate. Values are percentages. */
export function RateBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="mini-bars">
      {rows.map((r) => (
        <div key={r.label} className="mini-bar">
          <span className="truncate">{r.label}</span>
          <div className="progress"><span style={{ width: `${(100 * r.value) / max}%`, background: r.color || 'var(--primary)' }} /></div>
          <b className="nowrap" style={{ textAlign: 'right' }}>{r.display ?? `${r.value}%`}</b>
        </div>
      ))}
    </div>
  );
}
