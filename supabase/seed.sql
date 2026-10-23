-- Demo data for BrightSmile Dental Clinic. Safe to re-run (upserts / idempotency keys).
-- Login accounts are created separately (backend/scripts/seed-accounts.js) because
-- they must go through the Supabase Auth API.

-- ---------------------------------------------------------------- clinic
insert into public.clinic_settings (id, name_en, name_ar, timezone, phone, email, address_en, address_ar, currency)
values (
  1,
  'BrightSmile Dental Clinic',
  'عيادة برايت سمايل لطب الأسنان',
  'Africa/Cairo',
  '+20 100 555 0123',
  'hello@brightsmile.clinic',
  '21 Al Horreya Avenue, 3rd floor, Heliopolis, Cairo',
  '٢١ شارع الحرية، الدور الثالث، مصر الجديدة، القاهرة',
  'EGP'
)
on conflict (id) do update set
  name_en = excluded.name_en, name_ar = excluded.name_ar, timezone = excluded.timezone,
  phone = excluded.phone, email = excluded.email,
  address_en = excluded.address_en, address_ar = excluded.address_ar, currency = excluded.currency;

-- ---------------------------------------------------------------- doctors
insert into public.staff (id, full_name_en, full_name_ar, title, bio_en, bio_ar) values
  ('5eed0000-0000-4000-a000-000000000101', 'Dr. Sarah Mansour', 'د. سارة منصور', 'dentist',
   'Founder of BrightSmile. 15 years in general and cosmetic dentistry; whitening and root canal treatment.',
   'مؤسسة برايت سمايل. ١٥ عامًا من الخبرة في طب الأسنان العام والتجميلي، وتبييض الأسنان وعلاج الجذور.'),
  ('5eed0000-0000-4000-a000-000000000102', 'Dr. Karim Adel', 'د. كريم عادل', 'dentist',
   'General dentist focused on fillings, extractions and children''s dentistry. Known for gentle, calm visits.',
   'طبيب أسنان عام متخصص في الحشوات والخلع وطب أسنان الأطفال. معروف بأسلوبه الهادئ واللطيف.'),
  ('5eed0000-0000-4000-a000-000000000103', 'Nadia Fawzy', 'نادية فوزي', 'hygienist',
   'Dental hygienist for professional cleaning, scaling and polishing, and oral-hygiene coaching.',
   'أخصائية صحة الفم للتنظيف الاحترافي وإزالة الجير والتلميع، والإرشاد للعناية بالأسنان.')
on conflict (id) do update set
  full_name_en = excluded.full_name_en, full_name_ar = excluded.full_name_ar, title = excluded.title,
  bio_en = excluded.bio_en, bio_ar = excluded.bio_ar;

-- ---------------------------------------------------------------- services (EGP)
insert into public.services (id, slug, name_en, name_ar, description_en, description_ar, duration_minutes, price_egp, sort_order) values
  ('5eed0000-0000-4000-a000-000000000201', 'check-up', 'Check-up & consultation', 'كشف واستشارة',
   'Full examination, treatment plan and advice.', 'فحص شامل وخطة علاج ونصائح.', 20, 400, 1),
  ('5eed0000-0000-4000-a000-000000000202', 'teeth-cleaning', 'Teeth cleaning', 'تنظيف الأسنان',
   'Professional scaling and polishing.', 'إزالة الجير والتلميع الاحترافي.', 30, 800, 2),
  ('5eed0000-0000-4000-a000-000000000203', 'filling', 'Tooth filling', 'حشو الأسنان',
   'Tooth-coloured composite filling.', 'حشو تجميلي بلون الأسنان.', 45, 1200, 3),
  ('5eed0000-0000-4000-a000-000000000204', 'extraction', 'Tooth extraction', 'خلع الأسنان',
   'Simple extraction under local anaesthesia.', 'خلع بسيط تحت التخدير الموضعي.', 30, 1000, 4),
  ('5eed0000-0000-4000-a000-000000000205', 'root-canal', 'Root canal treatment', 'علاج العصب (الجذور)',
   'Root canal treatment of one tooth (crown not included).', 'علاج عصب سن واحد (لا يشمل التركيبة).', 90, 3500, 5),
  ('5eed0000-0000-4000-a000-000000000206', 'whitening', 'Teeth whitening', 'تبييض الأسنان',
   'In-clinic whitening session.', 'جلسة تبييض داخل العيادة.', 60, 4500, 6),
  ('5eed0000-0000-4000-a000-000000000207', 'kids-check-up', 'Children''s check-up', 'كشف الأطفال',
   'Check-up and fluoride for children under 12.', 'كشف وفلورايد للأطفال أقل من ١٢ سنة.', 30, 500, 7),
  ('5eed0000-0000-4000-a000-000000000208', 'braces-consultation', 'Braces consultation', 'استشارة التقويم',
   'Assessment and options for braces or clear aligners.', 'تقييم وعرض خيارات التقويم أو التقويم الشفاف.', 30, 500, 8)
