-- =====================================================================
-- phase22: إلغاء دور «الموظف» → المشروع بيقوم على دورين بس:
--          «المشرف» (هو اللي يسجّل الإنتاجية) و«الحسابات» (يتابع ويصدر).
--  - الموظف بقى مجرد اسم في جدول «employees» (من غير إيميل ولا باسورد).
--  - production_entries.worker_id بقى بيشاور على employees بدل profiles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) جدول الموظفين (أسماء فقط — بدون حسابات)
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.employees enable row level security;

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select
  using ( public.current_role() in ('supervisor','accountant') );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert
  with check ( public.current_role() = 'supervisor' );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update
  using ( public.current_role() = 'supervisor' )
  with check ( public.current_role() = 'supervisor' );

drop policy if exists employees_delete on public.employees;
create policy employees_delete on public.employees for delete
  using ( public.current_role() = 'supervisor' );

grant select, insert, update, delete on public.employees to authenticated;

-- ---------------------------------------------------------------------
-- 2) تعبئة جدول الموظفين من أسماء حسابات الموظفين الحالية
-- ---------------------------------------------------------------------
insert into public.employees (full_name, active, sort_order)
select p.full_name, true, (row_number() over (order by p.full_name))::int
  from public.profiles p
 where p.role = 'worker'
   and not exists (select 1 from public.employees e where e.full_name = p.full_name);

-- ---------------------------------------------------------------------
-- 3) إعادة ربط الإنتاج بالموظفين (بدل حسابات المستخدمين)
-- ---------------------------------------------------------------------
alter table public.production_entries
  drop constraint if exists production_entries_worker_id_fkey;

alter table public.production_entries
  add constraint production_entries_worker_id_fkey
  foreign key (worker_id) references public.employees(id) on delete restrict;

-- ---------------------------------------------------------------------
-- 4) سياسات RLS — الإنتاج بقى للمشرف/الحسابات (مفيش مستخدم «موظف»)
-- ---------------------------------------------------------------------
drop policy if exists entries_insert on public.production_entries;
create policy entries_insert on public.production_entries for insert
  with check (
    public.current_role() in ('supervisor','accountant')
    and status = 'draft'
    and released_by is null
    and released_at is null
  );

drop policy if exists entries_select on public.production_entries;
create policy entries_select on public.production_entries for select
  using ( public.current_role() in ('supervisor','accountant') );

drop policy if exists entries_update on public.production_entries;
create policy entries_update on public.production_entries for update
  using ( public.current_role() in ('supervisor','accountant') )
  with check ( public.current_role() in ('supervisor','accountant') );

drop policy if exists entries_delete on public.production_entries;
create policy entries_delete on public.production_entries for delete
  using ( public.current_role() in ('supervisor','accountant') );

-- السيريالات
drop policy if exists serials_insert on public.lap_serials;
create policy serials_insert on public.lap_serials for insert
  with check (
    public.current_role() in ('supervisor','accountant')
    and exists (select 1 from public.production_entries e where e.id = lap_serials.entry_id)
  );

drop policy if exists serials_select on public.lap_serials;
create policy serials_select on public.lap_serials for select
  using ( public.current_role() in ('supervisor','accountant') );

drop policy if exists serials_delete on public.lap_serials;
create policy serials_delete on public.lap_serials for delete
  using ( public.current_role() in ('supervisor','accountant') );

-- بنود العمليات
drop policy if exists entry_operations_insert on public.entry_operations;
create policy entry_operations_insert on public.entry_operations for insert
  with check (
    public.current_role() in ('supervisor','accountant')
    and exists (select 1 from public.production_entries e where e.id = entry_operations.entry_id)
  );

drop policy if exists entry_operations_select on public.entry_operations;
create policy entry_operations_select on public.entry_operations for select
  using ( public.current_role() in ('supervisor','accountant') );

drop policy if exists entry_operations_delete on public.entry_operations;
create policy entry_operations_delete on public.entry_operations for delete
  using (
    public.current_role() in ('supervisor','accountant')
    and exists (select 1 from public.production_entries e where e.id = entry_operations.entry_id)
  );

-- المرفقات
drop policy if exists attachments_insert on public.attachments;
create policy attachments_insert on public.attachments for insert
  with check (
    public.current_role() in ('supervisor','accountant')
    and exists (select 1 from public.production_entries e where e.id = attachments.entry_id)
  );

drop policy if exists attachments_select on public.attachments;
create policy attachments_select on public.attachments for select
  using ( public.current_role() in ('supervisor','accountant') );

