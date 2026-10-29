'use client';

import { useEffect, useRef, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api/client';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import Magnetic from '@/components/fx/Magnetic';
import DecodeText from '@/components/fx/DecodeText';
import styles from './Book.module.css';

const CLINIC_TZ = 'Africa/Cairo';
const ANYONE = 'any';

/**
 * The booking wizard: treatment → who → when → your details → confirm.
 *
 * Links can jump ahead: /book?service=whitening&doctor=<id>&start=<ISO> (from Services, a service
 * page or About) fills in what they know. Booking sends an Idempotency-Key (a one-time receipt
 * number), so a double click can never book twice. If someone takes the time a second earlier, we
 * go back to the times and show fresh ones.
 */
export default function BookWizard({ services, doctors, t, locale }) {
  const { status, user, signIn, getToken } = useSession();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [serviceId, setServiceId] = useState(null);
  const [doctorId, setDoctorId] = useState(null);
  const [days, setDays] = useState(null); // null = loading; [{ date, slots: [{ starts_at, staff_id }] }]
  const [day, setDay] = useState(null);
  const [slot, setSlot] = useState(null);
  const [details, setDetails] = useState({ full_name: '', date_of_birth: '', email: '', phone: '', notes: '' });
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(null);
  const [reload, setReload] = useState(0); // bump to fetch the free times again
  const wanted = useRef({ doctor: null, start: null });
  const receipt = useRef(null);

  const service = services.find((s) => s.id === serviceId);
  const team = doctors.filter((d) => service && d.service_ids.includes(service.id));
  const doctor = doctors.find((d) => d.id === (slot?.staff_id ?? doctorId));
  const isPatient = status === 'signed-in' && user?.role === 'patient';

  const go = (next) => {
    setDirection(next > step ? 1 : -1);
    setError(null);
    setStep(next);
  };

  // links from other pages: ?service=slug&doctor=id&start=ISO
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromLink = services.find((s) => s.slug === params.get('service'));
    wanted.current = { doctor: params.get('doctor'), start: params.get('start') };
    if (fromLink) pickService(fromLink.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  function pickService(id) {
    setServiceId(id);
    setSlot(null);
    const wantedDoctor = doctors.find((d) => d.id === wanted.current.doctor && d.service_ids.includes(id));
    if (wantedDoctor) pickDoctor(wantedDoctor.id, 2);
    else {
      setDoctorId(null);
      go(1);
    }
  }

  function pickDoctor(id, from = step) {
    setDoctorId(id);
    setSlot(null);
    setDays(null);
    setDirection(1);
    setError(null);
    setStep(Math.max(from, 2));
  }

  // load the free times whenever the treatment or the doctor changes
  useEffect(() => {
    if (!serviceId || !doctorId) return;
    let cancelled = false;
    const staff = doctorId === ANYONE ? '' : `&staff_id=${doctorId}`;
    apiRequest(`/availability/range?service_id=${serviceId}&days=14${staff}`)
      .then(({ doctors: perDoctor }) => {
        if (cancelled) return;
        const byDay = new Map();
        for (const d of perDoctor) {
          for (const { date, slots } of d.days) {
            const list = byDay.get(date) ?? new Map();
            for (const s of slots) if (!list.has(s.starts_at)) list.set(s.starts_at, { starts_at: s.starts_at, staff_id: d.staff_id });
            byDay.set(date, list);
          }
        }
        const merged = [...byDay.entries()]
          .map(([date, list]) => ({ date, slots: [...list.values()].sort((a, b) => a.starts_at.localeCompare(b.starts_at)) }))
          .filter((d) => d.slots.length)
          .sort((a, b) => a.date.localeCompare(b.date));
        setDays(merged);
        // a time chosen on another page: select it if it is still free
        const start = wanted.current.start;
        const match = start && merged.flatMap((d) => d.slots).find((s) => s.starts_at === start);
        wanted.current.start = null;
        if (match) {
          setDay(merged.find((d) => d.slots.includes(match)).date);
          setSlot(match);
          setDirection(1);
          setStep(3);
        } else setDay(merged[0]?.date ?? null);
      })
      .catch((err) => !cancelled && (setDays([]), setError(err.message)));
    return () => {
      cancelled = true;
    };
  }, [serviceId, doctorId, reload]);

  async function confirm() {
    setSending(true);
    setError(null);
    receipt.current ??= crypto.randomUUID();
    const body = { service_id: serviceId, staff_id: slot.staff_id, starts_at: slot.starts_at, preferred_language: locale };
    if (!isPatient) {
      for (const key of ['full_name', 'date_of_birth', 'email', 'phone']) if (details[key].trim()) body[key] = details[key].trim();
    }
    if (details.notes.trim()) body.notes = details.notes.trim();
    try {
      const token = isPatient ? await getToken() : null;
      const result = await apiRequest('/appointments', { method: 'POST', body, token, headers: { 'Idempotency-Key': receipt.current } });
      receipt.current = null;
      if (result.session?.access_token) signIn(result.session);
      setDone({ isNew: result.is_new_patient });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'slot_taken') {
        receipt.current = null;
        setSlot(null);
        setDays(null);
        go(2);
        setError(t.taken);
        setReload((n) => n + 1); // fetch fresh times
      } else setError(err.message || t.error);
    } finally {
      setSending(false);
    }
  }

  const fmt = (iso, options) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { timeZone: CLINIC_TZ, ...options }).format(new Date(iso));
  const dayChip = (date) => {
    const d = new Date(`${date}T12:00:00Z`);
    return {
      weekday: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { weekday: 'short', timeZone: 'UTC' }).format(d),
      number: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { day: 'numeric', timeZone: 'UTC' }).format(d),
      month: new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'short', timeZone: 'UTC' }).format(d),
    };
  };
  const when = slot && `${fmt(slot.starts_at, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmt(slot.starts_at, { hour: 'numeric', minute: '2-digit', hour12: true })}`;
  const contactOk = isPatient || (details.full_name.trim() && details.date_of_birth && (details.email.trim() || details.phone.trim()));

  if (done) {
    return (
      <div className={`${styles.wizard} ${styles.done}`}>
        <span className={styles.bigCheck} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </span>
        <DecodeText as="h2" text={t.doneTitle} className={styles.doneTitle} />
        <p className={styles.whenBig}>{when}</p>
        <p>
          {service.name} · {doctor?.name}
        </p>
        <p className={styles.muted}>{t.doneText}</p>
        {done.isNew && <p className={styles.notice}>{t.newPatient}</p>}
        <div className={styles.actions}>
          <Magnetic href={localePath(locale)}>{t.home}</Magnetic>
          <button type="button" className={styles.linkButton} onClick={() => window.location.assign(localePath(locale, '/book'))}>
            {t.another}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wizard}>
      <ol className={styles.progress} style={{ '--p': step / (t.steps.length - 1) }}>
        {t.steps.map((label, i) => (
          <li key={label} aria-current={i === step ? 'step' : undefined} data-done={i < step || undefined}>
            <button type="button" disabled={i >= step || sending} onClick={() => go(i)}>
              <span>{(i + 1).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div key={step} className={styles.step} data-direction={direction}>
        {step === 0 && (
          <div className={styles.grid}>
            {services.map((s) => (
              <button key={s.id} type="button" className={styles.option} aria-pressed={s.id === serviceId} onClick={() => pickService(s.id)}>
                <strong>{s.name}</strong>
                <span>
                  {t.min.replace('{n}', s.minutes)} · {s.price}
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 1 && service && (
          <div className={styles.grid}>
            <button type="button" className={`${styles.option} ${styles.anyone}`} aria-pressed={doctorId === ANYONE} onClick={() => pickDoctor(ANYONE)}>
              <strong>{t.anyone}</strong>
              <span>{t.anyoneText}</span>
            </button>
            {team.map((d) => (
              <button key={d.id} type="button" className={styles.option} aria-pressed={d.id === doctorId} onClick={() => pickDoctor(d.id)}>
                <span className={styles.avatar} aria-hidden="true">
                  {d.initials}
                </span>
                <strong>{d.name}</strong>
                <span>{d.role}</span>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <div>
            {error && <p className={styles.error}>{error}</p>}
            {days === null ? (
              <p className={styles.loading}>
                <span className={styles.spinner} aria-hidden="true" /> {t.loadingTimes}
              </p>
            ) : days.length === 0 ? (
              <p className={styles.muted}>{t.noTimes}</p>
            ) : (
              <>
                <p className={styles.label}>{t.pickDay}</p>
                <div className={styles.days}>
                  {days.map(({ date }) => {
                    const chip = dayChip(date);
                    return (
                      <button key={date} type="button" aria-pressed={date === day} onClick={() => setDay(date)}>
                        <small>{chip.weekday}</small>
                        <strong>{chip.number}</strong>
                        <small>{chip.month}</small>
                      </button>
                    );
                  })}
                </div>
                <p className={styles.label}>{t.pickTime}</p>
                <div className={styles.times}>
                  {days
                    .find((d) => d.date === day)
                    ?.slots.map((s, i) => (
                      <button
                        key={s.starts_at}
                        type="button"
                        style={{ '--i': i }}
                        aria-pressed={slot?.starts_at === s.starts_at}
                        onClick={() => {
                          setSlot(s);
                          go(3);
                        }}
                      >
                        {fmt(s.starts_at, { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              if (contactOk) go(4);
              else setError(t.contactHint);
            }}
          >
            {isPatient ? (
              <p className={styles.notice}>{t.bookingAs.replace('{name}', user.full_name ?? '')}</p>
            ) : (
              <>
                <Field label={t.fullName} required autoComplete="name" value={details.full_name} onChange={(v) => setDetails((d) => ({ ...d, full_name: v }))} />
                <Field label={t.dob} type="date" required autoComplete="bday" value={details.date_of_birth} onChange={(v) => setDetails((d) => ({ ...d, date_of_birth: v }))} />
                <div className={styles.pair}>
                  <Field label={t.email} type="email" autoComplete="email" value={details.email} onChange={(v) => setDetails((d) => ({ ...d, email: v }))} />
                  <Field label={t.phone} type="tel" dir="ltr" autoComplete="tel" placeholder={t.phoneHint} value={details.phone} onChange={(v) => setDetails((d) => ({ ...d, phone: v }))} />
                </div>
                <p className={styles.muted}>{t.contactHint}</p>
              </>
            )}
            <Field label={t.notes} textarea value={details.notes} onChange={(v) => setDetails((d) => ({ ...d, notes: v }))} />
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.linkButton} onClick={() => go(2)}>
                <span className="flip-rtl" aria-hidden="true">←</span> {t.back}
              </button>
              <button type="submit" className={styles.next}>
                {t.next}
              </button>
            </div>
          </form>
        )}

        {step === 4 && slot && (
          <div>
            <dl className={styles.summary}>
              <div>
                <dt>{t.treatment}</dt>
                <dd>{service.name}</dd>
              </div>
              <div>
                <dt>{t.with}</dt>
                <dd>{doctor?.name}</dd>
              </div>
              <div>
                <dt>{t.when}</dt>
                <dd>{when}</dd>
              </div>
              <div>
                <dt>{t.price}</dt>
                <dd>{service.price}</dd>
              </div>
              <div>
                <dt>{t.patient}</dt>
                <dd>{isPatient ? user.full_name : details.full_name}</dd>
              </div>
            </dl>
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.linkButton} onClick={() => go(3)} disabled={sending}>
                <span className="flip-rtl" aria-hidden="true">←</span> {t.back}
              </button>
              <Magnetic onClick={confirm} disabled={sending}>
                {sending ? t.booking : t.confirm}
              </Magnetic>
            </div>
          </div>
        )}
      </div>

      {step > 0 && step < 3 && (
        <button type="button" className={styles.linkButton} onClick={() => go(step - 1)}>
          <span className="flip-rtl" aria-hidden="true">←</span> {t.back}
        </button>
      )}
    </div>
  );
}

function Field({ label, textarea, onChange, ...input }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {textarea ? <textarea rows={3} {...input} onChange={(e) => onChange(e.target.value)} /> : <input {...input} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}