on conflict (id) do update set
  slug = excluded.slug, name_en = excluded.name_en, name_ar = excluded.name_ar,
  description_en = excluded.description_en, description_ar = excluded.description_ar,
  duration_minutes = excluded.duration_minutes, price_egp = excluded.price_egp, sort_order = excluded.sort_order;

-- Who offers what.
insert into public.staff_services (staff_id, service_id)
select s.staff_id::uuid, s.service_id::uuid
from (values
  ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000201'),
  ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000203'),
  ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000205'),
  ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000206'),
  ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000208'),
  ('5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000201'),
  ('5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000203'),
  ('5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000204'),
  ('5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000207'),
  ('5eed0000-0000-4000-a000-000000000103', '5eed0000-0000-4000-a000-000000000202'),
  ('5eed0000-0000-4000-a000-000000000103', '5eed0000-0000-4000-a000-000000000207')
) as s(staff_id, service_id)
on conflict do nothing;

-- Weekly schedules (0 = Sunday … 6 = Saturday). Clinic: Saturday–Thursday 10:00–18:00, Friday closed.
delete from public.working_hours
where staff_id in ('5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000103');

insert into public.working_hours (staff_id, weekday, start_time, end_time)
select '5eed0000-0000-4000-a000-000000000101'::uuid, d, time '10:00', time '18:00' from unnest(array[6, 0, 1, 2, 3, 4]) d  -- Dr. Sarah: Sat–Thu
union all
select '5eed0000-0000-4000-a000-000000000102'::uuid, d, time '12:00', time '18:00' from unnest(array[0, 1, 2, 3, 4]) d     -- Dr. Karim: Sun–Thu afternoons
union all
select '5eed0000-0000-4000-a000-000000000103'::uuid, d, time '10:00', time '16:00' from unnest(array[6, 0, 1, 2, 3, 4]) d; -- Nadia: Sat–Thu

-- ---------------------------------------------------------------- knowledge base (EN + AR)
insert into public.knowledge_docs (group_key, language, category, title, content, source_type, ingest_status) values
('opening-hours', 'en', 'hours', 'Opening hours',
$$BrightSmile Dental Clinic is open Saturday to Thursday, 10:00 AM to 6:00 PM (Cairo time). The clinic is closed on Fridays and on official public holidays such as Eid.
Dr. Sarah Mansour works Saturday to Thursday, 10:00 AM to 6:00 PM. Dr. Karim Adel works Sunday to Thursday, 12:00 PM to 6:00 PM. Our hygienist Nadia Fawzy works Saturday to Thursday, 10:00 AM to 4:00 PM.
Walk-ins are welcome when a doctor is free, but booking ahead guarantees your time. The online assistant can book appointments 24/7.$$, 'manual', 'pending'),
('opening-hours', 'ar', 'hours', 'مواعيد العمل',
$$تعمل عيادة برايت سمايل لطب الأسنان من السبت إلى الخميس، من الساعة ١٠ صباحًا حتى ٦ مساءً بتوقيت القاهرة. العيادة مغلقة يوم الجمعة وفي العطلات الرسمية مثل الأعياد.
تعمل د. سارة منصور من السبت إلى الخميس من ١٠ صباحًا حتى ٦ مساءً، ويعمل د. كريم عادل من الأحد إلى الخميس من ١٢ ظهرًا حتى ٦ مساءً، وتعمل أخصائية صحة الفم نادية فوزي من السبت إلى الخميس من ١٠ صباحًا حتى ٤ عصرًا.
نستقبل الحالات بدون موعد إذا كان هناك طبيب متاح، لكن الحجز المسبق يضمن موعدك. يمكن للمساعد الذكي حجز المواعيد على مدار الساعة.$$, 'manual', 'pending'),

