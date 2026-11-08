-- ============================================================
-- YAS Workforce — تفعيل التحديث اللحظي (Supabase Realtime)
-- إضافي (additive) وآمن للتشغيل أكثر من مرة (idempotent).
--
-- الجداول:
--   notifications       → جرح الإشعارات في الهيدر (مقروء/جديد)
--   laptops             → مسار اللاب ولوحة الإدارة (حالة اللاب)
--   production_entries  → لوحة المشرف والإدخالات (حالة الإدخال)
--
-- من غير الملف ده، القنوات في الواجهة مش هتستقبل أحداث،
-- والجرس هيعتمد بس على تحديث دوري كل دقيقة.
-- ============================================================

-- 1) إضافة الجداول لمنشور Realtime (لو مش مضافة أصلاً)
do $$
declare
  t text;
begin
  foreach t in array array['notifications', 'laptops', 'production_entries']
  loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 2) replica identity = full عشان أحداث UPDATE تبعث الصف كامل
--    (تعليم الإشعار كمقروء، تغيّر حالة اللاب/الإدخال) والفلترة تشتغل صح.
alter table public.notifications       replica identity full;
alter table public.laptops             replica identity full;
alter table public.production_entries  replica identity full;

-- ============================================================
-- ملاحظة: Supabase Dashboard فيه نفس المفتاح من
-- Database → Replication → supabase_realtime → أضِف الجداول.
-- الملف ده بيعمل نفس الحاجة برمجيًا (يُشغّل مرة واحدة في SQL Editor).
-- ============================================================
