import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import LoginForms from '@/components/login/LoginForms';
import styles from '@/components/login/Login.module.css';

/** /en/login · /ar/login — sign in for patients (code or details) and the team (password). */

export async function generateMetadata() {
  const { loginPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
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
            {t.noAccount} <Link href={localePath(locale, '/book')}>{t.book}</Link>
          </p>
        </div>
        <div className="fade-up [animation-delay:200ms]">
          <LoginForms t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
