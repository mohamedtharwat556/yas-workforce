-- ============================================================
-- YAS Workforce — المرحلة 3 (تكملة): الإشعارات داخل التطبيق
-- إضافي فقط (additive) — آمن للتشغيل أكثر من مرة (idempotent).
-- بيفترض إن جدول public.notifications موجود من المرحلة 1.
--
-- الفكرة: الإشعارات بتتولّد من جوه دوال الـ RPC (security definer)
-- فبتتجاوز الـ RLS — ولذلك مفيش INSERT policy مفتوحة للمستخدمين
-- (عشان محدش يقدر يزوّر إشعارات لغيره).
-- ============================================================

-- ============================================================
-- 1) الدوال المساعدة لإنشاء الإشعارات
-- ============================================================

-- إشعار مستخدم واحد
create or replace function public.fn_notify(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications(user_id, type, title, body)
  values (p_user_id, p_type, p_title, p_body);
end;
$$;

-- إشعار كل مستخدمي دور معيّن (النشطين بس)، مع إمكانية استثناء شخص
create or replace function public.fn_notify_role(
  p_role text,
  p_type text,
  p_title text,
  p_body text default null,
  p_exclude uuid default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications(user_id, type, title, body)
  select p.id, p_type, p_title, p_body
    from public.profiles p
   where p.role = p_role
     and p.status = 'active'
     and p.id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid);
$$;

-- ============================================================
-- 2) ربط الإشعارات بتدفّق العمل (إعادة تعريف الدوال نفسها + الإشعار)
-- ============================================================

-- 2.1 تسجيل/تقديم إدخال (العامل) → إشعار المشرفين
create or replace function public.fn_submit_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
begin
  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.worker_id <> auth.uid() then raise exception 'غير مسموح'; end if;
  if v.status <> 'draft' then raise exception 'الإدخال مش مسودّة (%).', v.status; end if;

  update public.production_entries
    set status = 'submitted', submitted_at = now()
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('submit_entry','production_entries',p_entry_id,null,to_jsonb(v));

  perform public.fn_notify_role(
    'supervisor', 'entry_submitted', 'إدخال جديد بانتظار المراجعة',
    'من: ' || coalesce((select full_name from public.profiles where id = v.worker_id), 'عامل')
      || ' · تاريخ: ' || to_char(v.entry_date, 'YYYY-MM-DD'),
    v.worker_id
  );

  return v;
end;
$$;

-- 2.2 مراجعة المشرف على إدخال (approve/reject) → إشعار العامل
create or replace function public.fn_review_entry(
  p_entry_id uuid, p_decision text, p_reason text default null
) returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
  v_before jsonb;
begin
  if public.current_role() <> 'supervisor' then
    raise exception 'المراجعة للمشرف فقط';
  end if;
  if p_decision not in ('approved','rejected') then
    raise exception 'قرار غير صحيح: %', p_decision;
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.status not in ('draft','submitted') then
    raise exception 'الإدخال مش في حالة تسمح بالمراجعة (%).', v.status;
  end if;

  v_before := to_jsonb(v);

  if p_decision = 'approved' then
    update public.production_entries
      set status='approved', reviewed_by=auth.uid(), reviewed_at=now(),
          submitted_at = coalesce(submitted_at, now())
      where id = p_entry_id returning * into v;
  else
    update public.production_entries
      set status='returned', return_reason=p_reason,
          returned_by=auth.uid(), returned_at=now()
      where id = p_entry_id returning * into v;
  end if;

  insert into public.approvals(record_id, decision, reason, actor_id)
    values (p_entry_id, p_decision, p_reason, auth.uid());

  perform public.fn_audit('review_entry:'||p_decision,'production_entries',p_entry_id,v_before,to_jsonb(v));

  if p_decision = 'approved' then
    perform public.fn_notify(
      v.worker_id, 'entry_approved', 'تم اعتماد إدخالك',
      'تاريخ الإدخال: ' || to_char(v.entry_date, 'YYYY-MM-DD')
    );
  else
    perform public.fn_notify(
      v.worker_id, 'entry_returned', 'تم إرجاع إدخالك للمراجعة',
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'بدون سبب محدد')
    );
  end if;

  return v;
