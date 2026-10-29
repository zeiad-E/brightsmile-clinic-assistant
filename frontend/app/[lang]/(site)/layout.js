import Header from '@/components/site/Header';
import Footer from '@/components/site/Footer';
import ChatBubble from '@/components/assistant/ChatBubble';
import { getDictionary, getLocale } from '@/i18n/dictionaries';

/**
 * Layout for the public website: header on top, footer at the bottom, the page in between, and the
 * floating assistant button on every page.
 * "(site)" is a route group — the brackets keep it out of the URL (/en/services, not /en/site/services).
 */
export default async function SiteLayout({ children }) {
  const locale = await getLocale();
  const { assistantPage } = await getDictionary();
  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
      <ChatBubble t={assistantPage} locale={locale} />
    </>
  );
}
