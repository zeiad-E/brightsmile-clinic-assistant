'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import LanguageSwitch from '@/components/site/LanguageSwitch';
import Logo from '@/components/brand/Logo';
import DashProvider, { useApi, useDash, useDebounced, usePolling } from './DashProvider';
import { Avatar, Badge, Icon } from './kit';
import st from './Shell.module.css';

/**
 * The frame around every team page: the door check, the sidebar, the top bar and the phone menu.
 *
 * Who gets in (the backend checks again on every request):
 *   signed out → Sign in, then back here      patient → a kind note + link to their account
 *   staff      → /dashboard pages only         owner → everything     viewer → everything, read-only
 */
const CLINIC = [
  ['/dashboard', 'today'],
  ['/dashboard/appointments', 'appointments'],
  ['/dashboard/patients', 'patients'],
  ['/dashboard/inbox', 'inbox'],
  ['/dashboard/conversations', 'conversations'],
  ['/dashboard/time-off', 'timeOff'],
];
const OWNER = [
  ['/owner/team', 'team'],
  ['/owner/doctors', 'doctors'],
  ['/owner/services', 'services'],
  ['/owner/knowledge', 'knowledge'],
  ['/owner/assistant', 'assistant'],
  ['/owner/settings', 'settings'],
  ['/owner/activity', 'activity'],
];

export default function DashShell({ words, locale, children }) {
  return (
    <DashProvider words={words} locale={locale}>
      <Door locale={locale}>{children}</Door>
    </DashProvider>
  );
}

function Door({ locale, children }) {
  const { status, user } = useSession();
  const { w } = useDash();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signed-out') router.replace(`${localePath(locale, '/login')}?next=${encodeURIComponent(pathname)}`);
  }, [status, router, locale, pathname]);

  if (status !== 'signed-in') {
    return (
      <div className={st.splash}>
        <Logo />
        <p>{w.shell.guardLoading}</p>
      </div>
    );
  }
  if (user.role === 'patient') {
    return (
      <Gate text={w.shell.patientNotice}>
        <Link href={localePath(locale, '/account')}>{w.shell.patientLink}</Link>
      </Gate>
    );
  }
  const ownerPage = pathname.startsWith(`/${locale}/owner`);
  return (
    <Frame locale={locale}>
      {ownerPage && user.role === 'staff' ? (
        <Gate text={w.shell.ownerOnly} inline>
          <Link href={localePath(locale, '/dashboard')}>{w.shell.ownerOnlyLink}</Link>
        </Gate>
      ) : (
        children
      )}
    </Frame>
  );
}

function Gate({ text, children, inline }) {
  return (
    <div className={inline ? st.gateInline : st.splash}>
      <Icon name="lock" size={28} />
      <p>{text}</p>
      {children}
    </div>
  );
}

