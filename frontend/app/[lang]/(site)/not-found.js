import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { localePath } from '@/i18n/config';
import ButtonLink from '@/components/ui/ButtonLink';
import Logo from '@/components/brand/Logo';
import Glitch from '@/components/fx/Glitch';

/** The 404 page. Next.js shows it whenever a page calls notFound(). */
export default async function NotFound() {
  const locale = await getLocale();
  const dict = await getDictionary();
  const t = dict.notFound;

  return (
    <section className="wrap flex flex-col items-center py-28 text-center">
      <Logo className="size-16 animate-float" />
      <p className="mt-6 font-mono text-[clamp(72px,14vw,160px)] leading-none font-extrabold tracking-tight text-ink" dir="ltr">
        <Glitch>404</Glitch>
      </p>
      <h1 className="mt-4 max-w-[18ch] text-4xl font-extrabold tracking-display sm:text-5xl">{t.title}</h1>
      <p className="mt-4 max-w-[46ch] text-lg leading-relaxed text-ink-2">{t.text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href={localePath(locale)} variant="mint" size="lg">
          {t.home}
        </ButtonLink>
        <ButtonLink href={localePath(locale, '/assistant')} variant="ghost" size="lg">
          {t.assistant}
        </ButtonLink>
      </div>
    </section>
  );
}
