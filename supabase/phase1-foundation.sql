-- ============================================================
-- YAS Workforce — المرحلة 1: الأساس (Foundation)
-- Migration إضافي فقط (additive) — لا يحذف أي جدول أو بيانات حالية.
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query (Whole script Run).
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================

-- ============================================================
-- 0) دوال مساعدة عامة
-- ============================================================

-- تحديث updated_at تلقائيًا
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- هل المستخدم الحالي للقراءة فقط (إدارة)؟
create or replace function public.is_readonly_role()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.current_role() = 'management', false);
$$;

-- ============================================================
-- 1) تعديلات خفيفة على الجداول الحالية
-- ============================================================

-- 1.1 profiles: إضافة دور management + updated_at
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('worker','supervisor','accountant','management'));

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending','active','inactive','rejected'));

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- 1.2 operations: وصف + سعر الوحدة لكل نوع عملية + updated_at
alter table public.operations add column if not exists description text;
alter table public.operations add column if not exists unit_value numeric;  -- null => fallback لسعر الحافز العام
alter table public.operations add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_operations_updated_at on public.operations;
create trigger trg_operations_updated_at before update on public.operations
  for each row execute function public.set_updated_at();

-- 1.3 production_entries: ربط باللاب + المرحلة + تتبّع المراجعة/التقديم
alter table public.production_entries add column if not exists laptop_id uuid;
alter table public.production_entries add column if not exists stage_code text;
alter table public.production_entries add column if not exists submitted_at timestamptz;
alter table public.production_entries add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
alter table public.production_entries add column if not exists reviewed_at timestamptz;

-- توسيع حالات الإدخال لدعم تدفّق الموافقتين (مشرف ثم حسابات)
alter table public.production_entries drop constraint if exists production_entries_status_check;
alter table public.production_entries add constraint production_entries_status_check
  check (status in ('draft','submitted','approved','released','returned'));

-- ============================================================
-- 2) جداول جديدة
-- ============================================================

-- 2.1 المراحل (قائمة مستقلة عن أنواع العمليات)
create table if not exists public.stages (
  code text primary key,
  name_ar text not null,
  name_en text not null,
  sort_order int not null default 0,
  is_mandatory boolean not null default true,
  active boolean not null default true
);

-- 2.2 سجل اللابات (المصدر الموثوق للسيريال — فريد عالميًا)
create table if not exists public.laptops (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique,
  qr_token uuid not null default gen_random_uuid() unique,
  current_status text not null default 'received'
    check (current_status in
      ('received','in_progress','awaiting_release','released','on_hold','rejected','returned')),
  current_stage text references public.stages(code),
  approved_by uuid references public.profiles(id) on delete set null,   -- موافقة المشرف النهائية
  approved_at timestamptz,
  released_by uuid references public.profiles(id) on delete set null,   -- إصدار الحسابات
  released_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_laptops_updated_at on public.laptops;
create trigger trg_laptops_updated_at before update on public.laptops
  for each row execute function public.set_updated_at();

-- ربط الإدخال باللاب (المفتاح الأجنبي بعد إنشاء الجدول)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'production_entries_laptop_id_fkey'
  ) then
    alter table public.production_entries
      add constraint production_entries_laptop_id_fkey
      foreign key (laptop_id) references public.laptops(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'production_entries_stage_code_fkey'
  ) then
    alter table public.production_entries
      add constraint production_entries_stage_code_fkey
      foreign key (stage_code) references public.stages(code) on delete set null;
  end if;
end $$;

