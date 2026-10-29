'use client';

import { useEffect, useId, useRef } from 'react';
import { initials } from '@/components/site/AccountMenu';
import { useDash } from './DashProvider';
import s from './kit.module.css';

/**
 * The dashboard's small building blocks. Every screen is made from these, so all screens look and
 * behave the same (one place to change a button for all of them).
 */

const cx = (...names) => names.filter(Boolean).join(' ');

export function Button({ kind = 'default', size, busy, className, children, ...props }) {
  return (
    <button type="button" className={cx(s.btn, s[kind], size === 'sm' && s.sm, className)} disabled={busy || props.disabled} {...props}>
      {busy && <span className={s.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** A write action: hidden behind a "read-only" lock for the demo viewer. */
export function WriteButton(props) {
  const { can, w } = useDash();
  if (can.write) return <Button {...props} />;
  return (
    <Button {...props} disabled title={w.common.readOnly} onClick={undefined}>
      {props.children}
    </Button>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <header className={s.pageHead}>
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className={s.actions}>{children}</div>}
    </header>
  );
}

export function Card({ title, action, children, className, flush }) {
  return (
    <section className={cx(s.card, flush && s.flush, className)}>
      {(title || action) && (
        <div className={s.cardHead}>
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** A number with a label; `delta` (e.g. +0.12) shows ↑12% / ↓8% against the previous period. */
export function Stat({ label, value, hint, delta, invert = false, tone }) {
  const { fmt } = useDash();
  const good = delta == null ? null : invert ? delta < 0 : delta > 0;
  return (
    <div className={cx(s.stat, tone && s[`tone_${tone}`])}>
      <p className={s.statLabel}>{label}</p>
      <p className={s.statValue}>{value}</p>
      {(hint || delta != null) && (
        <p className={s.statHint}>
          {delta != null && Number.isFinite(delta) && (
            <span className={good ? s.up : s.down}>
              {delta >= 0 ? '↑' : '↓'} {fmt.percent(Math.abs(delta))}
            </span>
          )}{' '}
          {hint}
        </p>
      )}
    </div>
  );
}

const STATUS_TONE = {
  booked: 'blue',
  completed: 'mint',
  cancelled: 'gray',
  no_show: 'red',
  active: 'mint',
  handed_off: 'violet',
  needs_attention: 'red',
  closed: 'gray',
  open: 'amber',
  resolved: 'mint',
  pending: 'gray',
  processing: 'blue',
  ready: 'mint',
  failed: 'red',
  queued: 'gray',
  sent: 'mint',
  ignored: 'gray',
  urgent: 'red',
  high: 'amber',
  normal: 'blue',
  low: 'gray',
};

export function Badge({ tone = 'gray', children, dot }) {
  return (
    <span className={cx(s.badge, s[`tone_${tone}`])}>
      {dot && <span className={s.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }) {
  const { w } = useDash();
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{label ?? w.status[status] ?? status}</Badge>;
}

export function LiveDot({ label }) {
  return (
    <span className={s.live} title={label}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

export function Avatar({ name, size = 34, photo }) {
  return (
    <span className={s.avatar} style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- photo links are typed in by the owner and can be on any host; next/image would need every host listed in next.config */}
      {photo ? <img src={photo} alt="" /> : initials(name ?? '') || '·'}
    </span>
  );
}

export function Skeleton({ rows = 3, height = 44 }) {
  return (
    <div className={s.skeletons} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} style={{ height }} />
      ))}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className={s.empty}>
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path d="M10 30l6-16h16l6 16v8H10z M10 30h9l2 4h6l2-4h9" />
      </svg>
      <p>{title}</p>
      {children}
    </div>
  );
}

export function ErrorNote({ error, onRetry }) {
  const { w } = useDash();
  if (!error) return null;
  return (
    <div className={s.errorNote} role="alert">
      <p>{error.status === 403 ? w.common.forbidden : (error.message ?? w.common.error)}</p>
      {onRetry && error.status !== 403 && (
        <Button size="sm" onClick={onRetry}>
          {w.common.retry}
        </Button>
      )}
    </div>
  );
}

/** Loading → skeleton, failed → error with "try again", empty → message, else the content. */
export function Loaded({ state, empty, emptyText, rows, children }) {
  const { w } = useDash();
  if (state.error) return <ErrorNote error={state.error} onRetry={state.reload} />;
  if (state.loading || state.data == null) return <Skeleton rows={rows} />;
  if (empty) return <Empty title={emptyText ?? w.common.noData} />;
  return children;
}

// ---------- forms ----------

export function Field({ label, hint, error, children, wide }) {
  const id = useId();
  const child = typeof children === 'function' ? children(id) : children;
  return (
    <div className={cx(s.field, wide && s.wide)}>
      <label htmlFor={id}>{label}</label>
      {typeof children === 'function' ? child : <div id={id}>{child}</div>}
      {hint && !error && <small>{hint}</small>}
      {error && <small className={s.fieldError}>{error}</small>}
    </div>
  );
}

/** <TextField label="Name" value onChange /> — onChange gets the text, not the event. */
export function TextField({ label, hint, error, wide, onChange, multiline, ...input }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <Field label={label} hint={hint} error={error} wide={wide}>
      {(id) => <Tag id={id} className={s.input} rows={multiline ? 4 : undefined} {...input} value={input.value ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function SelectField({ label, hint, wide, value, onChange, options, ...rest }) {
  return (
    <Field label={label} hint={hint} wide={wide}>
      {(id) => (
        <select id={id} className={s.input} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
          {options.map(([v, text]) => (
            <option key={v} value={v}>
              {text}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={cx(s.toggle, disabled && s.disabled)}>
      <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true" />
      {label}
    </label>
  );
}

export function FormGrid({ children }) {
  return <div className={s.formGrid}>{children}</div>;
}

/** Filter pills: options = [[value, label, count?], …]. */
export function Segmented({ value, onChange, options, label }) {
  return (
    <div className={s.segmented} role="tablist" aria-label={label}>
      {options.map(([v, text, count]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>
          {text}
          {count != null && <span className={s.count}>{count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder, autoFocus }) {
  return (
    <label className={s.search}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4 4" />
      </svg>
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- table ----------

/**
 * columns: [{ key, label, render?(row), align?, width?, hide? ('sm' = hidden on phones) }]
 * onRow(row) makes rows clickable (and keyboard-reachable).
 */
export function Table({ columns, rows, onRow, rowKey = (r) => r.id, selected }) {
  return (
    <div className={s.tableWrap}>
      <table className={s.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align }} className={c.hide === 'sm' ? s.hideSm : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cx(onRow && s.clickable, selected === rowKey(row) && s.selected)}
              onClick={onRow ? () => onRow(row) : undefined}
              onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(row) : undefined}
              tabIndex={onRow ? 0 : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} style={{ textAlign: c.align }} className={c.hide === 'sm' ? s.hideSm : undefined}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- panels ----------

function useEscape(open, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
}

/** A side panel for details and forms. It slides in from the end side (right in English, left in Arabic). */
export function Drawer({ open, title, sub, onClose, children, footer, wide }) {
  const { w } = useDash();
  const panel = useRef(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (open) panel.current?.querySelector('input, textarea, select, button:not([data-close])')?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div className={cx(s.layer, open && s.layerOpen)} aria-hidden={!open} inert={!open}>
      <div className={s.scrim} onClick={onClose} />
      <aside ref={panel} className={cx(s.drawer, wide && s.drawerWide)} role="dialog" aria-modal="true" aria-label={title}>
        <header className={s.drawerHead}>
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" data-close className={s.close} onClick={onClose} aria-label={w.common.close}>
            ×
          </button>
        </header>
        <div className={s.drawerBody}>{open && children}</div>
        {footer && open && <footer className={s.drawerFoot}>{footer}</footer>}
      </aside>
    </div>
  );
}

/** "Are you sure?" — a small centred box. */
export function Modal({ open, title, children, onClose, footer }) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className={cx(s.layer, s.layerOpen, s.center)}>
      <div className={s.scrim} onClick={onClose} />
      <div className={s.modal} role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {footer && <div className={s.modalFoot}>{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, text, confirmLabel, danger, busy, onConfirm, onClose }) {
  const { w } = useDash();
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{w.common.cancel}</Button>
          <Button kind={danger ? 'danger' : 'primary'} busy={busy} onClick={onConfirm}>
            {confirmLabel ?? w.common.confirm}
          </Button>
        </>
      }
    >
      {text && <p className={s.modalText}>{text}</p>}
    </Modal>
  );
}

/** Label / value pairs in a panel. items: [[label, value], …] (empty values are skipped). */
export function Facts({ items }) {
  return (
    <dl className={s.facts}>
      {items
        .filter(([, value]) => value != null && value !== '')
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Notice({ tone = 'info', children }) {
  return <p className={cx(s.notice, s[`notice_${tone}`])}>{children}</p>;
}

export function Icon({ name, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={s.icon} aria-hidden="true">
      <path d={ICONS[name] ?? ''} />
    </svg>
  );
}

export const ICONS = {
  overview: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  today: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  appointments: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  patients: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  inbox: 'M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z',
  conversations: 'M4 5h16v11H9l-5 4z M8 9h8M8 12h5',
  timeOff: 'M12 3v2M12 19v2M5 12H3M21 12h-2M7 7 5.6 5.6M18.4 18.4 17 17M7 17l-1.4 1.4M18.4 5.6 17 7M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  doctors: 'M9 3v5a3 3 0 0 0 6 0V3M12 11v4a4 4 0 0 0 8 0v-2M20 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  services: 'M7 4c-2 0-3 2-3 4 0 4 2 12 4 12s2-5 4-5 2 5 4 5 4-8 4-12c0-2-1-4-3-4s-3 1-5 1-3-1-5-1Z',
  knowledge: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  assistant: 'M12 3v3M7 9h10a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3ZM9 14h.01M15 14h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  website: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18',
  out: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  tool: 'M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2Z',
  send: 'M4 12l16-8-6 16-3-7z',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  mail: 'M3 6h18v12H3zM3 6l9 7 9-7',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
};