('location', 'en', 'location', 'Location & directions',
$$We are at 21 Al Horreya Avenue, 3rd floor, Heliopolis, Cairo. The building has an elevator.
Street parking is available on Al Horreya Avenue, and there is a paid parking garage two minutes away on foot.
You can reach us by phone or WhatsApp at +20 100 555 0123, or by email at hello@brightsmile.clinic.$$, 'manual', 'pending'),
('location', 'ar', 'location', 'العنوان والوصول',
$$عنواننا: ٢١ شارع الحرية، الدور الثالث، مصر الجديدة، القاهرة. يوجد مصعد في المبنى.
يتوفر مكان لركن السيارات في شارع الحرية، ويوجد جراج بأجر على بعد دقيقتين سيرًا.
يمكنك التواصل معنا عبر الهاتف أو واتساب على الرقم ‎+20 100 555 0123‎ أو عبر البريد الإلكتروني hello@brightsmile.clinic.$$, 'manual', 'pending'),

('prices', 'en', 'pricing', 'Prices',
$$Our prices in Egyptian pounds (EGP):
- Check-up & consultation: 400 EGP (about 20 minutes)
- Teeth cleaning (scaling and polishing): 800 EGP (30 minutes)
- Tooth-coloured filling: 1,200 EGP per tooth (45 minutes)
- Simple tooth extraction: 1,000 EGP (30 minutes)
- Root canal treatment: 3,500 EGP per tooth, crown not included (90 minutes)
- In-clinic teeth whitening: 4,500 EGP (60 minutes)
- Children's check-up with fluoride (under 12): 500 EGP (30 minutes)
- Braces consultation: 500 EGP (30 minutes)
The check-up fee is deducted if you start a treatment on the same day. Final prices for complex cases are confirmed by the doctor after the examination.$$, 'manual', 'pending'),
('prices', 'ar', 'pricing', 'الأسعار',
$$أسعارنا بالجنيه المصري:
- كشف واستشارة: ٤٠٠ جنيه (حوالي ٢٠ دقيقة)
- تنظيف الأسنان (إزالة الجير والتلميع): ٨٠٠ جنيه (٣٠ دقيقة)
- حشو تجميلي بلون الأسنان: ١٢٠٠ جنيه للسن (٤٥ دقيقة)
- خلع بسيط: ١٠٠٠ جنيه (٣٠ دقيقة)
- علاج العصب: ٣٥٠٠ جنيه للسن ولا يشمل التركيبة (٩٠ دقيقة)
- تبييض الأسنان داخل العيادة: ٤٥٠٠ جنيه (٦٠ دقيقة)
- كشف الأطفال مع الفلورايد (أقل من ١٢ سنة): ٥٠٠ جنيه (٣٠ دقيقة)
- استشارة التقويم: ٥٠٠ جنيه (٣٠ دقيقة)
تُخصم رسوم الكشف إذا بدأت العلاج في نفس اليوم. يؤكد الطبيب السعر النهائي للحالات المعقدة بعد الفحص.$$, 'manual', 'pending'),

