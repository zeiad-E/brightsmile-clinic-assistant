import { getDashDictionary } from '@/i18n/dictionaries';
import Patients from '@/components/dash/screens/Patients';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.patients };
}

/** /dashboard/patients — S3: search every patient, add a new one. */
export default function Page() {
  return <Patients />;
}
