'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { intlLocale } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';

/**
 * Everything every dashboard screen needs, in one place (React context):
 *
 *   const { w, locale, can, fmt, pick, say, api, toast } = useDash();
 *   w        the words for this language (i18n/dash/en.json or ar.json)
 *   can      what the signed-in person may do: { write, owner, ownerArea, viewer }
 *   fmt      dates, times, money, numbers and percentages, in the clinic's timezone
 *   pick     a record's field in the page language: pick(service, 'name') → name_ar or name_en
 *   say      fills {placeholders}: say(w.today.hello, { name: 'Sara' })
 *   api      the signed-in API call from SessionProvider
 *   toast    a small "Saved ✓" message in the corner: toast(text) or toast(text, 'error')
 *
 * The real lock is still the backend: every endpoint checks the role again.
 */
export const CLINIC_TZ = 'Africa/Cairo';

const DashContext = createContext(null);

export function useDash() {
  const value = useContext(DashContext);
  if (!value) throw new Error('useDash must be used inside <DashProvider>.');
  return value;
}

export default function DashProvider({ words, locale, children }) {
  const { user, api } = useSession();
  const [toasts, setToasts] = useState([]);
  const nextToast = useRef(1);

  const toast = useCallback((text, kind = 'ok') => {
    const id = nextToast.current++;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);

  const value = useMemo(() => {
    const tag = intlLocale(locale);
    const dates = (options) => new Intl.DateTimeFormat(tag, { timeZone: CLINIC_TZ, ...options });
    const number = (n, options) => new Intl.NumberFormat(tag, options).format(n ?? 0);
    const role = user?.role;
    return {
      w: words,
      locale,
      user,
      can: {
        write: role === 'staff' || role === 'owner',
        owner: role === 'owner',
        ownerArea: role === 'owner' || role === 'viewer',
        viewer: role === 'viewer',
      },
      fmt: {
        date: (iso, options = { day: 'numeric', month: 'short', year: 'numeric' }) => (iso ? dates(options).format(new Date(iso)) : '—'),
        day: (iso) => (iso ? dates({ weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso)) : '—'),
        time: (iso) => (iso ? dates({ hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'),
        dateTime: (iso) => (iso ? dates({ day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '—'),
        number,
        money: (n) => `${number(Math.round(n ?? 0))} ${words.common.egp}`,
        percent: (x) => (x == null ? '—' : number(x, { style: 'percent', maximumFractionDigits: 0 })),
        // "3 min ago" style
        ago: (iso) => {
          const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
          const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
          if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
          if (Math.abs(minutes) < 1440) return rtf.format(Math.round(minutes / 60), 'hour');
          return rtf.format(Math.round(minutes / 1440), 'day');
        },
      },
      pick: (record, field) => record?.[`${field}_${locale}`] || record?.[`${field}_en`] || '',
      say: (text, vars = {}) => String(text ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? ''),
      api,
      toast,
    };
  }, [words, locale, user, api, toast]);

  return (
    <DashContext value={value}>
      {children}
      <div className="dash-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <p key={t.id} data-kind={t.kind}>
            {t.text}
          </p>
        ))}
      </div>
    </DashContext>
  );
}

/**
 * Loads one API path and keeps the answer. A new path shows the loading state; `reload()` fetches
 * again but keeps the old data on screen meanwhile (no flicker). Pass null to load nothing yet.
 *
 *   const { data, error, loading, reload, setData } = useApi('/staff/stats/today');
 */
export function useApi(path) {
  const { api } = useSession();
  const [state, setState] = useState({ path: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    api(path).then(
      (data) => alive && setState({ path, data, error: null }),
      (error) => alive && setState({ path, data: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [api, path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((update) => setState((s) => ({ ...s, data: typeof update === 'function' ? update(s.data) : update })), []);
  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: Boolean(path) && !current, reload, setData };
}

/**
 * Like useApi, but follows the pages of a list (100 at a time) until it has every row.
 * For screens that must show everything in a range, e.g. a whole week of bookings.
 * The path must not contain limit/offset. → { data: [...rows], … }
 */
export function useApiAll(path) {
  const { api } = useSession();
  const [state, setState] = useState({ path: null, data: null, error: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    (async () => {
      const rows = [];
      const join = path.includes('?') ? '&' : '?';
      for (let offset = 0; ; offset += 100) {
        const page = await api(`${path}${join}limit=100&offset=${offset}`);
        rows.push(...page.data);
        if (rows.length >= page.meta.total || page.data.length === 0) break;
      }
      return rows;
    })().then(
      (data) => alive && setState({ path, data, error: null }),
      (error) => alive && setState({ path, data: null, error }),
    );
    return () => {
      alive = false;
    };
  }, [api, path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : null, loading: Boolean(path) && !current, reload };
}

/** Runs `fn` every `ms` while the tab is visible (live counts, open chats). */
export function usePolling(fn, ms, enabled = true) {
  const saved = useRef(fn);
  useEffect(() => {
    saved.current = fn;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => document.visibilityState === 'visible' && saved.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

/** The value, but only after it stopped changing for `ms` (search boxes). */
export function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/** Wraps an action: busy while it runs, a toast when done, the error message as a toast if it fails. */
export function useAction() {
  const { toast, w } = useDash();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (action, { success = w.common.saved, onError } = {}) => {
      setBusy(true);
      try {
        const result = await action();
        if (success) toast(success);
        return result;
      } catch (err) {
        if (onError) onError(err);
        else toast(err.message ?? w.common.error, 'error');
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, w],
  );
  return [run, busy];
}

/** Today in the clinic as 'YYYY-MM-DD'. */
export function clinicDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** 'YYYY-MM-DD' + n days. */
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A clinic day + 'HH:MM' → an ISO time with Cairo's offset (works across summer time). */
export function clinicDateTime(day, time = '00:00') {
  const asUtc = new Date(`${day}T${time}:00Z`);
  const first = cairoOffsetMinutes(asUtc);
  // next to a summer-time switch the offset at the answer can differ: check once more
  const second = cairoOffsetMinutes(new Date(asUtc.getTime() - first * 60_000));
  return new Date(asUtc.getTime() - second * 60_000).toISOString();
}

/** How many minutes Cairo's clock is ahead of UTC at that moment (120 or 180). */
function cairoOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CLINIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asIfUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asIfUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** An ISO time → { day: 'YYYY-MM-DD', time: 'HH:MM' } in clinic time. */
export function clinicParts(iso) {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return { day: clinicDay(d), time };
}

/**
 * The current time, refreshed every 30 seconds (null while rendering on the server).
 * One shared clock for the whole page; components re-render when it ticks.
 */
let clockNow = 0;
const clockListeners = new Set();
let clockTimer = null;
function subscribeClock(listener) {
  clockNow = Date.now();
  clockListeners.add(listener);
  clockTimer ??= setInterval(() => {
    clockNow = Date.now();
    clockListeners.forEach((l) => l());
  }, 30_000);
  return () => {
    clockListeners.delete(listener);
    if (!clockListeners.size) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}
export function useNow() {
  return useSyncExternalStore(
    subscribeClock,
    () => clockNow || null,
    () => null,
  );
}
