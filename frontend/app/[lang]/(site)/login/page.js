import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import LoginForms from '@/components/login/LoginForms';
import { pageMetadata } from '@/lib/seo';
import styles from '@/components/login/Login.module.css';

/** /en/login · /ar/login — sign in for patients (code or details) and the team (password). */

// A sign-in form is no answer to anything people search for, so it stays out of results (noindex);
// search engines still follow its links.
export async function generateMetadata() {
  const locale = await getLocale();
  const { loginPage: t, meta, brand } = await getDictionary();
  return pageMetadata({ locale, path: '/login', title: t.title, description: t.lead, siteName: meta.title, brand, noindex: true });
}

export default async function LoginPage() {
  const locale = await getLocale();
  const { loginPage: t } = await getDictionary();

  return (
    <div className={styles.page}>
      <div className={`wrap ${styles.layout}`}>
        <div className={styles.intro}>
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">{t.heading}</h1>
          <p className={`${styles.lead} fade-up [animation-delay:240ms]`}>{t.lead}</p>
          <p className={`${styles.noAccount} fade-up [animation-delay:320ms]`}>
            {t.noAccount} <Link href={localePath(locale, '/register')}>{t.register}</Link>
          </p>
        </div>
        <div className="fade-up [animation-delay:200ms]">
          <LoginForms t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
