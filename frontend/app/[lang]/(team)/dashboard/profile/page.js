import { getDashDictionary } from '@/i18n/dictionaries';
import MyProfile from '@/components/dash/screens/MyProfile';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.profile };
}

/** /dashboard/profile — S7: your own details and password. */
export default function Page() {
  return <MyProfile />;
}
