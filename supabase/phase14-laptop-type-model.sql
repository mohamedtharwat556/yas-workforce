-- ============================================================
-- YAS Workforce — المرحلة 14: نوع اللاب والموديل
-- - إضافة عمود النوع (laptop_type) والموديل (model) لكل لاب داخل الإدخال.
-- - إضافة عمود stage_code (وجهة اللاب/المشكلة داخل الإدخال، ولو سليم بيبقى null).
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

alter table public.lap_serials add column if not exists laptop_type text;
alter table public.lap_serials add column if not exists model text;
alter table public.lap_serials add column if not exists stage_code text;

-- نبلّغ PostgREST إنه يعمل تحديث للـ schema cache عشان الأعمدة الجديدة تبان فورًا
notify pgrst, 'reload schema';