end;
$$;

-- 2.3 اعتماد المشرف النهائي على اللاب → إشعار المحاسبين (جاهز للإصدار)
create or replace function public.fn_approve_laptop(p_laptop_id uuid)
returns public.laptops
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.laptops;
  v_missing text;
begin
  if public.current_role() <> 'supervisor' then
    raise exception 'الاعتماد للمشرف فقط';
  end if;

  select * into v from public.laptops where id = p_laptop_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;

  select string_agg(s.name_ar, ', ')
    into v_missing
    from public.stages s
   where s.is_mandatory and s.active
     and not exists (
       select 1 from public.laptop_movements m
        where m.laptop_id = p_laptop_id and m.stage_code = s.code
     );
  if v_missing is not null then
    raise exception 'لسه مراحل إلزامية ناقصة: %', v_missing;
  end if;

  update public.laptops
    set approved_by=auth.uid(), approved_at=now(), current_status='awaiting_release'
    where id = p_laptop_id returning * into v;

  perform public.fn_audit('approve_laptop','laptops',p_laptop_id,null,to_jsonb(v));

  perform public.fn_notify_role(
    'accountant', 'laptop_awaiting_release', 'لاب جاهز للإصدار',
    'السيريال: ' || v.serial
  );

  return v;
end;
$$;

-- 2.4 إصدار اللاب (الحسابات) → إشعار المشرف + العمال أصحاب الإدخالات
create or replace function public.fn_release_laptop(
  p_laptop_id uuid, p_decision text, p_reason text default null
) returns public.laptops
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.laptops;
  v_missing text;
  v_pending int;
  v_before jsonb;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'الإصدار للحسابات فقط';
  end if;
  if p_decision not in ('released','returned') then
    raise exception 'قرار غير صحيح: %', p_decision;
  end if;

  select * into v from public.laptops where id = p_laptop_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v.current_status = 'released' then raise exception 'اللاب مُصدر بالفعل'; end if;

  v_before := to_jsonb(v);

  if p_decision = 'released' then
    -- 1) كل المراحل الإلزامية مُسجَّلة؟
    select string_agg(s.name_ar, ', ')
      into v_missing
      from public.stages s
     where s.is_mandatory and s.active
       and not exists (
         select 1 from public.laptop_movements m
          where m.laptop_id = p_laptop_id and m.stage_code = s.code
       );
    if v_missing is not null then
      raise exception 'لسه مراحل إلزامية ناقصة: %', v_missing;
    end if;

    -- 2) كل إدخالات اللاب معتمَدة من المشرف؟
    select count(*) into v_pending
      from public.production_entries e
     where e.laptop_id = p_laptop_id and e.status not in ('approved','released');
    if v_pending > 0 then
      raise exception 'فيه % إدخال لسه مش معتمد.', v_pending;
    end if;

    update public.laptops
      set current_status='released', released_by=auth.uid(), released_at=now()
      where id = p_laptop_id returning * into v;

    update public.production_entries
      set status='released', released_by=auth.uid(), released_at=now()
      where laptop_id = p_laptop_id and status <> 'released';
  else
    update public.laptops
      set current_status='returned'
      where id = p_laptop_id returning * into v;
  end if;

  insert into public.release_records(laptop_id, decision, reason, actor_id)
    values (p_laptop_id, p_decision, p_reason, auth.uid());

  insert into public.laptop_movements(laptop_id, action, from_status, to_status, actor_id, notes)
    values (p_laptop_id, 'release', v_before->>'current_status', v.current_status, auth.uid(), p_reason);

  perform public.fn_audit('release_laptop:'||p_decision,'laptops',p_laptop_id,v_before,to_jsonb(v));

  -- الإشعارات
  if p_decision = 'released' then
    perform public.fn_notify_role(
      'supervisor', 'laptop_released', 'تم إصدار لاب',
      'السيريال: ' || v.serial
    );
    insert into public.notifications(user_id, type, title, body)
    select distinct e.worker_id, 'laptop_released',
           'تم إصدار اللاب ' || v.serial,
           'حافزك على اللاب ده اتأكد واتحسب'
      from public.production_entries e
     where e.laptop_id = p_laptop_id and e.worker_id is not null;
  else
    perform public.fn_notify_role(
      'supervisor', 'laptop_returned', 'تم إرجاع لاب',
      'السيريال: ' || v.serial || coalesce(' · ' || p_reason, '')
    );
  end if;

  return v;
