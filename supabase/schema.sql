-- ============================================================
-- YAS Workforce — مخطط قاعدة البيانات (Supabase / Postgres)
-- شغّل الملف ده في: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

-- 1) البروفايلات (مربوطة بـ auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'worker' check (role in ('worker','supervisor','accountant')),
  status text not null default 'pending' check (status in ('pending','active','inactive','rejected')),
  supervisor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2) أنواع العمليات
create table if not exists public.operations (
  id serial primary key,
  name_ar text not null,
  name_en text not null unique,
  active boolean not null default true,
  sort_order int not null default 0
);

-- 3) إدخال الإنتاج اليومي
create table if not exists public.production_entries (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  operation_id int not null references public.operations(id),
  entry_date date not null default current_date,
  quantity int not null check (quantity >= 0),
  notes text,
  status text not null default 'draft' check (status in ('draft','released','returned')),
  released_by uuid references public.profiles(id) on delete set null,
  released_at timestamptz,
  return_reason text,
  returned_by uuid references public.profiles(id) on delete set null,
  returned_at timestamptz,
  created_at timestamptz not null default now()
);

-- 4) السيريالات (Serial: both — in استلام / out إصدار)
create table if not exists public.lap_serials (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.production_entries(id) on delete cascade,
  serial text not null,
  direction text not null default 'out' check (direction in ('in','out')),
  created_at timestamptz not null default now()
);
create unique index if not exists lap_serials_unique on public.lap_serials (serial, direction);

-- 5) المرفقات (صور)
create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.production_entries(id) on delete cascade,
  storage_path text not null,
  file_type text,
  created_at timestamptz not null default now()
);

-- 6) تقارير الـ AI
create table if not exists public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  period_start date,
  period_end date,
  scope text,
  content jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- دالة مساعدة: دور المستخدم الحالي
-- ============================================================
create or replace function public.current_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- دالة مساعدة: حالة المستخدم الحالي (تتخطى RLS) — لمنع التعديل الذاتي للدور/الحالة
create or replace function public.current_status()
returns text
language sql
security definer
set search_path = public
as $$
  select status from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- إنشاء بروفايل تلقائي عند تسجيل مستخدم جديد
-- التسجيل فردي + الحالة تبدأ "pending" لحد موافقة المشرف
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'worker',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- تفعيل Row Level Security
-- ============================================================
alter table public.profiles           enable row level security;
alter table public.operations         enable row level security;
alter table public.production_entries enable row level security;
alter table public.lap_serials        enable row level security;
alter table public.attachments        enable row level security;
alter table public.ai_insights        enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.current_role() in ('supervisor','accountant'));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (id = auth.uid() or public.current_role() = 'supervisor')
  with check (
    public.current_role() = 'supervisor'
    or (id = auth.uid() and role = public.current_role() and status = public.current_status())
  );

-- operations
drop policy if exists operations_select on public.operations;
create policy operations_select on public.operations for select
  using (auth.uid() is not null);

drop policy if exists operations_write on public.operations;
create policy operations_write on public.operations for all
  using (public.current_role() = 'supervisor')
  with check (public.current_role() = 'supervisor');

-- production_entries
drop policy if exists entries_select on public.production_entries;
create policy entries_select on public.production_entries for select
  using (worker_id = auth.uid() or public.current_role() in ('supervisor','accountant'));

drop policy if exists entries_insert on public.production_entries;
create policy entries_insert on public.production_entries for insert
  with check (
    worker_id = auth.uid()
    and status = 'draft'
    and released_by is null
    and released_at is null
  );

drop policy if exists entries_update on public.production_entries;
create policy entries_update on public.production_entries for update
  using (
    public.current_role() = 'supervisor'
    or (worker_id = auth.uid() and status in ('draft','returned'))
  )
  with check (
    public.current_role() = 'supervisor'
    or (worker_id = auth.uid() and status in ('draft','returned'))
  );

drop policy if exists entries_delete on public.production_entries;
create policy entries_delete on public.production_entries for delete
  using (worker_id = auth.uid() and status in ('draft','returned'));

-- lap_serials (الوصول مرتبط بالإدخال الأب)
drop policy if exists serials_select on public.lap_serials;
create policy serials_select on public.lap_serials for select
  using (exists (
    select 1 from public.production_entries e
    where e.id = entry_id
      and (e.worker_id = auth.uid() or public.current_role() in ('supervisor','accountant'))
  ));

drop policy if exists serials_insert on public.lap_serials;
create policy serials_insert on public.lap_serials for insert
  with check (exists (
    select 1 from public.production_entries e
    where e.id = entry_id and e.worker_id = auth.uid()
  ));

-- attachments
drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select
  using (exists (
    select 1 from public.production_entries e
    where e.id = entry_id
      and (e.worker_id = auth.uid() or public.current_role() in ('supervisor','accountant'))
  ));

drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert
  with check (exists (
    select 1 from public.production_entries e
    where e.id = entry_id and e.worker_id = auth.uid()
  ));

-- ai_insights
drop policy if exists insights_select on public.ai_insights;
create policy insights_select on public.ai_insights for select
  using (public.current_role() in ('supervisor','accountant'));

-- ============================================================
-- بذور البيانات: أنواع العمليات
-- ============================================================
insert into public.operations (name_ar, name_en, sort_order) values
  ('Test خفيف',      'light_test',        1),
  ('Test تقيل',      'heavy_test',        2),
  ('صيانة خفيفة',    'light_maintenance', 3),
  ('صيانة تقيلة',    'heavy_maintenance', 4),
  ('تجميع',          'assembly',          5)
on conflict (name_en) do nothing;

-- ============================================================
-- Storage: بكت للصور (لابات)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('laps', 'laps', false)
on conflict (id) do nothing;

drop policy if exists laps_upload on storage.objects;
create policy laps_upload on storage.objects for insert
  with check (
    bucket_id = 'laps'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists laps_read on storage.objects;
create policy laps_read on storage.objects for select
  using (
    bucket_id = 'laps'
    and (owner = auth.uid() or public.current_role() in ('supervisor','accountant'))
  );

drop policy if exists laps_delete on storage.objects;
create policy laps_delete on storage.objects for delete
  using (bucket_id = 'laps' and owner = auth.uid());

-- ============================================================
-- إدارة حسابات الموظفين: إنشاء حساب بباسورد ثابت أو إعادة تعيينه
-- (بيستخدمها المشرف/الحسابات من شاشة "إدارة الحسابات")
-- اسم المستخدم بيتولّد في الواجهة على صيغة: name@yas.local
-- ============================================================
create extension if not exists pgcrypto with schema extensions;

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
  -- لازم المستدعي يكون مشرف أو حسابات
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'غير مسموح لك بإدارة الحسابات';
  end if;

  if p_role not in ('worker','supervisor','accountant') then
    raise exception 'دور غير صحيح: %', p_role;
  end if;

  select id into v_id from auth.users where email = lower(p_email);

  if v_id is null then
    v_id := gen_random_uuid();

    -- 1) المستخدم في نظام المصادقة
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

    -- 2) هوية الدخول (مطلوبة للدخول بالباسورد)
    execute format(
      'insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values (%L, %L, %L, %L, %L, now(), now(), now())',
      v_id::text, v_id::text, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', lower(p_email)),
      'email'
    );
  else
    -- الحساب موجود: نحدّث الباسورد ونأكّد الإيميل (إعادة تعيين)
    update auth.users
      set encrypted_password = crypt(p_password, gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now(),
          raw_user_meta_data =
            coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', p_full_name)
      where id = v_id;
  end if;

  -- 3) البروفايل النشط بالدور المطلوب
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
