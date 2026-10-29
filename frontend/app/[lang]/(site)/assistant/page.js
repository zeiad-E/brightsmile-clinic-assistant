import { getDictionary, getLocale } from '@/i18n/dictionaries';
import Chat from '@/components/assistant/Chat';
import styles from '@/components/assistant/AssistantPage.module.css';

/**
 * /en/assistant · /ar/assistant — the clinic assistant, full screen.
 * The page (title, intro) is built on the server; the chat itself is a client component.
 */

export async function generateMetadata() {
  const { assistantPage: t } = await getDictionary();
  return { title: t.title, description: t.lead };
}

export default async function AssistantPage() {
  const locale = await getLocale();
  const { assistantPage: t } = await getDictionary();

  return (
    <div className={styles.page}>
      <div className={styles.glow} aria-hidden="true">
        <i />
        <i />
      </div>
      <div className={`wrap ${styles.layout}`}>
        <div className={styles.intro}>
          <p className="eyebrow fade-up">{t.eyebrow}</p>
          <h1 className="fade-up [animation-delay:120ms]">{t.heading}</h1>
          <p className={`${styles.lead} fade-up [animation-delay:240ms]`}>{t.lead}</p>
        </div>
        <div className="fade-up [animation-delay:200ms]">
          <Chat t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
