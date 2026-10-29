import { getDashDictionary } from '@/i18n/dictionaries';
import Settings from '@/components/dash/screens/Settings';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.settings };
}

/** /owner/settings — O7: clinic details and booking rules. */
export default function Page() {
  return <Settings />;
}
