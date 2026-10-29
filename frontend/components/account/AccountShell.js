'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import styles from './Account.module.css';

/**
 * The frame around every /account page: greeting, tabs, sign out, and the guard.
 * Signed-out visitors go to Sign in (and come back here afterwards with ?next=). The real lock is
 * on the API: it only ever returns the signed-in patient's own data.
 */
export default function AccountShell({ t, locale, children }) {
  const { status, user, signOut } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'signed-out') router.replace(`${localePath(locale, '/login')}?next=${encodeURIComponent(pathname)}`);
  }, [status, router, locale, pathname]);

  const tabs = [
    ['/account', t.tabs.appointments],
    ['/account/chats', t.tabs.chats],
    ['/account/profile', t.tabs.profile],
  ];

  return (
    <div className={styles.page}>
      <div className={`wrap ${styles.head}`}>
        <div>
          <p className="eyebrow">{t.title}</p>
          <h1>{user ? t.hello.replace('{name}', user.full_name?.split(' ')[0] ?? '') : t.title}</h1>
        </div>
        {status === 'signed-in' && (
          <button type="button" className={styles.signOut} onClick={() => signOut().then(() => router.push(localePath(locale)))}>
            {t.signOut}
          </button>
        )}
      </div>

      <nav className={`wrap ${styles.tabs}`} aria-label={t.title}>
        {tabs.map(([path, label]) => {
          const href = localePath(locale, path);
          return (
            <Link key={path} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          );
        })}
      </nav>

      <div className={`wrap ${styles.body}`}>
        {status !== 'signed-in' ? (
          <p className={styles.muted}>{t.loading}</p>
        ) : user.role !== 'patient' ? (
          <p className={styles.notice}>{t.notPatient}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