function Frame({ locale, children }) {
  const { w, can, user, api } = useDash();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('brightsmile.dash.collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [pulse, setPulse] = useState({ handovers: null, live: 0, shake: 0 });
  const searchRef = useRef(null);

  // Live counts for the sidebar and the bell: open handovers and chats active right now.
  // The bell shakes once when the number of handovers goes up.
  const refreshCounts = useCallback(async () => {
    try {
      const [handovers, live] = await Promise.all([api('/staff/escalations?status=open&limit=5'), api('/staff/conversations?live=true&limit=1')]);
      setPulse((p) => ({
        handovers,
        live: live.meta.total,
        shake: p.handovers && handovers.meta.total > p.handovers.meta.total ? p.shake + 1 : p.shake,
      }));
    } catch {
      /* the next check will try again */
    }
  }, [api]);
  useEffect(() => {
    const first = setTimeout(refreshCounts, 0); // first check right after the frame appears
    return () => clearTimeout(first);
  }, [refreshCounts]);
  usePolling(refreshCounts, 30_000);

  // "/" jumps to the patient search, like in many tools
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('brightsmile.dash.collapsed', c ? '0' : '1');
      } catch {
        /* private mode: just don't remember */
      }
      return !c;
    });
  };

  const handoverCount = pulse.handovers?.meta.total ?? 0;
  const badges = { inbox: handoverCount || null, conversations: pulse.live || null };
  const home = can.ownerArea ? '/owner' : '/dashboard';
  const groups = can.ownerArea
    ? [
        [null, [['/owner', 'overview']]],
        [w.shell.groups.clinic, CLINIC],
        [w.shell.groups.owner, OWNER],
      ]
    : [[null, CLINIC]];

  const isActive = (path) => {
    const href = localePath(locale, path);
    return path === '/dashboard' || path === '/owner' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  };

  const nav = (
    <nav className={st.nav} aria-label={w.shell.nav.menu}>
      {groups.map(([title, items], i) => (
        <div key={i} className={st.group}>
          {title && <p className={st.groupTitle}>{title}</p>}
          {items.map(([path, key]) => (
            <Link
              key={path}
              href={localePath(locale, path)}
              className={st.navItem}
              aria-current={isActive(path) ? 'page' : undefined}
              title={collapsed ? w.shell.nav[key] : undefined}
              onClick={() => setMenuOpen(false)}
            >
              <Icon name={key} />
              <span className={st.navLabel}>{w.shell.nav[key]}</span>
              {key === 'conversations' && badges.conversations ? <span className={st.liveDot} aria-label={w.shell.liveNow} /> : null}
              {key === 'inbox' && badges.inbox ? <span className={st.navCount}>{badges.inbox}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className={`${st.frame} ${collapsed ? st.collapsed : ''}`}>
      <aside className={`${st.sidebar} ${menuOpen ? st.sidebarOpen : ''}`}>
        <div className={st.brand}>
          <Link href={localePath(locale, home)} className={st.brandLink}>
            <Logo />
            <span className={st.navLabel}>
              {w.shell.brand}
              <small>{can.ownerArea ? w.shell.ownerArea : w.shell.teamArea}</small>
            </span>
          </Link>
          <button type="button" className={st.collapse} onClick={toggleCollapsed} aria-label={collapsed ? w.shell.nav.expand : w.shell.nav.collapse}>
            <Icon name="chevron" size={16} />
          </button>
        </div>
        {nav}
        <div className={st.sideFoot}>
          <Link href={localePath(locale, '/dashboard/profile')} className={st.navItem} aria-current={isActive('/dashboard/profile') ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
            <Icon name="profile" />
            <span className={st.navLabel}>{w.shell.nav.profile}</span>
          </Link>
          <Link href={localePath(locale)} className={st.navItem}>
            <Icon name="website" />
            <span className={st.navLabel}>{w.shell.nav.website}</span>
          </Link>
        </div>
      </aside>
      {menuOpen && <div className={st.scrim} onClick={() => setMenuOpen(false)} />}

      <div className={st.body}>
        <header className={st.top}>
          <button type="button" className={st.menuBtn} onClick={() => setMenuOpen(true)} aria-label={w.shell.nav.menu}>
            <Icon name="menu" />
          </button>
          <PatientSearch inputRef={searchRef} locale={locale} />
          <div className={st.topEnd}>
            <Bell data={pulse.handovers} shake={pulse.shake} locale={locale} />
            <LanguageSwitch locale={locale} label={w.shell.language} ariaLabel={w.shell.languageLabel} className={st.lang} />
            <UserMenu locale={locale} user={user} />
          </div>
        </header>
        {can.viewer && <p className={st.viewerBanner}>{w.shell.viewerBanner}</p>}
        <main id="main" key={pathname} className={st.main}>
          {children}
        </main>
      </div>

      <nav className={st.bottomBar} aria-label={w.shell.nav.menu}>
        {[[home, can.ownerArea ? 'overview' : 'today'], ['/dashboard/appointments', 'appointments'], ['/dashboard/patients', 'patients'], ['/dashboard/inbox', 'inbox']].map(([path, key]) => (
          <Link key={path} href={localePath(locale, path)} aria-current={isActive(path) ? 'page' : undefined}>
            <Icon name={key} />
            <span>{w.shell.nav[key]}</span>
            {key === 'inbox' && badges.inbox ? <em>{badges.inbox}</em> : null}
          </Link>
        ))}
        <button type="button" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" />
          <span>{w.shell.nav.menu}</span>
        </button>
      </nav>
    </div>
  );
}

function PatientSearch({ inputRef, locale }) {
  const { w, user } = useDash();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const results = useApi(term.length >= 2 ? `/staff/patients?q=${encodeURIComponent(term)}&limit=6` : null);
  const rootRef = useRef(null);
  const role = user.role;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const go = (patient) => {
    setOpen(false);
    setQ('');
    router.push(localePath(locale, `/dashboard/patients/${patient.id}`));
  };
  const list = results.data?.data ?? [];

  return (
    <div ref={rootRef} className={st.search}>
      <Icon name="patients" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder={w.shell.searchPlaceholder}
        aria-label={w.shell.searchPlaceholder}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && list[0]) go(list[0]);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <kbd aria-hidden="true">/</kbd>
      {open && term.length >= 2 && (
        <div className={st.dropdown} role="listbox">
          {results.loading && <p className={st.dropNote}>{w.common.loading}</p>}
          {!results.loading && list.length === 0 && <p className={st.dropNote}>{w.shell.searchEmpty}</p>}
          {list.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected="false" className={st.dropItem} onClick={() => go(p)}>
              <Avatar name={p.full_name} size={30} />
              <span>
                <strong>{p.full_name}</strong>
                <small dir="ltr">{[p.phone, p.email].filter(Boolean).join(' · ') || (role === 'viewer' ? '' : '—')}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Bell({ data, shake, locale }) {
  const { w, fmt } = useDash();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const count = data?.meta.total ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div ref={rootRef} className={st.popRoot}>
      <button type="button" key={shake} className={`${st.iconBtn} ${shake ? st.shake : ''}`} aria-label={`${w.shell.bell}: ${count}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="bell" />
        {count > 0 && <span className={st.bellCount}>{count}</span>}
      </button>
      {open && (
        <div className={st.pop}>
          <p className={st.popTitle}>{w.shell.bell}</p>
          {(data?.data ?? []).length === 0 && <p className={st.dropNote}>{w.shell.bellEmpty}</p>}
          {(data?.data ?? []).map((e) => (
            <Link key={e.id} href={`${localePath(locale, '/dashboard/inbox')}?h=${e.id}`} className={st.popItem} onClick={() => setOpen(false)}>
              <Badge tone={e.urgency === 'urgent' ? 'red' : e.urgency === 'high' ? 'amber' : 'blue'}>{w.urgency[e.urgency]}</Badge>
              <span>{e.reason}</span>
              <small>{fmt.ago(e.created_at)}</small>
            </Link>
          ))}
          <Link href={localePath(locale, '/dashboard/inbox')} className={st.popAll} onClick={() => setOpen(false)}>
            {w.shell.bellAll}
          </Link>
        </div>
      )}
    </div>
  );
}

function UserMenu({ locale, user }) {
  const { w } = useDash();
  const { signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={st.popRoot}>
      <button type="button" className={st.userBtn} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((v) => !v)}>
        <Avatar name={user.full_name ?? user.email} size={32} />
        <span className={st.userName}>{user.full_name?.split(' ').find((x) => !/^(Dr\.|د\.)$/.test(x)) ?? user.email}</span>
      </button>
      {open && (
        <div className={st.pop} role="menu">
          <div className={st.who}>
            <Avatar name={user.full_name ?? user.email} size={40} />
            <div>
              <strong>{user.full_name}</strong>
              <small>{user.email}</small>
              <Badge tone={user.role === 'owner' ? 'violet' : user.role === 'viewer' ? 'gray' : 'mint'}>{w.roles[user.role]}</Badge>
            </div>
          </div>
          <Link role="menuitem" href={localePath(locale, '/dashboard/profile')} className={st.popItem} onClick={() => setOpen(false)}>
            <Icon name="profile" /> {w.shell.nav.profile}
          </Link>
          <Link role="menuitem" href={localePath(locale)} className={st.popItem}>
            <Icon name="website" /> {w.shell.nav.website}
          </Link>
          <button
            type="button"
            role="menuitem"
            className={`${st.popItem} ${st.signOut}`}
            onClick={async () => {
              setOpen(false);
              await signOut();
              router.push(localePath(locale, '/login'));
            }}
          >
            <Icon name="out" /> {w.shell.nav.signOut}
          </button>
        </div>
      )}
    </div>
  );
}