-- 2.3 حركات اللاب (Timeline)
create table if not exists public.laptop_movements (
  id uuid primary key default gen_random_uuid(),
  laptop_id uuid not null references public.laptops(id) on delete cascade,
  stage_code text references public.stages(code),
  action text not null,                        -- receive | stage | hold | release | reject | return
  from_status text,
  to_status text,
  actor_id uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

-- 2.4 قرارات المشرف على الإدخالات
create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.production_entries(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected')),
  reason text,
  actor_id uuid not null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2.5 قرارات الإصدار النهائية من الحسابات
create table if not exists public.release_records (
  id uuid primary key default gen_random_uuid(),
  laptop_id uuid not null references public.laptops(id) on delete cascade,
  decision text not null check (decision in ('released','returned')),
  reason text,
  actor_id uuid not null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2.6 فترات الحوافز (شهرية/أسبوعية) — قابلة للإغلاق
create table if not exists public.incentive_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (period_start, period_end)
);

-- 2.7 تسويات الحوافز اليدوية (بعد الإغلاق فقط)
create table if not exists public.incentive_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references public.incentive_periods(id) on delete cascade,
  worker_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric not null,
  reason text not null,
  attachment_path text,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2.8 سجل الأوديت الشامل
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- 2.9 الإشعارات
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 3) الفهارس
-- ============================================================
create index if not exists idx_entries_worker_date   on public.production_entries (worker_id, entry_date);
create index if not exists idx_entries_status        on public.production_entries (status);
create index if not exists idx_entries_laptop        on public.production_entries (laptop_id);
create index if not exists idx_serials_serial        on public.lap_serials (serial);
create index if not exists idx_laptops_serial        on public.laptops (serial);
create index if not exists idx_laptops_status        on public.laptops (current_status);
create index if not exists idx_movements_laptop      on public.laptop_movements (laptop_id, created_at);
create index if not exists idx_approvals_record      on public.approvals (record_id);
create index if not exists idx_release_laptop        on public.release_records (laptop_id);
create index if not exists idx_notifications_user    on public.notifications (user_id, read_at);
create index if not exists idx_audit_created         on public.audit_logs (created_at);

-- ============================================================
-- 4) تفعيل RLS + السياسات للجداول الجديدة
-- ============================================================
alter table public.stages               enable row level security;
alter table public.laptops              enable row level security;
alter table public.laptop_movements     enable row level security;
alter table public.approvals            enable row level security;
alter table public.release_records      enable row level security;
alter table public.incentive_periods    enable row level security;
alter table public.incentive_adjustments enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.notifications        enable row level security;

-- stages: قراءة للجميع، كتابة للمشرف فقط
drop policy if exists stages_select on public.stages;
create policy stages_select on public.stages for select
  using (auth.uid() is not null);

drop policy if exists stages_write on public.stages;
create policy stages_write on public.stages for all
  using (public.current_role() = 'supervisor')
  with check (public.current_role() = 'supervisor');

-- laptops: قراءة لكل مستخدم مُصادَق (السيريال والحالة مش بيانات حساسة)
drop policy if exists laptops_select on public.laptops;
create policy laptops_select on public.laptops for select
  using (auth.uid() is not null);

drop policy if exists laptops_insert on public.laptops;
create policy laptops_insert on public.laptops for insert
  with check (
    public.current_role() in ('worker','supervisor','accountant')
    and public.current_role() <> 'management'
  );

drop policy if exists laptops_update on public.laptops;
create policy laptops_update on public.laptops for update
  using (public.current_role() in ('worker','supervisor','accountant'))
  with check (public.current_role() in ('worker','supervisor','accountant'));

-- laptop_movements: قراءة لكل مستخدم مُصادَق، الكتابة عبر RPC فقط
drop policy if exists movements_select on public.laptop_movements;
create policy movements_select on public.laptop_movements for select
  using (auth.uid() is not null);

-- approvals: قراءة للمشرف/الحسابات/الإدارة، الكتابة عبر RPC
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select
  using (public.current_role() in ('supervisor','accountant','management'));

-- release_records: قراءة للمشرف/الحسابات/الإدارة، الكتابة عبر RPC
drop policy if exists releases_select on public.release_records;
create policy releases_select on public.release_records for select
  using (public.current_role() in ('supervisor','accountant','management'));

-- incentive_periods: قراءة للمشرف/الحسابات/الإدارة، الكتابة عبر RPC
drop policy if exists periods_select on public.incentive_periods;
create policy periods_select on public.incentive_periods for select
  using (public.current_role() in ('supervisor','accountant','management'));

-- incentive_adjustments: قراءة للمشرف/الحسابات/الإدارة، الكتابة عبر RPC
drop policy if exists adjustments_select on public.incentive_adjustments;
create policy adjustments_select on public.incentive_adjustments for select
  using (public.current_role() in ('supervisor','accountant','management'));