end;
$$;

-- 2.5 إغلاق الشهر (الحسابات) → إشعار العمال أصحاب الحوافز + المشرفين
create or replace function public.fn_close_month(p_year int, p_month int)
returns public.incentive_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
  v_period public.incentive_periods;
  v_rate numeric;
  v_currency text;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'إغلاق الفترة متاح للحسابات فقط';
  end if;

  select coalesce(unit_rate, 0), coalesce(currency, 'EGP')
    into v_rate, v_currency
    from public.incentive_rules order by id limit 1;

  insert into public.incentive_periods (period_start, period_end, status)
  values (v_start, v_end, 'closed')
  on conflict (period_start, period_end) do update set status = 'closed';

  update public.incentive_periods
     set status = 'closed', closed_by = auth.uid(), closed_at = now()
   where period_start = v_start and period_end = v_end
   returning * into v_period;

  delete from public.incentive_snapshots
   where period_start = v_start and period_end = v_end;

  insert into public.incentive_snapshots
    (period_start, period_end, worker_id, worker_name, laps, units, unit_rate, currency, incentive, locked_by, locked_at)
  select v_start, v_end, x.worker_id, x.worker_name, x.laps, x.units, v_rate, v_currency, x.incentive, auth.uid(), now()
    from (
      select p.id as worker_id, p.full_name as worker_name,
             count(distinct e.laptop_id)::int as laps,
             coalesce(sum(e.quantity * coalesce(o.weight, 1)), 0)::numeric as units,
             coalesce(sum(e.quantity * coalesce(o.unit_value, v_rate)), 0)::numeric as incentive
        from public.profiles p
        join public.production_entries e
          on e.worker_id = p.id and e.status = 'released'
         and e.entry_date between v_start and v_end
        left join public.operations o on o.id = e.operation_id
       where p.role = 'worker'
       group by p.id, p.full_name
    ) x;

  perform public.fn_audit('close_month', 'incentive_periods', v_period.id, null, to_jsonb(v_period));

  -- الإشعارات
  insert into public.notifications(user_id, type, title, body)
  select distinct s.worker_id, 'month_closed',
         'تم اعتماد حوافز شهر ' || to_char(v_start, 'YYYY-MM'),
         'إجمالي حافزك: ' || round(coalesce(s.incentive, 0), 2) || ' ' || v_currency
    from public.incentive_snapshots s
   where s.period_start = v_start and s.period_end = v_end
     and s.worker_id is not null;

  perform public.fn_notify_role(
    'supervisor', 'month_closed', 'تم إغلاق فترة الحوافز',
    'شهر: ' || to_char(v_start, 'YYYY-MM')
  );

  return v_period;
end;
$$;

-- ============================================================
-- 3) الصلاحيات
--    الدوال المساعدة تُنادى من جوه دوال RPC (owner = postgres)
--    فمنسحب تنفيذها من anon/authenticated لمنع تزوير الإشعارات.
-- ============================================================
revoke all on function public.fn_notify(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_notify_role(text, text, text, text, uuid) from public, anon, authenticated;

-- ============================================================
-- 4) اختبار سريع (اختياري — علّق/احذف السطر لو مش عايز)
-- ============================================================
-- select public.fn_notify(auth.uid(), 'test', 'إشعار تجريبي', 'ده إشعار اختبار');
