-- ============================================================
-- phase19: «نوع التاست» لكل لاب
-- كل سطر لاب بيعرف العملية اللي اتعمل فيها (Test خفيف / Test تقيل /
-- صيانة خفيفة / صيانة تقيلة / تجميع) عشان المشرف يشوف اللاب ده أنهي تاست.
--
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) عمود العملية على سطر اللاب
alter table public.lap_serials
  add column if not exists operation_id bigint references public.operations(id) on delete set null;

create index if not exists lap_serials_operation_id_idx
  on public.lap_serials (operation_id);

-- 2) تعبئة الصفوف القديمة (احتياطي): نوزّع لابات كل إدخال على بنود عملياته
--    حسب ترتيب الأعداد — الصفوف الجديدة بتتسجّل من الواجهة مباشرة.
with serials_ordered as (
  select s.id as serial_id,
         s.entry_id,
         row_number() over (partition by s.entry_id order by s.created_at, s.serial) as rn
    from public.lap_serials s
   where s.operation_id is null
),
lines as (
  select eo.entry_id,
         eo.operation_id,
         eo.quantity,
         coalesce(
           sum(eo.quantity) over (
             partition by eo.entry_id
             order by eo.operation_id
             rows between unbounded preceding and 1 preceding
           ), 0
         ) as before_qty
    from public.entry_operations eo
)
update public.lap_serials s
   set operation_id = l.operation_id
  from serials_ordered so
  join lines l
    on l.entry_id = so.entry_id
   and so.rn > l.before_qty
   and so.rn <= l.before_qty + l.quantity
 where s.id = so.serial_id;

notify pgrst, 'reload schema';
