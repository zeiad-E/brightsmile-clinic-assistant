import { getDashDictionary } from '@/i18n/dictionaries';
import Services from '@/components/dash/screens/Services';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.services };
}

/** /owner/services — O4: treatments, prices, "what to expect". */
export default function Page() {
  return <Services />;
}
