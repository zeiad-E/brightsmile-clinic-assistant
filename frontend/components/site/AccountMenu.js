'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import styles from './AccountMenu.module.css';

/** "Dr. Sarah Mansour" → "SM", "Mariam Hassan" → "MH" (titles like "Dr." are skipped). */
export function initials(fullName = '') {
  return fullName
    .split(' ')
    .filter((word) => word && !/^(Dr\.|د\.)$/.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

/** Patients get their account pages; the team gets their dashboard (owner/viewer: the owner one). */
function menuItems(user, locale, labels) {
  return user.role === 'patient'
    ? [
        { href: localePath(locale, '/account'), label: labels.appointments, icon: 'calendar' },
        { href: localePath(locale, '/account/profile'), label: labels.profile, icon: 'user' },
      ]
    : [
        { href: localePath(locale, user.role === 'staff' ? '/dashboard' : '/owner'), label: labels.dashboard, icon: 'grid' },
        { href: localePath(locale, '/dashboard/profile'), label: labels.profile, icon: 'user' },
      ];
}

/**
 * The signed-in person in the header: a round avatar with their initials and first name. Clicking it
 * opens a small menu (My appointments, My profile, Sign out; the team gets Dashboard).
 */
export default function AccountMenu({ locale, labels }) {
  const { user, signOut } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // close on Escape or a click anywhere else
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => !rootRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onClick);
    };
  }, [open]);

  const firstName = user.full_name?.split(' ').find((w) => !/^(Dr\.|د\.)$/.test(w)) ?? user.email;

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.chip}
        data-on-dark
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${labels.accountMenu}: ${user.full_name ?? ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {initials(user.full_name)}
        </span>
        <span className={styles.name}>{firstName}</span>
        <svg viewBox="0 0 24 24" className={styles.chevron} aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className={`${styles.menu} ${open ? styles.menuOpen : ''}`} role="menu" aria-hidden={!open}>
        <div className={styles.who}>
          <span className={`${styles.avatar} ${styles.avatarBig}`} aria-hidden="true">
            {initials(user.full_name)}
          </span>
          <div>
            <strong>{user.full_name}</strong>
            {user.email && <small>{user.email}</small>}
          </div>
        </div>
        {menuItems(user, locale, labels).map((item) => (
          <Link key={item.href} href={item.href} role="menuitem" tabIndex={open ? 0 : -1} className={styles.item} onClick={() => setOpen(false)}>
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          role="menuitem"
          tabIndex={open ? 0 : -1}
          className={`${styles.item} ${styles.signOut}`}
          onClick={async () => {
            setOpen(false);
            await signOut();
            router.push(localePath(locale));
          }}
        >
          <Icon name="out" />
          {labels.signOut}
        </button>
      </div>
    </div>
  );
}

/** The same person at the top of the phone menu: avatar, full name, then the links. */
export function MobileAccount({ locale, labels, onNavigate }) {
  const { user, signOut } = useSession();
  const router = useRouter();
  return (
    <div className={styles.mobile}>
      <div className={styles.who}>
        <span className={`${styles.avatar} ${styles.avatarBig}`} aria-hidden="true">
          {initials(user.full_name)}
        </span>
        <div>
          <strong>{user.full_name}</strong>
          {user.email && <small>{user.email}</small>}
        </div>
      </div>
      {menuItems(user, locale, labels).map((item) => (
        <Link key={item.href} href={item.href} className={styles.item} onClick={onNavigate}>
          <Icon name={item.icon} />
          {item.label}
        </Link>
      ))}
      <button
        type="button"
        className={`${styles.item} ${styles.signOut}`}
        onClick={async () => {
          onNavigate();
          await signOut();
          router.push(localePath(locale));
        }}
      >
        <Icon name="out" />
        {labels.signOut}
      </button>
    </div>
  );
}

const ICONS = {
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  out: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" className={`${styles.icon} ${name === 'out' ? 'flip-rtl' : ''}`} aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}
