-- ============================================================
-- YAS Workforce — المرحلة 7: «الحسابات» = الأدمن
-- - المحاسب (accountant) هو المسؤول عن كل حاجة، ويشوف كل صفحات المشرف.
-- - المشرف (supervisor) مايشوفش حاجات المحاسب (التقارير المالية + اعتماد الحوافز).
-- - إنشاء حساب الحسابات (الأدمن): accountant@yas.com
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================

-- ============================================================
-- 1) تقييد قراءة الجداول المالية على الحسابات/الإدارة فقط
--    (كانت مفتوحة للمشرف، والمشرف مايشوفش حاجات المحاسب)
-- ============================================================
drop policy if exists periods_select on public.incentive_periods;
create policy periods_select on public.incentive_periods for select
  using (public.current_role() in ('accountant','management'));

drop policy if exists adjustments_select on public.incentive_adjustments;
create policy adjustments_select on public.incentive_adjustments for select
  using (public.current_role() in ('accountant','management'));

drop policy if exists snapshots_select on public.incentive_snapshots;
create policy snapshots_select on public.incentive_snapshots for select
  using (public.current_role() in ('accountant','management'));

drop policy if exists snapshots_write on public.incentive_snapshots;
create policy snapshots_write on public.incentive_snapshots for all
  using (public.current_role() = 'accountant')
  with check (public.current_role() = 'accountant');

drop policy if exists insights_select on public.ai_insights;
create policy insights_select on public.ai_insights for select
  using (public.current_role() in ('accountant','management'));

-- ============================================================
-- 2) منع ترقية المشرف لنفسه: تغيير الأدوار لدور «الحسابات» فقط
--    المشرف يقدر يعدّل (عامل ↔ مشرف) بس، ومش يقدر يمنح/يلمس
--    حساب «الحسابات» أو «الإدارة».
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
       and (new.role in ('accountant','management') or old.role in ('accountant','management')) then
      raise exception 'تعديل حسابات «الحسابات»/«الإدارة» متاح لدور الحسابات فقط';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_role_change on public.profiles;
create trigger trg_guard_role_change
  before update on public.profiles
  for each row execute function public.fn_guard_role_change();

-- ============================================================
-- 3) admin_create_user: المشرف مايقدرش ينشئ أدوار الحسابات/الإدارة
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

  if public.current_role() = 'supervisor' and p_role in ('accountant','management') then
    raise exception 'دور «الحسابات»/«الإدارة» متاح لدور الحسابات فقط';
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
-- 4) إنشاء حساب الحسابات (الأدمن)
--    الإيميل: accountant@yas.com — الباسورد: yas1234
-- ============================================================
do $$
declare
  v_id uuid;
  v_email text := 'accountant@yas.com';
  v_password text := 'yas1234';
  v_name text := 'الحسابات';
begin
  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated', v_email,
      crypt(v_password, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_name),
      '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_id, v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email),
      'email', now(), now(), now()
    );
  else
    update auth.users
      set encrypted_password = crypt(v_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now()
      where id = v_id;
  end if;

  insert into public.profiles (id, full_name, email, role, status)
  values (v_id, v_name, v_email, 'accountant', 'active')
  on conflict (id) do update
    set full_name = excluded.full_name,
        email     = excluded.email,
        role      = 'accountant',
        status    = 'active';
end;
$$;

-- ============================================================
-- 5) تحقق
-- ============================================================
select id, full_name, email, role, status
  from public.profiles
 where role = 'accountant'
 order by created_at;
