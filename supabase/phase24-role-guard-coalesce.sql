CREATE OR REPLACE FUNCTION public.admin_create_user(p_email text, p_password text, p_full_name text, p_role text DEFAULT 'supervisor'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
declare
  v_id uuid;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
    raise exception 'غير مسموح لك بإنشاء الحسابات';
  end if;

  if coalesce(public."current_role"(), '') = 'supervisor' and p_role = 'accountant' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_advance_stage(p_laptop_id uuid, p_stage_code text, p_notes text DEFAULT NULL::text)
 RETURNS laptops
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.laptops;
  v_from_status text;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_approve_laptop(p_laptop_id uuid)
 RETURNS laptops
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.laptops;
  v_missing text;
begin
  if coalesce(public."current_role"(), '') <> 'supervisor' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_archive_entry(p_entry_id uuid)
 RETURNS production_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.production_entries;
  v_before jsonb;
begin
  if coalesce(public."current_role"(), '') <> 'accountant' then
    raise exception '??????? ????? ???? ???????? ???';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception '??????? ??? ?????'; end if;
  if v.status not in ('approved','released') then
    raise exception '???? ????? ????????? ???????? ?? (?????? ???????: %).', v.status;
  end if;

  v_before := to_jsonb(v);

  update public.production_entries
    set status = 'archived', archived_at = now(), archived_by = auth.uid()
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('archive_entry', 'production_entries', p_entry_id, v_before, to_jsonb(v));

  return v;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_create_laptop(p_serial text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS laptops
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.laptops;
  v_serial text;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_delete_all_audit_logs(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count integer;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
    raise exception 'delete audit logs is supervisor/accountant-only';
  end if;
  select count(*) into v_count from public.audit_logs
   where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to);
  delete from public.audit_logs
   where (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to);
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_delete_all_entries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor', 'accountant') then
    raise exception 'delete all entries is supervisor/accountant-only';
  end if;

  -- ملاحظة: شرط WHERE إجباري لأن إمتداد supautils في Supabase يرفض DELETE بدون WHERE.
  select count(*) into v_count from public.production_entries where id is not null;
  delete from public.production_entries where id is not null;

  perform public.fn_audit(
    'delete_all_entries',
    'production_entries',
    null,
    null,
    jsonb_build_object('deleted', v_count)
  );

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_delete_audit_log(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
    raise exception 'delete audit log is supervisor/accountant-only';
  end if;
  delete from public.audit_logs where id = p_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_finish_maintenance(p_serial_id uuid)
 RETURNS lap_serials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.lap_serials;
  v_laptop_id uuid;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_guard_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- ????? ??????? ?? ???? ?????? (???? ?????? ???????)
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
      raise exception '??? ????? ?????? ???????';
    end if;
    if coalesce(public."current_role"(), '') <> 'accountant'
       and (new.role = 'accountant' or old.role = 'accountant') then
      raise exception '????? ???? �????????� ???? ???? ???????? ???';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_maintenance_queue()
 RETURNS TABLE(serial_id uuid, entry_id uuid, serial text, laptop_type text, model text, dest_code text, operation_name text, worker_name text, entry_date date, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.entry_id, s.serial, s.laptop_type, s.model, s.stage_code,
         o.name_ar, e2.full_name, e.entry_date, s.created_at
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.employees e2 on e2.id = e.worker_id
    left join public.operations o on o.id = s.operation_id
   where coalesce(public."current_role"(), '') in ('supervisor','accountant')
     and s.stage_code is not null
     and s.stage_code not in ('assembly','ready_for_release')
     and coalesce(s.maintenance_status, 'in_maintenance') = 'in_maintenance'
   order by s.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_release_entry(p_entry_id uuid)
 RETURNS production_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.production_entries;
  v_before jsonb;
  v_emp text;
begin
  if coalesce(public."current_role"(), '') <> 'accountant' then
    raise exception 'الإصدار للحسابات فقط';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.status <> 'approved' then
    raise exception 'الإدخال مش جاهز للإصدار (%). لازم يكون معتمد من المشرف الأول.', v.status;
  end if;

  v_before := to_jsonb(v);
  select full_name into v_emp from public.employees where id = v.worker_id;

  update public.production_entries
    set status = 'released', released_by = auth.uid(), released_at = now()
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('release_entry:released', 'production_entries', p_entry_id, v_before, to_jsonb(v));

  perform public.fn_notify_role(
    'supervisor', 'entry_released', 'تم إصدار إدخال',
    'الموظف: ' || coalesce(v_emp, '-') || ' · تاريخ: ' || to_char(v.entry_date, 'YYYY-MM-DD'),
    auth.uid()
  );

  return v;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_release_laptop(p_laptop_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS laptops
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.laptops;
  v_missing text;
  v_pending int;
  v_before jsonb;
begin
  if coalesce(public."current_role"(), '') <> 'accountant' then
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

    -- 2) لازم تكون اتحددت وجهة اللاب قبل الإصدار
    if not exists (
      select 1
        from public.laptop_movements m
        join public.stages s on s.code = m.stage_code
       where m.laptop_id = p_laptop_id and s.is_destination
    ) then
      raise exception 'لازم تحدد وجهة اللاب الأول قبل الإصدار.';
    end if;

    -- 3) كل إدخالات اللاب معتمَدة من المشرف؟
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_restore_entry(p_entry_id uuid)
 RETURNS production_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.production_entries;
  v_before jsonb;
begin
  if coalesce(public."current_role"(), '') <> 'accountant' then
    raise exception '????????? ???? ???? ???????? ???';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception '??????? ??? ?????'; end if;
  if v.status <> 'archived' then
    raise exception '??????? ?? ?? ???????.';
  end if;

  v_before := to_jsonb(v);

  update public.production_entries
    set status = 'approved', archived_at = null, archived_by = null
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('restore_entry', 'production_entries', p_entry_id, v_before, to_jsonb(v));

  return v;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_review_entry(p_entry_id uuid, p_decision text, p_reason text DEFAULT NULL::text)
 RETURNS production_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.production_entries;
  v_before jsonb;
  v_emp text;
begin
  if coalesce(public."current_role"(), '') <> 'supervisor' then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_submit_entry(p_entry_id uuid)
 RETURNS production_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.production_entries;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_worker_retest_problem(p_serial_id uuid)
 RETURNS lap_serials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.lap_serials;
  v_before jsonb;
  v_laptop_id uuid;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_worker_retest_queue()
 RETURNS TABLE(serial_id uuid, serial text, laptop_type text, model text, dest_code text, done_at timestamp with time zone, done_by_name text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select s.id, s.serial, s.laptop_type, s.model, s.stage_code, s.maintenance_done_at,
         p.full_name
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.profiles p on p.id = s.maintenance_done_by
   where coalesce(public."current_role"(), '') in ('supervisor','accountant')
     and s.maintenance_status = 'returned_to_worker'
     and not exists (
       select 1 from public.lap_serials s2
        where s2.serial = s.serial
          and s2.id <> s.id
          and s2.created_at > coalesce(s.maintenance_done_at, s.created_at)
     )
   order by s.maintenance_done_at desc nulls last;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_worker_send_retest(p_serial_id uuid)
 RETURNS lap_serials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_serial public.lap_serials;
  v_entry public.production_entries;
  v_before jsonb;
begin
  if coalesce(public."current_role"(), '') not in ('supervisor','accountant') then
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
$function$
;