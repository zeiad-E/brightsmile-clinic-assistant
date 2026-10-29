import { getDashDictionary } from '@/i18n/dictionaries';
import Team from '@/components/dash/screens/Team';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.team };
}

/** /owner/team — O2: team accounts. */
export default function Page() {
  return <Team />;
}
