import { getDashDictionary } from '@/i18n/dictionaries';
import Knowledge from '@/components/dash/screens/Knowledge';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.knowledge };
}

/** /owner/knowledge — O5: the assistant's documents and unanswered questions. */
export default function Page() {
  return <Knowledge />;
}
