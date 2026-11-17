import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import RegisterForms from '@/components/login/RegisterForms';
import { pageMetadata } from '@/lib/seo';
import styles from '@/components/login/Login.module.css';

/** /en/register · /ar/register — a new patient creates an account. */

// Like /login: kept out of search results, links still followed.
export async function generateMetadata() {
  const locale = await getLocale();
  const { registerPage: t, meta, brand } = await getDictionary();
  return pageMetadata({ locale, path: '/register', title: t.title, description: t.lead, siteName: meta.title, brand, noindex: true });
}

export default async function RegisterPage() {
  const locale = await getLocale();
  const { registerPage: t } = await getDictionary();

  return (
    <div className={styles.page}>
      <div className={`wrap ${styles.layout}`}>
        <div className={styles.intro}>
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">{t.heading}</h1>
          <p className={`${styles.lead} fade-up [animation-delay:240ms]`}>{t.lead}</p>
          <p className={`${styles.noAccount} fade-up [animation-delay:320ms]`}>
            {t.haveAccount} <Link href={localePath(locale, '/login')}>{t.signIn}</Link>
          </p>
        </div>
        <div className="fade-up [animation-delay:200ms]">
          <RegisterForms t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
