'use client';

import { useState } from 'react';
import s from './charts.module.css';

/**
 * Four small charts, drawn as plain SVG/HTML (no chart library to download).
 * Colours: one teal for single-series charts; the 4 category colours below were checked with the
 * dataviz palette validator (light surface: lightness, colour-blind separation, contrast all pass).
 * Every chart also shows its numbers as text, so colour is never the only way to read it.
 */
export const CATEGORY_COLORS = ['#0f9e8e', '#3b6fd6', '#c77a12', '#8a5cd6'];

/** Vertical columns over time (e.g. visits per day). Hover a column for its exact value. */
export function Columns({ data, format = String, height = 170, label }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const shown = hover != null ? data[hover] : null;
  const every = Math.ceil(data.length / 10); // at most ~10 labels under the axis
  return (
    <figure className={s.columns} aria-label={label}>
      <div className={s.readout} aria-live="polite">
        {shown ? (
          <>
            <strong>{format(shown.value)}</strong> {shown.title ?? shown.label}
          </>
        ) : (
          <span>&nbsp;</span>
        )}
      </div>
      <div className={s.plot} style={{ height }} onMouseLeave={() => setHover(null)}>
        <span className={s.maxLine}>{format(max)}</span>
        {data.map((d, i) => (
          <button
            key={d.key}
            type="button"
            className={s.col}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            aria-label={`${d.title ?? d.label}: ${format(d.value)}`}
          >
            <span className={s.bar} style={{ height: `${(d.value / max) * 100}%` }} data-on={hover === i || undefined} />
          </button>
        ))}
      </div>
      <div className={s.axis}>
        {data.map((d, i) => (
          <span key={d.key}>{i % every === 0 ? d.label : ''}</span>
        ))}
      </div>
    </figure>
  );
}

/** Horizontal bars with the label and value written next to each bar. */
export function HBars({ data, format = String, color = CATEGORY_COLORS[0] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className={s.hbars}>
      {data.map((d) => (
        <li key={d.key}>
          <span className={s.hLabel}>{d.label}</span>
          <span className={s.hTrack}>
            <span style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </span>
          <span className={s.hValue}>{d.display ?? format(d.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ring of parts (≤ 4 + "other"), with a legend that names every part and its value. */
export function Donut({ parts, center, sub, format = String }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className={s.donut}>
      <svg viewBox="0 0 100 100" role="img" aria-label={parts.map((p) => `${p.label}: ${format(p.value)}`).join(', ')}>
        <circle cx="50" cy="50" r={r} className={s.ringBg} />
        {total > 0 &&
          parts.map((p, i) => {
            const length = (p.value / total) * c;
            const gap = parts.filter((x) => x.value > 0).length > 1 ? 1.2 : 0; // a thin surface gap between parts
            const el = (
              <circle
                key={p.key}
                cx="50"
                cy="50"
                r={r}
                className={s.ring}
                stroke={p.color ?? CATEGORY_COLORS[i] ?? '#8696ac'}
                strokeDasharray={`${Math.max(0, length - gap)} ${c}`}
                strokeDashoffset={-offset}
              >
                <title>{`${p.label}: ${format(p.value)}`}</title>
              </circle>
            );
            offset += length;
            return el;
          })}
        <text x="50" y="49" className={s.center}>
          {center}
        </text>
        {sub && (
          <text x="50" y="62" className={s.centerSub}>
            {sub}
          </text>
        )}
      </svg>
      <ul className={s.legend}>
        {parts.map((p, i) => (
          <li key={p.key}>
            <span className={s.swatch} style={{ background: p.color ?? CATEGORY_COLORS[i] ?? '#8696ac' }} />
            <span>{p.label}</span>
            <strong>{format(p.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Busy days × hours. Darker teal = more visits; each cell shows its count on hover/focus. */
export function Heatmap({ cells, dayLabels, hours, format = String, emptyLabel }) {
  const counts = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c.visits]));
  const max = Math.max(1, ...cells.map((c) => c.visits));
  return (
    <div className={s.heatWrap}>
      <table className={s.heat}>
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dayLabels.map(([weekday, name]) => (
            <tr key={weekday}>
              <th scope="row">{name}</th>
              {hours.map((h) => {
                const v = counts.get(`${weekday}-${h}`) ?? 0;
                return (
                  <td key={h} title={`${name} ${h}:00 · ${v ? format(v) : emptyLabel}`}>
                    <span style={{ opacity: v ? 0.18 + 0.82 * (v / max) : 0 }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
