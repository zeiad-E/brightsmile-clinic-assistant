import { getDictionary, getLocale } from '@/i18n/dictionaries';
import { getClinic } from '@/lib/api/public';
import Appointments from '@/components/account/Appointments';

/** /account — upcoming and past visits; cancel or move a booking. */
export default async function MyAppointmentsPage() {
  const locale = await getLocale();
  const { accountPage, bookPage } = await getDictionary();
  const clinic = await getClinic();
  return (
    <Appointments
      t={accountPage.appointments}
      bookWords={bookPage}
      locale={locale}
      windowHours={clinic?.booking_rules?.cancellation_window_hours ?? 24}
    />
  );
}