('services', 'en', 'services', 'Our services and doctors',
$$Services: check-ups, professional cleaning, tooth-coloured fillings, extractions, root canal treatment, in-clinic whitening, children's dentistry and braces consultations.
Dr. Sarah Mansour (dentist, founder) handles check-ups, fillings, root canals, whitening and braces consultations.
Dr. Karim Adel (dentist) handles check-ups, fillings, extractions and children's check-ups.
Nadia Fawzy (dental hygienist) handles teeth cleaning and children's check-ups.
When booking, you choose the doctor; the assistant shows only the services each doctor offers.$$, 'manual', 'pending'),
('services', 'ar', 'services', 'خدماتنا وأطباؤنا',
$$الخدمات: الكشف، التنظيف الاحترافي، الحشو التجميلي، الخلع، علاج العصب، تبييض الأسنان داخل العيادة، طب أسنان الأطفال، واستشارات التقويم.
د. سارة منصور (طبيبة أسنان ومؤسسة العيادة): الكشف والحشو وعلاج العصب والتبييض واستشارات التقويم.
د. كريم عادل (طبيب أسنان): الكشف والحشو والخلع وكشف الأطفال.
نادية فوزي (أخصائية صحة الفم): تنظيف الأسنان وكشف الأطفال.
عند الحجز تختار الطبيب، ويعرض المساعد فقط الخدمات التي يقدمها كل طبيب.$$, 'manual', 'pending'),

('insurance-payment', 'en', 'insurance', 'Insurance and payment',
$$We accept cash, debit and credit cards (Visa, Mastercard, Meeza), InstaPay and mobile wallets.
We work with these insurance and medical networks: NileCare Health, Delta Shield Insurance and Horus Medical Network. Please bring your insurance card and national ID to every visit. Coverage depends on your plan; our front desk checks it before treatment.
Installment plans are available for treatments above 3,000 EGP through bank cards that support installments.$$, 'manual', 'pending'),
('insurance-payment', 'ar', 'insurance', 'التأمين وطرق الدفع',
$$نقبل الدفع نقدًا وبالبطاقات (فيزا، ماستركارد، ميزة) وإنستاباي والمحافظ الإلكترونية.
نتعامل مع شركات التأمين والشبكات الطبية التالية: نايل كير هيلث، دلتا شيلد للتأمين، وشبكة حورس الطبية. برجاء إحضار كارت التأمين وبطاقة الرقم القومي في كل زيارة. التغطية حسب وثيقتك، ويتحقق منها مكتب الاستقبال قبل العلاج.
يتوفر التقسيط للعلاجات التي تزيد عن ٣٠٠٠ جنيه عبر البطاقات البنكية التي تدعم التقسيط.$$, 'manual', 'pending'),

('booking-policies', 'en', 'policies', 'Booking, cancellation and late arrival',
$$To book, the assistant needs your full name, date of birth, and an email address or phone number. Booking also creates your patient account automatically.
You can cancel or reschedule yourself up to 24 hours before the appointment, through the assistant or your account. Within 24 hours, please call the clinic.
If you arrive more than 15 minutes late, we may need to move you to the next free time.
Please arrive 10 minutes early for your first visit.$$, 'manual', 'pending'),
('booking-policies', 'ar', 'policies', 'الحجز والإلغاء والتأخير',
$$للحجز يحتاج المساعد اسمك بالكامل وتاريخ ميلادك وبريدك الإلكتروني أو رقم هاتفك. ويتم إنشاء حسابك كمريض تلقائيًا عند الحجز.
يمكنك الإلغاء أو تغيير الموعد بنفسك حتى ٢٤ ساعة قبل الموعد عن طريق المساعد أو حسابك. وخلال الـ٢٤ ساعة الأخيرة برجاء الاتصال بالعيادة.
إذا تأخرت أكثر من ١٥ دقيقة فقد نحتاج لنقلك إلى أقرب موعد متاح.
برجاء الحضور قبل الموعد بـ١٠ دقائق في زيارتك الأولى.$$, 'manual', 'pending'),

