import { getDashDictionary } from '@/i18n/dictionaries';
import Overview from '@/components/dash/screens/Overview';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.overview };
}

/** /owner — O1 Overview: the numbers for any period. */
export default function Page() {
  return <Overview />;
}
