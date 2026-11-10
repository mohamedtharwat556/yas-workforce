-- ============================================================
-- YAS Workforce — المرحلة 15: دورة الصيانة وإعادة الاختبار
-- - عمود حالة الصيانة لكل لاب داخل الإدخال (maintenance_status).
-- - تعديل الفهرس الفريد: نفس السيريال يقدر يتكرر في إدخالات مختلفة
--   (عشان الموظف يقدر يعمل تست جديد لنفس اللاب بعد الصيانة).
-- - fn_finish_maintenance: المشرف يخلّص صيانة لاب → يرجع للموظف للاختبار.
-- - fn_maintenance_queue: طابور «طلبات تحت الصيانة» للمشرف.
-- - fn_worker_retest_queue: اللابات اللي رجعت للموظف عشان يعيد اختبارها.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) أعمدة حالة الصيانة على lap_serials
--    maintenance_status = null يعني اللاب مش تحت الصيانة (سليم أو وجهة عادية).
-- ============================================================
alter table public.lap_serials add column if not exists maintenance_status text;
alter table public.lap_serials add column if not exists maintenance_done_at timestamptz;
alter table public.lap_serials add column if not exists maintenance_done_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lap_serials_maintenance_status_chk') then
    alter table public.lap_serials
      add constraint lap_serials_maintenance_status_chk
      check (maintenance_status is null or maintenance_status in ('in_maintenance', 'returned_to_worker'));
  end if;
end $$;

-- ============================================================
-- 2) الفهرس الفريد: من (serial, direction) إلى (entry_id, serial, direction)
--    عشان نفس اللاب يظهر في أكتر من إدخال (اختبار → صيانة → اختبار جديد).
-- ============================================================
drop index if exists public.lap_serials_unique;
create unique index if not exists lap_serials_entry_unique
  on public.lap_serials (entry_id, serial, direction);

-- ============================================================
-- 3) وجهات الصيانة = كل الوجهات ما عدا «تجميع» و«جاهز للإصدار»
--    (مستخدمة جوه الدوال تحت)
-- ============================================================

-- ============================================================
-- 4) إتمام الصيانة (المشرف/الحسابات) → اللاب يرجع للموظف يعمل تست جديد
-- ============================================================
create or replace function public.fn_finish_maintenance(p_serial_id uuid)
returns public.lap_serials
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lap_serials;
  v_laptop_id uuid;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'إتمام الصيانة متاح للمشرف فقط';
  end if;

  select * into v from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v.stage_code is null or v.stage_code in ('assembly','ready_for_release') then
    raise exception 'اللاب ده مش مسجّل تحت الصيانة';
  end if;
  if v.maintenance_status = 'returned_to_worker' then
    raise exception 'الصيانة اتخلصت بالفعل واللاب رجع للموظف';
  end if;

  update public.lap_serials
     set maintenance_status = 'returned_to_worker',
         maintenance_done_at = now(),
         maintenance_done_by = auth.uid()
   where id = p_serial_id
   returning * into v;

  -- اللاب يرجع لمرحلة «اختبار» في مساره عشان الموظف يعمله تست من جديد
  select id into v_laptop_id from public.laptops where serial = v.serial;
  if v_laptop_id is not null then
    update public.laptops
       set current_stage = 'test',
           current_status = 'in_progress',
           updated_at = now()
     where id = v_laptop_id;
  end if;

  perform public.fn_audit('finish_maintenance', 'lap_serials', p_serial_id, null, to_jsonb(v));
  return v;
end;
$$;

-- ============================================================
-- 5) طابور «طلبات تحت الصيانة» (المشرف) — كل لاب لسه مستني صيانة
-- ============================================================
create or replace function public.fn_maintenance_queue()
returns table (
  serial_id uuid,
  entry_id uuid,
  serial text,
  laptop_type text,
  model text,
  dest_code text,
  worker_name text,
  entry_date date,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.entry_id, s.serial, s.laptop_type, s.model, s.stage_code,
         p.full_name, e.entry_date, s.created_at
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.profiles p on p.id = e.worker_id
   where public.current_role() in ('supervisor','accountant')
     and s.stage_code is not null
     and s.stage_code not in ('assembly','ready_for_release')
     and coalesce(s.maintenance_status, 'in_maintenance') = 'in_maintenance'
   order by s.created_at desc;
$$;

-- ============================================================
-- 6) طابور إعادة الاختبار (الموظف) — اللابات اللي رجعت له من الصيانة
--    بترجع لحد ما يسجّل إدخال جديد بنفس السيريال (يعمل تست جديد).
-- ============================================================
create or replace function public.fn_worker_retest_queue()
returns table (
  serial_id uuid,
  serial text,
  laptop_type text,
  model text,
  dest_code text,
  done_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.serial, s.laptop_type, s.model, s.stage_code, s.maintenance_done_at
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
   where e.worker_id = auth.uid()
     and s.maintenance_status = 'returned_to_worker'
     and not exists (
       select 1 from public.lap_serials s2
        where s2.serial = s.serial
          and s2.id <> s.id
          and s2.created_at > coalesce(s.maintenance_done_at, s.created_at)
     )
   order by s.maintenance_done_at desc nulls last;
$$;

-- ============================================================
-- 7) الصلاحيات
-- ============================================================
revoke all on function public.fn_finish_maintenance(uuid) from public, anon;
revoke all on function public.fn_maintenance_queue() from public, anon;
revoke all on function public.fn_worker_retest_queue() from public, anon;
grant execute on function public.fn_finish_maintenance(uuid) to authenticated;
grant execute on function public.fn_maintenance_queue() to authenticated;
grant execute on function public.fn_worker_retest_queue() to authenticated;

notify pgrst, 'reload schema';