-- audit_logs: قراءة للمشرف/الحسابات/الإدارة، الكتابة عبر RPC (security definer)
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select
  using (public.current_role() in ('supervisor','accountant','management'));

-- notifications: المستخدم يشوف إشعاراته ويعلّمها مقروءة
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select
  using (user_id = auth.uid());

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- توسيع سياسات الجداول الحالية لقراءة الإدارة (قراءة فقط)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.current_role() in ('supervisor','accountant','management'));

drop policy if exists entries_select on public.production_entries;
create policy entries_select on public.production_entries for select
  using (worker_id = auth.uid() or public.current_role() in ('supervisor','accountant','management'));

-- ============================================================
-- 5) دوال RPC (المصدر الوحيد لتغيير الحالات الحسّاسة)
-- ============================================================

-- 5.1 أوديت داخلي
create or replace function public.fn_audit(
  p_action text, p_entity text, p_entity_id uuid, p_before jsonb, p_after jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs(actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
$$;

-- 5.2 إنشاء لاب: تولّد سيريال لو مش موجود + تسجّل حركة "استلام" الأولية
create or replace function public.fn_create_laptop(
  p_serial text default null,
  p_notes text default null
)
returns public.laptops
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.laptops;
  v_serial text;
begin
  if public.current_role() not in ('worker','supervisor','accountant') then
    raise exception 'غير مسموح';
  end if;

  v_serial := nullif(btrim(coalesce(p_serial, '')), '');
  if v_serial is null then
    v_serial := 'LAP-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);
  end if;

  insert into public.laptops (serial, current_status, current_stage, created_by, notes)
  values (v_serial, 'received', 'receive', auth.uid(), p_notes)
  returning * into v;

  insert into public.laptop_movements (laptop_id, stage_code, action, to_status, actor_id, notes)
  values (v.id, 'receive', 'receive', 'received', auth.uid(), 'استلام اللاب');

  perform public.fn_audit('create_laptop', 'laptops', v.id, null, to_jsonb(v));
  return v;
exception
  when unique_violation then
    raise exception 'السيريال «%» مستخدم بالفعل — السيريال لازم يكون فريد.', v_serial;
end;
$$;

-- 5.3 تسجيل/تقديم إدخال (العامل) — يربط الإدخال بلاب موجود ومرحلة
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
  return v;
end;
$$;

-- 5.4 مراجعة المشرف على إدخال (approve/reject) — موافقة أولى
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
  return v;
end;
$$;

-- 5.5 تقديم المرحلة التالية للاب (Timeline)
create or replace function public.fn_advance_stage(
  p_laptop_id uuid, p_stage_code text, p_notes text default null
) returns public.laptops
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.laptops;
  v_from_status text;
begin
  if public.current_role() not in ('worker','supervisor') then
    raise exception 'غير مسموح';
  end if;
  if not exists (select 1 from public.stages where code = p_stage_code and active) then
    raise exception 'مرحلة غير صحيحة: %', p_stage_code;
  end if;

  select * into v from public.laptops where id = p_laptop_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v.current_status in ('released','rejected') then
    raise exception 'اللاب مقفول (%)', v.current_status;
  end if;

  v_from_status := v.current_status;

  update public.laptops
    set current_stage = p_stage_code,
        current_status = case when current_status = 'received' then 'in_progress' else current_status end
    where id = p_laptop_id
    returning * into v;

  insert into public.laptop_movements(laptop_id, stage_code, action, from_status, to_status, actor_id, notes)
    values (p_laptop_id, p_stage_code, 'stage', v_from_status, v.current_status, auth.uid(), p_notes);

  perform public.fn_audit('advance_stage:'||p_stage_code,'laptops',p_laptop_id,null,to_jsonb(v));
  return v;
end;
$$;

-- 5.6 إصدار اللاب (الحسابات) — موافقة نهائية
-- شرط: كل المراحل الإلزامية مُسجَّلة + كل إدخالات اللاب مُعتمَدة (approved)
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
  return v;
end;
$$;

-- 5.7 اعتماد المشرف النهائي على اللاب (بعد اكتمال المراحل)
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
  return v;
end;
$$;

-- 5.8 حساب الحافز server-side لفترة (يعتمد الإدخالات المُصدرة فقط)
-- الصيغة: Σ (quantity × coalesce(operations.unit_value, incentive_rules.unit_rate))
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
  with rate as (select unit_rate from public.incentive_rules order by id limit 1)
  select
    p.id as worker_id,
    p.full_name as worker_name,
    count(distinct e.laptop_id)::int as laptops,
    coalesce(sum(e.quantity * coalesce(o.unit_value, r.unit_rate, 0)), 0)::numeric as units,
    (select unit_rate from rate) as unit_rate,
    coalesce(sum(e.quantity * coalesce(o.unit_value, r.unit_rate, 0)), 0)::numeric as incentive
  from public.profiles p
  left join public.production_entries e
    on e.worker_id = p.id
   and e.status = 'released'
   and e.entry_date between p_start and p_end
  left join public.operations o on o.id = e.operation_id
  left join rate r on true
  where p.role = 'worker'
  group by p.id, p.full_name
  order by incentive desc;
$$;

-- ============================================================
-- 6) صلاحيات تنفيذ الدوال
-- ============================================================
revoke all on function public.fn_audit(text,text,uuid,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.fn_create_laptop(text,text) from public, anon;
revoke all on function public.fn_submit_entry(uuid) from public, anon;
revoke all on function public.fn_review_entry(uuid,text,text) from public, anon;
revoke all on function public.fn_advance_stage(uuid,text,text) from public, anon;
revoke all on function public.fn_release_laptop(uuid,text,text) from public, anon;
revoke all on function public.fn_approve_laptop(uuid) from public, anon;
revoke all on function public.fn_calculate_incentive(date,date) from public, anon;

grant execute on function public.fn_create_laptop(text,text) to authenticated;
grant execute on function public.fn_submit_entry(uuid) to authenticated;
grant execute on function public.fn_review_entry(uuid,text,text) to authenticated;
grant execute on function public.fn_advance_stage(uuid,text,text) to authenticated;
grant execute on function public.fn_release_laptop(uuid,text,text) to authenticated;
grant execute on function public.fn_approve_laptop(uuid) to authenticated;
grant execute on function public.fn_calculate_incentive(date,date) to authenticated;

-- ============================================================
-- 7) بذور المراحل (6 مراحل إلزامية)
-- ============================================================
insert into public.stages (code, name_ar, name_en, sort_order, is_mandatory, active) values
  ('receive',          'استلام',           'receive',          1, true, true),
  ('inspection',       'فحص',              'inspection',       2, true, true),
  ('maintenance',      'صيانة',            'maintenance',      3, true, true),
  ('test',             'اختبار',           'test',             4, true, true),
  ('assembly',         'تجميع',            'assembly',         5, true, true),
  ('ready_for_release','جاهز للإصدار',     'ready_for_release',6, true, true)
on conflict (code) do update
  set name_ar = excluded.name_ar,
      name_en = excluded.name_en,
      sort_order = excluded.sort_order,
      is_mandatory = excluded.is_mandatory;

-- ============================================================
-- 8) إتاحة دور management في إنشاء الحسابات
-- ============================================================
create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_role text default 'worker'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_id uuid;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'غير مسموح لك بإدارة الحسابات';
  end if;

  if p_role not in ('worker','supervisor','accountant','management') then
    raise exception 'دور غير صحيح: %', p_role;
  end if;

  select id into v_id from auth.users where email = lower(p_email);

  if v_id is null then
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', lower(p_email),
      crypt(p_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', p_full_name),
      '', '', '', ''
    );

    execute format(
      'insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (%L, %L, %L, %L, %L, now(), now(), now())',
      v_id::text, v_id::text, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', lower(p_email)),
      'email'
    );
  else
    update auth.users
      set encrypted_password = crypt(p_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now(),
          raw_user_meta_data =
            coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', p_full_name)
      where id = v_id;
  end if;

  insert into public.profiles (id, full_name, email, role, status)
  values (v_id, p_full_name, lower(p_email), p_role, 'active')
  on conflict (id) do update
    set full_name = excluded.full_name,
        email     = excluded.email,
        role      = excluded.role,
        status    = 'active';

  return v_id;
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text) to authenticated;

-- ============================================================
-- نهاية المرحلة 1
-- ============================================================