-- اللابات
drop policy if exists laptops_insert on public.laptops;
create policy laptops_insert on public.laptops for insert
  with check ( public.current_role() in ('supervisor','accountant') );

drop policy if exists laptops_update on public.laptops;
create policy laptops_update on public.laptops for update
  using ( public.current_role() in ('supervisor','accountant') )
  with check ( public.current_role() in ('supervisor','accountant') );

-- ---------------------------------------------------------------------
-- 5) الدوال
-- ---------------------------------------------------------------------

-- المستخدم الجديد (احتياطي) — مفيش دور «موظف» بعد كده
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'supervisor',
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- إنشاء الحسابات — الأدوار المتاحة: مشرف / حسابات
create or replace function public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text default 'supervisor'::text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth', 'extensions'
as $function$
declare
  v_id uuid;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'غير مسموح لك بإنشاء الحسابات';
  end if;

  if public.current_role() = 'supervisor' and p_role = 'accountant' then
    raise exception 'مش مسموح لك بإنشاء حساب حسابات';
  end if;

  if p_role not in ('supervisor','accountant') then
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
$function$;

-- نقل مرحلة اللاب
create or replace function public.fn_advance_stage(p_laptop_id uuid, p_stage_code text, p_notes text default null::text)
returns laptops
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.laptops;
  v_from_status text;
begin
  if public.current_role() not in ('supervisor','accountant') then
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
$function$;

-- إنشاء لاب
create or replace function public.fn_create_laptop(p_serial text default null::text, p_notes text default null::text)
returns laptops
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.laptops;
  v_serial text;
begin
  if public.current_role() not in ('supervisor','accountant') then
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
$function$;

-- إرسال إدخال للمراجعة (بقى المشرف/الحسابات)
create or replace function public.fn_submit_entry(p_entry_id uuid)
returns production_entries
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.production_entries;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'غير مسموح';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.status <> 'draft' then raise exception 'الإدخال مش مسودّة (%).', v.status; end if;

  update public.production_entries
    set status = 'submitted', submitted_at = now()
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('submit_entry','production_entries',p_entry_id,null,to_jsonb(v));

  perform public.fn_notify_role(
    'supervisor', 'entry_submitted', 'إدخال جديد بانتظار المراجعة',
    'من: ' || coalesce((select full_name from public.employees where id = v.worker_id), 'موظف')
      || ' · تاريخ: ' || to_char(v.entry_date, 'YYYY-MM-DD'),
    auth.uid()
  );

  return v;
end;
$function$;

-- مراجعة الإدخال (اعتماد/إرجاع)
create or replace function public.fn_review_entry(p_entry_id uuid, p_decision text, p_reason text default null::text)
returns production_entries
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.production_entries;
  v_before jsonb;
  v_emp text;
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
  select full_name into v_emp from public.employees where id = v.worker_id;

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
    perform public.fn_notify_role(
      'accountant', 'entry_approved', 'إدخال جاهز للإصدار',
      'الموظف: ' || coalesce(v_emp, '-') || ' · تاريخ: ' || to_char(v.entry_date, 'YYYY-MM-DD'),
      auth.uid()
    );
  else
    perform public.fn_notify_role(
      'supervisor', 'entry_returned', 'تم إرجاع إدخال',
      'الموظف: ' || coalesce(v_emp, '-') || ' · ' ||
        coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'بدون سبب محدد'),
      auth.uid()
    );
  end if;

  return v;
end;
$function$;

-- إنهاء صيانة اللاب → يرجّعه لطابور إعادة الاختبار عند المشرف
create or replace function public.fn_finish_maintenance(p_serial_id uuid)
returns lap_serials
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    raise exception 'الصيانة اتخلصت بالفعل واللاب رجع';
  end if;

  update public.lap_serials
     set maintenance_status = 'returned_to_worker',
         maintenance_done_at = now(),
         maintenance_done_by = auth.uid()
   where id = p_serial_id
   returning * into v;

  -- اللاب يرجع لمرحلة «اختبار» في مساره عشان يتعمل له تست من جديد
  select id into v_laptop_id from public.laptops where serial = v.serial;
  if v_laptop_id is not null then
    update public.laptops
       set current_stage = 'test',
           current_status = 'in_progress',
           updated_at = now()
     where id = v_laptop_id;
  end if;

  -- إشعار للمشرفين إن اللاب رجع لمحطة إعادة الاختبار
  perform public.fn_notify_role(
    'supervisor', 'maintenance_done', 'لاب رجع من الصيانة',
    'السيريال: ' || v.serial || ' — خلّصنا الصيانة، اعمله إعادة اختبار.',
    auth.uid()
  );

  perform public.fn_audit('finish_maintenance', 'lap_serials', p_serial_id, null, to_jsonb(v));
  return v;
