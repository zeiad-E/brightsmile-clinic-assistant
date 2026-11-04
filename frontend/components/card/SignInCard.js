import { COPY } from './copy';
import styles from './Card.module.css';

function Side({ language, name, code, clinic, site }) {
  const t = COPY[language];
  const address = clinic?.[`address_${language}`];
  return (
    <section lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} className={styles.side}>
      <p className={styles.sideClinic}>{clinic?.[`name_${language}`] ?? 'BrightSmile'}</p>
      <h2>{t.cardTitle}</h2>
      {name && <p className={styles.sideName}>{name}</p>}
      <p className={styles.sideCode} dir="ltr">
        {code}
      </p>
      <h3>{t.ways}</h3>
      <ol>
        <li>{t.wayCode}</li>
        <li>{t.wayEmail}</li>
        <li>{t.wayPhone}</li>
      </ol>
      <p className={styles.sideContact} dir="ltr">
        {[site, clinic?.phone].filter(Boolean).join(' · ')}
      </p>
      {address && <p className={styles.sideContact}>{address}</p>}
      <p className={styles.sidePrivate}>{t.private}</p>
    </section>
  );
}

/** The card a patient keeps: their name, their code and how to sign in, in English and Arabic. */
export default function SignInCard(props) {
  return (
    <div className={styles.printed}>
      <Side language="en" {...props} />
      <Side language="ar" {...props} />
    </div>
  );
}
