-- ============================================================
-- YAS Workforce — المرحلة 4: العمليات المتعددة لكل إدخال
-- إضافي فقط (additive) — آمن للتشغيل أكثر من مرة (idempotent).
--
-- الفكرة: الإدخال الواحد بقى له بنود متعددة (الجدول entry_operations)،
-- وكل بند = نوع عملية + عدد مستقل. يعني العامل يقدر يسجّل في نفس الإدخال
-- مثال: تجميع (عدد 5) + صيانة تقيلة (عدد 2).
--
-- شغّل الملف ده في: Supabase Dashboard -> SQL Editor -> New query (Run).
-- ============================================================

-- ============================================================
-- 1) جدول بنود الإدخال
-- ============================================================
create table if not exists public.entry_operations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.production_entries(id) on delete cascade,
  operation_id int not null references public.operations(id),
  quantity int not null check (quantity >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_entry_operations_entry on public.entry_operations (entry_id);

-- ============================================================
-- 2) ترحيل الإدخالات الحالية → كل إدخال قديم يتحوّل لبند واحد
--    ( idempotent: ما بيكرّرش لو الإدخال له بنود بالفعل )
-- ============================================================
insert into public.entry_operations (entry_id, operation_id, quantity)
select e.id, e.operation_id, e.quantity
  from public.production_entries e
 where not exists (
   select 1 from public.entry_operations eo where eo.entry_id = e.id
 );

-- ============================================================
-- 3) RLS + السياسات (على نمط lap_serials: الوصول مرتبط بالإدخال الأب)
-- ============================================================
alter table public.entry_operations enable row level security;

drop policy if exists entry_operations_select on public.entry_operations;
create policy entry_operations_select on public.entry_operations for select
  using (exists (
    select 1 from public.production_entries e
    where e.id = entry_id
      and (e.worker_id = auth.uid() or public.current_role() in ('supervisor','accountant','management'))
  ));

drop policy if exists entry_operations_insert on public.entry_operations;
create policy entry_operations_insert on public.entry_operations for insert
  with check (exists (
    select 1 from public.production_entries e
    where e.id = entry_id and e.worker_id = auth.uid()
  ));

drop policy if exists entry_operations_delete on public.entry_operations;
create policy entry_operations_delete on public.entry_operations for delete
  using (exists (
    select 1 from public.production_entries e
    where e.id = entry_id and e.worker_id = auth.uid()
      and e.status in ('draft','returned')
  ));

-- ============================================================
-- 4) تحديث محرك الحافز عشان يجمع كل البنود
--    (لو الإدخال مالوش بنود — نظريًا مش هيحصل بعد الترحيل — بترجع
--     للعملية/العدد القديم كبند واحد عبر coalesce)
-- ============================================================

-- 4.1 الحافز لكل عامل (نسخة phase2 + بنود متعددة)
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
    coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.weight, 1)), 0)::numeric,
    (select r from rate),
    coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.unit_value, (select r from rate))), 0)::numeric
  from public.profiles p
  left join public.production_entries e
    on e.worker_id = p.id
   and e.status = 'released'
   and e.entry_date between p_start and p_end
  left join public.entry_operations eo on eo.entry_id = e.id
  left join public.operations o on o.id = coalesce(eo.operation_id, e.operation_id)
  where p.role = 'worker'
  group by p.id, p.full_name
  having count(e.id) > 0
  order by 6 desc;
$$;

-- 4.2 تقرير الفترة الكامل (نسخة phase2 + بنود متعددة)
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
           coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.weight, 1)), 0)::numeric as units,
           coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.unit_value, (select r from rate))), 0)::numeric as incentive
      from public.profiles p
      join public.production_entries e
        on e.worker_id = p.id and e.status = 'released'
       and e.entry_date between p_start and p_end
      left join public.entry_operations eo on eo.entry_id = e.id
      left join public.operations o on o.id = coalesce(eo.operation_id, e.operation_id)
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

-- 4.3 إغلاق الشهر (نسخة phase3 مع الإشعارات + بنود متعددة)
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
             coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.weight, 1)), 0)::numeric as units,
             coalesce(sum(coalesce(eo.quantity, e.quantity) * coalesce(o.unit_value, v_rate)), 0)::numeric as incentive
        from public.profiles p
        join public.production_entries e
          on e.worker_id = p.id and e.status = 'released'
         and e.entry_date between v_start and v_end
        left join public.entry_operations eo on eo.entry_id = e.id
        left join public.operations o on o.id = coalesce(eo.operation_id, e.operation_id)
       where p.role = 'worker'
       group by p.id, p.full_name
    ) x;

  perform public.fn_audit('close_month', 'incentive_periods', v_period.id, null, to_jsonb(v_period));

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
-- 5) الصلاحيات
-- ============================================================
revoke all on function public.fn_period_report(date, date) from public, anon;
revoke all on function public.fn_close_month(int, int) from public, anon;

grant execute on function public.fn_calculate_incentive(date, date) to authenticated;
grant execute on function public.fn_period_report(date, date) to authenticated;
grant execute on function public.fn_close_month(int, int) to authenticated;

-- ============================================================
-- نهاية المرحلة 4
-- ============================================================