('sign-in', 'en', 'faq', 'Your patient account and signing in',
$$Your account is created when you book. You are signed in right away on the device you booked from.
Next time, you can sign in in three ways: with your email (we send you a one-time code), with your phone number plus your full name and date of birth, or with the personal code from your confirmation email.
In your account you can see upcoming and past appointments and cancel up to 24 hours before.$$, 'manual', 'pending'),
('sign-in', 'ar', 'faq', 'حسابك وتسجيل الدخول',
$$يتم إنشاء حسابك عند الحجز، ويتم تسجيل دخولك مباشرة على الجهاز الذي حجزت منه.
في المرة القادمة يمكنك تسجيل الدخول بثلاث طرق: بالبريد الإلكتروني (نرسل لك رمزًا لمرة واحدة)، أو برقم الهاتف مع اسمك بالكامل وتاريخ ميلادك، أو بالرمز الشخصي الموجود في بريد التأكيد.
من حسابك يمكنك رؤية المواعيد القادمة والسابقة والإلغاء حتى ٢٤ ساعة قبل الموعد.$$, 'manual', 'pending'),

('before-after-care', 'en', 'prep', 'Before and after your visit',
$$Before your visit: brush your teeth, bring any previous X-rays and a list of medicines you take, and tell us if you are pregnant or have a heart condition, diabetes or allergies.
After a cleaning: avoid coffee, tea and coloured drinks for 2 hours.
After a filling: wait until the numbness wears off before eating, usually 2 to 3 hours.
After an extraction: bite on the gauze for 30 minutes, do not rinse or use a straw for 24 hours, and eat soft, cool food.
After whitening: avoid coffee, tea, cola and smoking for 48 hours.$$, 'manual', 'pending'),
('before-after-care', 'ar', 'prep', 'قبل الزيارة وبعدها',
$$قبل الزيارة: اغسل أسنانك، وأحضر أي أشعة سابقة وقائمة بالأدوية التي تتناولها، وأخبرنا إذا كنتِ حاملًا أو لديك مرض بالقلب أو السكر أو أي حساسية.
بعد التنظيف: تجنب القهوة والشاي والمشروبات الملونة لمدة ساعتين.
بعد الحشو: انتظر حتى يزول أثر التخدير قبل الأكل، عادةً من ساعتين إلى ٣ ساعات.
بعد الخلع: اضغط على الشاش لمدة ٣٠ دقيقة، ولا تتمضمض ولا تستخدم الشفاطة لمدة ٢٤ ساعة، وتناول طعامًا لينًا وباردًا.
بعد التبييض: تجنب القهوة والشاي والمياه الغازية والتدخين لمدة ٤٨ ساعة.$$, 'manual', 'pending'),

('urgent-care', 'en', 'faq', 'Dental emergencies',
$$The online assistant cannot give medical advice. For severe pain, swelling, bleeding that does not stop, or a knocked-out tooth, call the clinic right away at +20 100 555 0123; we keep same-day slots for emergencies when possible.
If you have difficulty breathing or swallowing, or swelling spreading to the eye or neck, go to the nearest hospital emergency department immediately.$$, 'manual', 'pending'),
('urgent-care', 'ar', 'faq', 'حالات الطوارئ',
$$لا يستطيع المساعد الذكي تقديم نصائح طبية. في حالة الألم الشديد أو التورم أو النزيف المستمر أو سقوط سن، اتصل بالعيادة فورًا على الرقم ‎+20 100 555 0123‎، ونحاول توفير مواعيد في نفس اليوم للطوارئ.
إذا كان لديك صعوبة في التنفس أو البلع أو تورم يمتد إلى العين أو الرقبة، توجه فورًا إلى أقرب قسم طوارئ في مستشفى.$$, 'manual', 'pending')
on conflict (group_key, language) do update set
  category = excluded.category,
  title = excluded.title,
  content = excluded.content,
  ingest_status = case
    when public.knowledge_docs.content is distinct from excluded.content then 'pending'::public.ingest_status
    else public.knowledge_docs.ingest_status
  end;

