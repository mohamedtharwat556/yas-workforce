-- ============================================================
-- YAS Workforce — المرحلة 9: تنضيف كامل (إزالة الأوزان + محرك الحوافز المالي)
-- شغّل الملف ده في: Supabase Dashboard -> SQL Editor -> New query
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================
-- ليه بنعمل ده؟
--   * الأوزان (weight) كانت بتدخل في حساب "وحدات مرجّحة" اللي مبقاش له لازمة.
--   * محرك الحوافز المالي (سعر الوحدة + الكشوف + التسويات + إغلاق الشهر)
--     كان كود ميت: الواجهة مش بتنادي أي دالة منه خالص.
--   * القرار: شيل كل ده من الفرونت + القاعدة عشان نبدأ نضاف.
-- ============================================================

begin;

-- 1) أعمدة على جدول العمليات (الوزن + سعر الوحدة)
alter table public.operations drop column if exists weight;
alter table public.operations drop column if exists unit_value;

-- 2) دوال محرك الحوافز الميت
drop function if exists public.fn_calculate_incentive(date, date);
drop function if exists public.fn_period_report(date, date);
drop function if exists public.fn_close_month(int, int);
drop function if exists public.fn_reopen_month(int, int);
drop function if exists public.fn_add_adjustment(uuid, uuid, numeric, text);

-- 3) جداول محرك الحوافز الميت (بالترتيب: الأبناء قبل الآباء)
drop table if exists public.incentive_adjustments cascade;
drop table if exists public.incentive_snapshots  cascade;
drop table if exists public.incentive_periods    cascade;
drop table if exists public.incentive_rules      cascade;

commit;