end;
$function$;

-- طابور الصيانة — اسم الموظف بقى من جدول employees
create or replace function public.fn_maintenance_queue()
returns table(serial_id uuid, entry_id uuid, serial text, laptop_type text, model text, dest_code text, operation_name text, worker_name text, entry_date date, created_at timestamp with time zone)
language sql
security definer
set search_path to 'public'
as $function$
  select s.id, s.entry_id, s.serial, s.laptop_type, s.model, s.stage_code,
         o.name_ar, e2.full_name, e.entry_date, s.created_at
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.employees e2 on e2.id = e.worker_id
    left join public.operations o on o.id = s.operation_id
   where public.current_role() in ('supervisor','accountant')
     and s.stage_code is not null
     and s.stage_code not in ('assembly','ready_for_release')
     and coalesce(s.maintenance_status, 'in_maintenance') = 'in_maintenance'
   order by s.created_at desc;
$function$;

-- طابور إعادة الاختبار — بقى للمشرف على كل اللابات
create or replace function public.fn_worker_retest_queue()
returns table(serial_id uuid, serial text, laptop_type text, model text, dest_code text, done_at timestamp with time zone, done_by_name text)
language sql
security definer
set search_path to 'public'
as $function$
  select s.id, s.serial, s.laptop_type, s.model, s.stage_code, s.maintenance_done_at,
         p.full_name
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.profiles p on p.id = s.maintenance_done_by
   where public.current_role() in ('supervisor','accountant')
     and s.maintenance_status = 'returned_to_worker'
     and not exists (
       select 1 from public.lap_serials s2
        where s2.serial = s.serial
          and s2.id <> s.id
          and s2.created_at > coalesce(s.maintenance_done_at, s.created_at)
     )
   order by s.maintenance_done_at desc nulls last;
$function$;

-- إرسال نتيجة إعادة الاختبار (سليم)
create or replace function public.fn_worker_send_retest(p_serial_id uuid)
returns lap_serials
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_serial public.lap_serials;
  v_entry public.production_entries;
  v_before jsonb;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'إرسال نتيجة إعادة الاختبار متاح للمشرف فقط';
  end if;

  select * into v_serial from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v_serial.maintenance_status <> 'returned_to_worker' then
    raise exception 'اللاب مش في انتظار إعادة الاختبار';
  end if;

  select * into v_entry from public.production_entries where id = v_serial.entry_id;
  if not found then raise exception 'الإدخال الأصلي غير موجود'; end if;

  v_before := to_jsonb(v_serial);

  update public.lap_serials
     set stage_code = null,
         maintenance_status = null,
         maintenance_done_at = null,
         maintenance_done_by = null
   where id = p_serial_id
   returning * into v_serial;

  update public.production_entries
     set status = 'submitted',
         submitted_at = now(),
         reviewed_by = null,
         reviewed_at = null,
         return_reason = null,
         returned_by = null,
         returned_at = null
   where id = v_entry.id;

  perform public.fn_notify_role(
    'supervisor', 'entry_submitted', 'لاب جاهز بعد إعادة الاختبار',
    'السيريال: ' || v_serial.serial || ' — اتعمله تست وبقى سليم', auth.uid()
  );

  perform public.fn_audit('worker_send_retest', 'lap_serials', p_serial_id, v_before, to_jsonb(v_serial));
  return v_serial;
end;
$function$;

-- اللاب لسه فيه مشكلة بعد الصيانة → يرجع للصيانة تاني
create or replace function public.fn_worker_retest_problem(p_serial_id uuid)
returns lap_serials
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v public.lap_serials;
  v_before jsonb;
  v_laptop_id uuid;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'ده متاح للمشرف فقط';
  end if;

  select * into v from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v.maintenance_status <> 'returned_to_worker' then
    raise exception 'اللاب مش في انتظار إعادة الاختبار';
  end if;

  v_before := to_jsonb(v);

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
    'السيريال: ' || v.serial || ' — اتعمله تست وطلع لسه فيه مشكلة، محتاج صيانة تاني.',
    auth.uid()
  );

  perform public.fn_audit('worker_retest_problem', 'lap_serials', p_serial_id, v_before, to_jsonb(v));
  return v;
end;
$function$;

-- ---------------------------------------------------------------------
-- 6) حذف حسابات الموظفين (18 حساب) + تعديل قيد الأدوار
-- ---------------------------------------------------------------------
delete from auth.users
 where id in (select id from public.profiles where role = 'worker');

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('supervisor','accountant'));
