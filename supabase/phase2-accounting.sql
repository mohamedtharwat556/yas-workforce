-- ============================================================
-- YAS Workforce — المرحلة 2: المحاسبة (Accounting Engine)
-- إضافي فقط — يعتمد على جداول المرحلة 1 (incentive_periods / adjustments / snapshots).
-- آمن للتشغيل أكثر من مرة.
-- ============================================================

-- ============================================================
-- 1) تصحيح محرك الحافز: units = وحدات مرجّحة (weight)، incentive = مبلغ مالي
--    سعر العملية = operations.unit_value، والافتراضي = incentive_rules.unit_rate
-- ============================================================
create or replace function public.fn_calculate_incentive(
  p_start date, p_end date
)
returns table (
  worker_id uuid,
  worker_name text,
  laptops int,
  units numeric,
  unit_rate numeric,
  incentive numeric
)
language sql
security definer
set search_path = public
as $$
  with rate as (select coalesce(unit_rate, 0) as r from public.incentive_rules order by id limit 1)
  select
    p.id,
    p.full_name,
    count(distinct e.laptop_id)::int,
    coalesce(sum(e.quantity * coalesce(o.weight, 1)), 0)::numeric,
    (select r from rate),
    coalesce(sum(e.quantity * coalesce(o.unit_value, (select r from rate))), 0)::numeric
  from public.profiles p
  left join public.production_entries e
    on e.worker_id = p.id
   and e.status = 'released'
   and e.entry_date between p_start and p_end
  left join public.operations o on o.id = e.operation_id
  where p.role = 'worker'
  group by p.id, p.full_name
  having count(e.id) > 0
  order by 6 desc;
$$;

-- ============================================================
-- 2) تقرير الفترة الكامل: حاد + معتمد + تسويات = الإجمالي
-- ============================================================
create or replace function public.fn_period_report(p_start date, p_end date)
returns table (
  worker_id uuid,
  worker_name text,
  laps int,
  units numeric,
  incentive numeric,
  adjustment numeric,
  total numeric,
  locked_incentive numeric
)
language sql
security definer
set search_path = public
as $$
  with rate as (select coalesce(unit_rate, 0) as r from public.incentive_rules order by id limit 1),
  live as (
    select p.id as worker_id, p.full_name as worker_name,
           count(distinct e.laptop_id)::int as laps,
           coalesce(sum(e.quantity * coalesce(o.weight, 1)), 0)::numeric as units,
           coalesce(sum(e.quantity * coalesce(o.unit_value, (select r from rate))), 0)::numeric as incentive
      from public.profiles p
      join public.production_entries e
        on e.worker_id = p.id and e.status = 'released'
       and e.entry_date between p_start and p_end
      left join public.operations o on o.id = e.operation_id
     where p.role = 'worker'
     group by p.id, p.full_name
  ),
  adj as (
    select a.worker_id, coalesce(sum(a.amount), 0)::numeric as adjustment
      from public.incentive_adjustments a
      join public.incentive_periods ip on ip.id = a.period_id
     where ip.period_start = p_start and ip.period_end = p_end
     group by a.worker_id
  ),
  snap as (
    select s.worker_id, s.incentive::numeric as locked_incentive
      from public.incentive_snapshots s
     where s.period_start = p_start and s.period_end = p_end
  )
  select l.worker_id, l.worker_name, l.laps, l.units, l.incentive,
         coalesce(adj.adjustment, 0),
         coalesce(snap.locked_incentive, l.incentive) + coalesce(adj.adjustment, 0),
         snap.locked_incentive
    from live l
    left join adj on adj.worker_id = l.worker_id
    left join snap on snap.worker_id = l.worker_id
   order by 7 desc;
$$;

-- ============================================================
-- 3) إغلاق الشهر: يثبّت الأرقام في incentive_snapshots + يقفل الفترة
-- ============================================================
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
  return v_period;
end;
$$;

-- ============================================================
-- 4) إعادة فتح الشهر (يلغي التثبيت)
-- ============================================================
create or replace function public.fn_reopen_month(p_year int, p_month int)
returns public.incentive_periods
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := make_date(p_year, p_month, 1);
  v_end date := (make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day')::date;
  v public.incentive_periods;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'إعادة الفتح متاحة للحسابات فقط';
  end if;

  update public.incentive_periods
     set status = 'open', closed_by = null, closed_at = null
   where period_start = v_start and period_end = v_end
   returning * into v;

  if not found then
    raise exception 'مفيش فترة مقفولة للشهر ده';
  end if;

  delete from public.incentive_snapshots
   where period_start = v_start and period_end = v_end;

  perform public.fn_audit('reopen_month', 'incentive_periods', v.id, null, to_jsonb(v));
  return v;
end;
$$;

-- ============================================================
-- 5) إضافة تسوية يدوية (بعد الإغلاق)
-- ============================================================
create or replace function public.fn_add_adjustment(
  p_period_id uuid,
  p_worker_id uuid,
  p_amount numeric,
  p_reason text
)
returns public.incentive_adjustments
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.incentive_adjustments;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'التسويات متاحة للحسابات فقط';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'سبب التسوية مطلوب';
  end if;

  insert into public.incentive_adjustments (period_id, worker_id, amount, reason, actor_id)
  values (p_period_id, p_worker_id, p_amount, btrim(p_reason), auth.uid())
  returning * into v;

  perform public.fn_audit('add_adjustment', 'incentive_adjustments', v.id, null, to_jsonb(v));
  return v;
end;
$$;

-- ============================================================
-- 6) الصلاحيات
-- ============================================================
revoke all on function public.fn_close_month(int, int) from public, anon;
revoke all on function public.fn_reopen_month(int, int) from public, anon;
revoke all on function public.fn_add_adjustment(uuid, uuid, numeric, text) from public, anon;
revoke all on function public.fn_period_report(date, date) from public, anon;

grant execute on function public.fn_calculate_incentive(date, date) to authenticated;
grant execute on function public.fn_period_report(date, date) to authenticated;
grant execute on function public.fn_close_month(int, int) to authenticated;
grant execute on function public.fn_reopen_month(int, int) to authenticated;
grant execute on function public.fn_add_adjustment(uuid, uuid, numeric, text) to authenticated;

-- ============================================================
-- نهاية المرحلة 2
-- ============================================================
