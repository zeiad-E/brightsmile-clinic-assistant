import { getDashDictionary } from '@/i18n/dictionaries';
import AssistantRoom from '@/components/dash/screens/AssistantRoom';

export async function generateMetadata() {
  const { shell } = await getDashDictionary();
  return { title: shell.nav.assistant };
}

/** /owner/assistant — O6: health, pause switch, problem queue, activity, memory, intake. */
export default function Page() {
  return <AssistantRoom />;
}
