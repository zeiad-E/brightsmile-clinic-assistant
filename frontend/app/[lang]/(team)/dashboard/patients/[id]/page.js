import { getDashDictionary } from '@/i18n/dictionaries';
import PatientProfile from '@/components/dash/screens/PatientProfile';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.patients };
}

/** /dashboard/patients/[id] — one patient's profile: details, visits, chats, sign-in help. */
export default function Page() {
  return <PatientProfile />;
}
