-- ============================================================
-- YAS Workforce — المرحلة 11: وجهات اللاب (مسارات ما بعد الفحص)
-- إضافة «وجهة» للاب كمرحلة اختيارية، ولازم تتحدد قبل الإصدار النهائي.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- ============================================================

-- 1) عمود يميّز مراحل «الوجهة» عن مراحل المسار العادية
alter table public.stages add column if not exists is_destination boolean not null default false;

-- 2) «تجميع» و«جاهز للإصدار» بيعتبروا وجهات صحيحة كمان
update public.stages set is_destination = true where code in ('assembly', 'ready_for_release');

-- 3) وجهات اللاب (غير إلزامية — العامل يختار الوجهة المناسبة)
insert into public.stages (code, name_ar, name_en, sort_order, is_mandatory, active, is_destination) values
  ('screens',     'صيانة الشاشات', 'screens_maintenance', 10, false, true, true),
  ('spare_parts', 'ناقص قطع غيار', 'missing_parts',       11, false, true, true),
  ('cracks',      'الكسور',        'cracks',              12, false, true, true),
  ('paint',       'الرش',          'painting',            13, false, true, true),
  ('batteries',   'البطاريات',     'batteries',           14, false, true, true),
  ('scrap',       'هالك',          'scrap',               16, false, true, true)
on conflict (code) do update
  set name_ar       = excluded.name_ar,
      name_en       = excluded.name_en,
      sort_order    = excluded.sort_order,
      is_destination = true,
      active        = true;

-- ============================================================
-- 4) إصدار اللاب (الحسابات) — نضيف شرط: لازم تتحدد وجهة قبل الإصدار
-- ============================================================
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
$$;
