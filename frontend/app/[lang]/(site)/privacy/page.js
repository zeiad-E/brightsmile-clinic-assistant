import { getDictionary } from '@/i18n/dictionaries';
import { getClinic } from '@/lib/api/public';
import Scribble from '@/components/fx/Scribble';
import Toc from '@/components/privacy/Toc';
import styles from '@/components/privacy/Privacy.module.css';

/**
 * /en/privacy · /ar/privacy — what we keep, why, how long, and what the AI sees, in plain words.
 * Almost all static: Next.js builds it once. Only the contents list (scroll-spy) runs in the browser.
 */

export async function generateMetadata() {
  const { privacyPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
}

export default async function PrivacyPage() {
  const { privacyPage: t } = await getDictionary();
  const clinic = await getClinic();
  const fill = (text) => text.replace('{email}', clinic?.email ?? '—').replace('{phone}', clinic?.phone ?? '—');

  return (
    <div className={styles.page}>
      <section className={styles.intro}>
        <div className="wrap">
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">
            {t.headA} <Scribble shape="circle" delay={0.9}>{t.headMark}</Scribble>
          </h1>
          <p className={`${styles.lead} fade-up [animation-delay:260ms]`}>{t.lead}</p>
          <p className={`${styles.updated} fade-up [animation-delay:340ms]`}>{t.updated}</p>
        </div>
      </section>

      <div className={`wrap ${styles.layout}`}>
        <Toc title={t.toc} sections={t.sections.map(({ id, title }) => ({ id, title }))} />

        <div className={styles.content}>
          <aside className={styles.summary}>
            <h2>{t.summaryTitle}</h2>
            <ul>
              {t.summary.map((line, i) => (
                <li key={line}>{i === 1 ? <Scribble delay={0.4}>{line}</Scribble> : line}</li>
              ))}
            </ul>
          </aside>

          {t.sections.map((section) => (
            <section key={section.id} id={section.id} className={styles.section}>
              <h2>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} dir="auto">
                  {fill(paragraph)}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
