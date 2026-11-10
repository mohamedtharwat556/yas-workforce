-- ============================================================
-- YAS Workforce — المرحلة 17: إكمال دورة الصيانة وإعادة الاختبار
-- - fn_finish_maintenance: يبعت إشعار للموظف صاحب اللاب لما الصيانة تخلص.
-- - fn_worker_retest_queue: بترجّع كمان اسم المشرف اللي خلّص الصيانة.
-- - fn_worker_retest_problem: الموظف يقول «لسه فيه مشكلة» → اللاب يرجع للصيانة تاني.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) إتمام الصيانة (المشرف/الحسابات) + إشعار الموظف صاحب اللاب
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
  v_worker_id uuid;
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

  -- إشعار للموظف صاحب اللاب إن اللاب رجع له يعمل تست من جديد
  select e.worker_id into v_worker_id
    from public.production_entries e where e.id = v.entry_id;

  perform public.fn_notify(
    v_worker_id, 'maintenance_done', 'لاب رجع من الصيانة',
    'السيريال: ' || v.serial || ' — خلّصنا الصيانة، اعمل له إعادة اختبار.'
  );

  perform public.fn_audit('finish_maintenance', 'lap_serials', p_serial_id, null, to_jsonb(v));
  return v;
end;
$$;

-- ============================================================
-- 2) طابور إعادة الاختبار (الموظف) + اسم اللي خلّص الصيانة
--    لازم نحذف الدالة الأول لأن نوع الإرجاع اتغير.
-- ============================================================
drop function if exists public.fn_worker_retest_queue();

create function public.fn_worker_retest_queue()
returns table (
  serial_id uuid,
  serial text,
  laptop_type text,
  model text,
  dest_code text,
  done_at timestamptz,
  done_by_name text
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.serial, s.laptop_type, s.model, s.stage_code, s.maintenance_done_at,
         p.full_name
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.profiles p on p.id = s.maintenance_done_by
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
-- 3) «لسه فيه مشكلة»: الموظف يرجّع اللاب للصيانة تاني
-- ============================================================
create or replace function public.fn_worker_retest_problem(p_serial_id uuid)
returns public.lap_serials
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.lap_serials;
  v_before jsonb;
  v_laptop_id uuid;
begin
  if public.current_role() <> 'worker' then
    raise exception 'ده متاح للموظف فقط';
  end if;

  select * into v from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v.maintenance_status <> 'returned_to_worker' then
    raise exception 'اللاب مش في انتظار إعادة الاختبار';
  end if;
  if not exists (
    select 1 from public.production_entries e
     where e.id = v.entry_id and e.worker_id = auth.uid()
  ) then
    raise exception 'غير مسموح';
  end if;

  v_before := to_jsonb(v);

  -- اللاب يرجع تحت الصيانة من تاني
  update public.lap_serials
     set maintenance_status = 'in_maintenance',
         maintenance_done_at = null,
         maintenance_done_by = null
   where id = p_serial_id
   returning * into v;

  select id into v_laptop_id from public.laptops where serial = v.serial;
  if v_laptop_id is not null then
    update public.laptops
       set current_stage = coalesce(v.stage_code, current_stage),
           current_status = 'in_progress',
           updated_at = now()
     where id = v_laptop_id;
  end if;

  perform public.fn_notify_role(
    'supervisor', 'retest_problem', 'لاب لسه فيه مشكلة بعد الصيانة',
    'السيريال: ' || v.serial || ' — الموظف عمل تست وطلع لسه فيه مشكلة، محتاج صيانة تاني.',
    auth.uid()
  );

  perform public.fn_audit('worker_retest_problem', 'lap_serials', p_serial_id, v_before, to_jsonb(v));
  return v;
end;
$$;

-- ============================================================
-- 4) الصلاحيات
-- ============================================================
revoke all on function public.fn_finish_maintenance(uuid) from public, anon;
revoke all on function public.fn_worker_retest_queue() from public, anon;
revoke all on function public.fn_worker_retest_problem(uuid) from public, anon;
grant execute on function public.fn_finish_maintenance(uuid) to authenticated;
grant execute on function public.fn_worker_retest_queue() to authenticated;
grant execute on function public.fn_worker_retest_problem(uuid) to authenticated;

notify pgrst, 'reload schema';
