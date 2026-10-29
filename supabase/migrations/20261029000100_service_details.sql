-- Frontend: the service detail page shows "What to expect" for each treatment.
-- One step per line, so the owner can edit it as plain text in the admin screen.

alter table public.services
  add column details_en text,
  add column details_ar text;

-- Fill the 8 demo services that already exist (seed.sql has the same text for fresh installs).
update public.services set
  details_en = $$We ask about your general health and any pain or worries.
The dentist examines every tooth, your gums and your bite.
X-rays are taken only when they are needed.
You leave with a clear treatment plan and its prices, with no pressure to start the same day.$$,
  details_ar = $$نسألك عن صحتك العامة وأي ألم أو قلق تشعر به.
يفحص الطبيب جميع الأسنان واللثة وطريقة الإطباق.
نُجري الأشعة فقط عند الحاجة إليها.
تحصل على خطة علاج واضحة بأسعارها، دون أي التزام بالبدء في نفس اليوم.$$
where id = '5eed0000-0000-4000-a000-000000000201';

update public.services set
  details_en = $$A quick check of your gums before we start.
Tartar is removed gently with an ultrasonic scaler.
Your teeth are polished smooth, so new stains build up more slowly.
You get simple tips for brushing and flossing at home.$$,
  details_ar = $$فحص سريع للثة قبل البدء.
إزالة الجير بلطف بجهاز الموجات فوق الصوتية.
تلميع الأسنان لتصبح ناعمة فتقل البقع الجديدة.
نصائح بسيطة للتفريش واستخدام الخيط في المنزل.$$
where id = '5eed0000-0000-4000-a000-000000000202';

update public.services set
  details_en = $$The tooth is numbed, so you feel no pain.
The decay is cleaned out carefully.
A tooth-coloured filling is added in layers and hardened with a blue light.
The filling is shaped and polished so your bite feels natural. You can eat once the numbness wears off.$$,
  details_ar = $$تخدير السن حتى لا تشعر بأي ألم.
إزالة التسوس بعناية.
وضع حشو بلون الأسنان على طبقات وتثبيته بضوء أزرق.
تشكيل الحشو وتلميعه ليكون الإطباق طبيعيًا، ويمكنك الأكل بعد زوال التخدير.$$
where id = '5eed0000-0000-4000-a000-000000000203';

update public.services set
  details_en = $$The dentist checks the tooth and explains why it needs to come out.
The area is numbed with a local anaesthetic.
The tooth is loosened and removed gently.
You bite on gauze to stop the bleeding and go home with written aftercare advice.$$,
  details_ar = $$يفحص الطبيب السن ويشرح سبب الحاجة إلى خلعه.
تخدير المنطقة بمخدر موضعي.
تحريك السن وخلعه بلطف.
تضغط على قطعة شاش لوقف النزيف، وتحصل على تعليمات مكتوبة للعناية بعد الخلع.$$
where id = '5eed0000-0000-4000-a000-000000000204';

update public.services set
  details_en = $$The tooth is numbed and kept dry with a small rubber sheet.
The infected nerve is removed and the canals are cleaned and shaped.
The canals are filled and sealed to keep bacteria out.
A temporary filling closes the tooth. A crown is usually advised later (not included in this price).$$,
  details_ar = $$تخدير السن وعزله بغطاء مطاطي صغير ليبقى جافًا.
إزالة العصب الملتهب وتنظيف القنوات وتشكيلها.
حشو القنوات وإغلاقها لمنع دخول البكتيريا.
حشو مؤقت لإغلاق السن، وغالبًا ننصح بتركيبة لاحقًا (لا يشملها هذا السعر).$$
where id = '5eed0000-0000-4000-a000-000000000205';

update public.services set
  details_en = $$We check your teeth and gums first: whitening is only for healthy teeth.
Your gums are protected with a soft barrier.
A whitening gel is applied and activated in short rounds.
You see the new shade the same day and get tips to keep it longer.$$,
  details_ar = $$نفحص الأسنان واللثة أولًا، فالتبييض مناسب للأسنان السليمة فقط.
حماية اللثة بطبقة عازلة ناعمة.
وضع جل التبييض وتنشيطه على جولات قصيرة.
ترى اللون الجديد في نفس اليوم، مع نصائح للحفاظ عليه مدة أطول.$$
where id = '5eed0000-0000-4000-a000-000000000206';

update public.services set
  details_en = $$A friendly first chat, so your child feels at ease.
The dentist checks each tooth and how the teeth are growing.
A fluoride coat is painted on to protect against decay.
Parents get simple advice on brushing, snacks and the next visit.$$,
  details_ar = $$حديث ودي في البداية ليشعر طفلك بالراحة.
يفحص الطبيب كل سن وطريقة نمو الأسنان.
دهان طبقة فلورايد لحماية الأسنان من التسوس.
نصائح بسيطة للوالدين عن التفريش والوجبات الخفيفة وموعد الزيارة القادمة.$$
where id = '5eed0000-0000-4000-a000-000000000207';

update public.services set
  details_en = $$The dentist checks your teeth, bite and jaw.
Photos (and X-rays if needed) show how your teeth line up.
We compare the options: metal braces, clear braces or clear aligners.
You get an estimated treatment time and cost for each option.$$,
  details_ar = $$يفحص الطبيب الأسنان والإطباق والفك.
صور (وأشعة عند الحاجة) توضح ترتيب أسنانك.
نقارن بين الخيارات: تقويم معدني، أو تقويم شفاف، أو مصففات شفافة.
تحصل على المدة والتكلفة التقريبية لكل خيار.$$
where id = '5eed0000-0000-4000-a000-000000000208';