-- ---------------------------------------------------------------- sample patients & bookings
-- Booked through book_appointment (same rules as real bookings). Times move with the
-- calendar: the next working days after today. Re-runs replay via idempotency keys.
do $$
declare
  v_day   date;
  v_days  date[] := array[]::date[];
  v_offset integer := 1;
  v_row   record;
begin
  while coalesce(array_length(v_days, 1), 0) < 5 loop
    v_day := (now() at time zone 'Africa/Cairo')::date + v_offset;
    if extract(dow from v_day) <> 5 then  -- skip Fridays
      v_days := v_days || v_day;
    end if;
    v_offset := v_offset + 1;
  end loop;

  for v_row in
    select * from (values
      -- day index, time, staff, service, name, date of birth, email, phone, language, key
      (1, time '10:00', '5eed0000-0000-4000-a000-000000000103', '5eed0000-0000-4000-a000-000000000202', 'Mariam Hassan', date '1992-04-15', null, '+201000000001', 'ar', 'seed-1'),
      (1, time '12:30', '5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000203', 'Omar Khaled', date '1988-11-02', 'omar.khaled@example.com', null, 'en', 'seed-2'),
      (2, time '11:00', '5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000206', 'Laila Ibrahim', date '1995-07-21', 'laila.ibrahim@example.com', '+201000000003', 'en', 'seed-3'),
      (2, time '14:00', '5eed0000-0000-4000-a000-000000000102', '5eed0000-0000-4000-a000-000000000207', 'Youssef Samir', date '2016-02-10', null, '+201000000004', 'ar', 'seed-4'),
      (3, time '10:30', '5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000205', 'Hana Mostafa', date '1979-09-30', 'hana.mostafa@example.com', null, 'ar', 'seed-5'),
      (4, time '15:00', '5eed0000-0000-4000-a000-000000000101', '5eed0000-0000-4000-a000-000000000208', 'Ahmed Fathy', date '2001-12-05', 'ahmed.fathy@example.com', '+201000000006', 'en', 'seed-6'),
      (5, time '13:00', '5eed0000-0000-4000-a000-000000000103', '5eed0000-0000-4000-a000-000000000202', 'Omar Khaled', date '1988-11-02', 'omar.khaled@example.com', null, 'en', 'seed-7')
    ) as t(day_index, at_time, staff_id, service_id, full_name, dob, email, phone, lang, key)
  loop
    perform public.book_appointment(
      p_service_id         => v_row.service_id::uuid,
      p_staff_id           => v_row.staff_id::uuid,
      p_starts_at          => (v_days[v_row.day_index] + v_row.at_time) at time zone 'Africa/Cairo',
      p_full_name          => v_row.full_name,
      p_date_of_birth      => v_row.dob,
      p_email              => v_row.email,
      p_phone              => v_row.phone,
      p_preferred_language => v_row.lang::public.lang,
      p_source             => 'patient_assistant',
      p_idempotency_key    => v_row.key
    );
  end loop;
end;
$$;

-- Visit history for the demo patient (Mariam): a completed cleaning last month.
insert into public.appointments (patient_id, staff_id, service_id, starts_at, ends_at, status, source, idempotency_key)
select p.id, '5eed0000-0000-4000-a000-000000000103', '5eed0000-0000-4000-a000-000000000202',
       date_trunc('day', now() - interval '30 days') + interval '9 hours',
       date_trunc('day', now() - interval '30 days') + interval '9 hours',
       'completed', 'dashboard', 'seed-history-1'
from public.patients p
where p.phone = '+201000000001'
on conflict (idempotency_key) do nothing;

-- One open escalation so the staff queue isn't empty.
insert into public.escalations (id, patient_id, reason, urgency, status)
select '5eed0000-0000-4000-a000-000000000301', p.id,
       'Patient reports throbbing pain and swelling since yesterday; asked which painkiller to take. Assistant did not advise and escalated.',
       'high', 'open'
from public.patients p
where p.email = 'hana.mostafa@example.com'
on conflict (id) do nothing;
