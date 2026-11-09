-- ============================================================
-- YAS Workforce — المرحلة 10: إزالة دور «الإدارة» (management)
-- المحاسب (accountant) بيقوم بدور الإدارة.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================
-- ملاحظة: بيتفترض إن المرحلة 9 (phase9) اتنفّذت؛ عشان كده مفيش
-- سياسات على جداول incentive_* هنا (اتشالت خلاص).
-- ============================================================

-- 1) أي مستخدم حالي بدور management يتحوّل لـ accountant
update public.profiles set role = 'accountant' where role = 'management';

-- 2) قيد الأدوار: 3 أدوار بس (شيلنا management)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('worker','supervisor','accountant'));

-- ============================================================
-- 3) إعادة كتابة السياسات اللي كانت بتذكر management
-- ============================================================

-- laptops: الإدخال لغير الإدارة
drop policy if exists laptops_insert on public.laptops;
create policy laptops_insert on public.laptops for insert
  with check (public.current_role() in ('worker','supervisor','accountant'));

-- approvals
drop policy if exists approvals_select on public.approvals;
create policy approvals_select on public.approvals for select
  using (public.current_role() in ('supervisor','accountant'));

-- release_records
drop policy if exists releases_select on public.release_records;
create policy releases_select on public.release_records for select
  using (public.current_role() in ('supervisor','accountant'));

-- audit_logs
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select
  using (public.current_role() in ('supervisor','accountant'));

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.current_role() in ('supervisor','accountant'));

-- production_entries
drop policy if exists entries_select on public.production_entries;
create policy entries_select on public.production_entries for select
  using (worker_id = auth.uid() or public.current_role() in ('supervisor','accountant'));

-- entry_operations
drop policy if exists entry_operations_select on public.entry_operations;
create policy entry_operations_select on public.entry_operations for select
  using (exists (
    select 1 from public.production_entries e
    where e.id = entry_id
      and (e.worker_id = auth.uid() or public.current_role() in ('supervisor','accountant'))
  ));

-- ai_insights
drop policy if exists insights_select on public.ai_insights;
create policy insights_select on public.ai_insights for select
  using (public.current_role() = 'accountant');

-- ============================================================
-- 4) حماية تغيير الأدوار: المشرف يعدّل (عامل ↔ مشرف) بس
-- ============================================================
create or replace function public.fn_guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- نتخطى الحماية في سياق الخدمة (بدون مستخدم مُصادَق)
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    if public.current_role() not in ('supervisor','accountant') then
      raise exception 'غير مسموح بتغيير الأدوار';
    end if;
    if public.current_role() <> 'accountant'
       and (new.role = 'accountant' or old.role = 'accountant') then
      raise exception 'تعديل حساب «الحسابات» متاح لدور الحسابات فقط';
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 5) admin_create_user: المشرف مايقدرش ينشئ دور الحسابات
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

  if public.current_role() = 'supervisor' and p_role = 'accountant' then
    raise exception 'دور «الحسابات» متاح لدور الحسابات فقط';
  end if;

  if p_role not in ('worker','supervisor','accountant') then
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

-- 6) تنظيف دالة قديمة مش مستخدمة
drop function if exists public.is_readonly_role();
