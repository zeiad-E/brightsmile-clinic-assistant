import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import ButtonLink from '@/components/ui/ButtonLink';

/**
 * Home page — a simple placeholder for phase F0 (foundation).
 * Phase F1 replaces it with the full trial 003 journey (3D tooth, story, services…).
 */
export default async function HomePage() {
  const locale = await getLocale();
  const { home: t } = await getDictionary();

  return (
    <section className="relative overflow-hidden bg-[radial-gradient(90%_90%_at_72%_42%,#e9fbf7_0%,#f3fafb_55%,#eef8f7_100%)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-[6%] start-[38%] h-[70%] w-[52%] rounded-full bg-[#a7f3e4] opacity-80 blur-[50px]" />
        <div className="absolute top-[30%] -end-[8%] h-[62%] w-[40%] rounded-full bg-[#bfe3ff] opacity-80 blur-[50px]" />
      </div>
      <div className="wrap relative flex min-h-[78vh] flex-col justify-center py-24">
        <p className="eyebrow fade-up">{t.eyebrow}</p>
        <h1 className="mt-4 mb-5 text-[clamp(40px,5.6vw,78px)] leading-none font-extrabold tracking-display">
          <span className="fade-up block [animation-delay:120ms]">{t.titleA}</span>
          <span className="fade-up block text-mint [animation-delay:260ms]">{t.titleB}</span>
        </h1>
        <p className="fade-up mb-8 max-w-[44ch] text-[clamp(16px,1.4vw,19px)] leading-relaxed text-ink-2 [animation-delay:420ms]">
          {t.lead}
        </p>
        <div className="fade-up flex flex-wrap gap-3.5 [animation-delay:560ms]">
          <ButtonLink href={localePath(locale, '/book')} variant="mint" size="lg">
            {t.book} <span className="flip-rtl" aria-hidden="true">→</span>
          </ButtonLink>
          <ButtonLink href={localePath(locale, '/assistant')} variant="ghost" size="lg">
            {t.ask}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
