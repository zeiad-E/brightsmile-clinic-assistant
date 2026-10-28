import Header from '@/components/site/Header';
import Footer from '@/components/site/Footer';

/**
 * Layout for the public website: header on top, footer at the bottom, the page in between.
 * "(site)" is a route group — the brackets keep it out of the URL (/en/services, not /en/site/services).
 */
export default function SiteLayout({ children }) {
  return (
    <>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </>
  );
}
