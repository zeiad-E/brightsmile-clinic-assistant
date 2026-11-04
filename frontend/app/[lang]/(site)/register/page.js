import Link from 'next/link';
import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import RegisterForms from '@/components/login/RegisterForms';
import styles from '@/components/login/Login.module.css';

/** /en/register · /ar/register — a new patient creates an account. */

export async function generateMetadata() {
  const { registerPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
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
