-- ============================================================
-- YAS Workforce — تنظيف الداتا التجريبية (Demo data cleanup)
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================
-- بيمسح إدخالات الإنتاج التجريبية + كل ما هو مرتبط بيها تلقائيًا
-- (entry_operations / lap_serials / attachments / approvals عندها on delete cascade).
-- ما بيمسش الحسابات ولا العمليات.

-- 1) معاينة: الإدخالات الحالية قبل الحذف
select
  e.id,
  p.full_name        as worker,
  p.role,
  o.name_ar          as operation,
  e.quantity,
  e.status,
  e.entry_date,
  e.notes,
  e.created_at
from public.production_entries e
join public.profiles  p on p.id = e.worker_id
join public.operations o on o.id = e.operation_id
order by e.created_at;

-- 2) الحذف
delete from public.production_entries;

-- 3) (اختياري) لو عايز تغيّر أسماء العمليات اللي شكلها تجريبي:
-- update public.operations set name_ar = 'اختبار خفيف' where name_en = 'light_test';
-- update public.operations set name_ar = 'اختبار تقيل' where name_en = 'heavy_test';

-- 4) تأكيد: لازم ترجع 0
select count(*) as remaining_entries from public.production_entries;
