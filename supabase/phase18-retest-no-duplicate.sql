-- ============================================================
-- YAS Workforce — المرحلة 18: إصلاح تكرار اللاب في دورة إعادة الاختبار
--
-- المشكلة: النسخة القديمة من fn_worker_send_retest كانت بتعمل «إدخال جديد»
--   + «سطر لاب جديد» بنفس السيريال والوجهة فاضية. النتيجة إن اللاب الواحد
--   يبقى متسجّل مرتين: مرة صحته القديمة (تحت الصيانة) ومرة الجديدة (سليم)،
--   فيطلع عدد اللابات 3 بدل 2 (سليمين + واحد تحت الصيانة).
--
-- الحل: مفيش أي صف جديد خالص. بنعدّل نفس سطر اللاب (نشيل الوجهة وعلامة
--   الصيانة) وبنرجّع نفس الإدخال الأصلي «مُرسل» للمشرف يعتمده من تاني.
--
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) الدالة المصحّحة (نوع الإرجاع اتغير ⇒ لازم نحذف القديمة الأول)
-- ============================================================
drop function if exists public.fn_worker_send_retest(uuid);

create function public.fn_worker_send_retest(p_serial_id uuid)
returns public.lap_serials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial public.lap_serials;
  v_entry public.production_entries;
  v_before jsonb;
begin
  if public.current_role() <> 'worker' then
    raise exception 'إرسال نتيجة إعادة الاختبار متاح للموظف فقط';
  end if;

  select * into v_serial from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v_serial.maintenance_status <> 'returned_to_worker' then
    raise exception 'اللاب مش في انتظار إعادة الاختبار';
  end if;

  select * into v_entry from public.production_entries where id = v_serial.entry_id;
  if not found then raise exception 'الإدخال الأصلي غير موجود'; end if;
  if v_entry.worker_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  v_before := to_jsonb(v_serial);

  -- نفس سطر اللاب: بقى سليم (بنشيل وجهة الصيانة وعلامة الصيانة)
  -- عشان يختفي من «طلبات تحت الصيانة» و«في انتظار إعادة الاختبار» ويبقى سليم
  update public.lap_serials
     set stage_code = null,
         maintenance_status = null,
         maintenance_done_at = null,
         maintenance_done_by = null
   where id = p_serial_id
   returning * into v_serial;

  -- نفس الإدخال الأصلي يرجع «مُرسل» للمشرف يعتمده من تاني — بدون صف جديد
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
$$;

revoke all on function public.fn_worker_send_retest(uuid) from public, anon;
grant execute on function public.fn_worker_send_retest(uuid) to authenticated;

-- ============================================================
-- 2) تنظيف البيانات الغلط اللي النسخة القديمة سجّلتها (مرة واحدة)
--    بنحذف الإدخالات المكرّرة «إعادة اختبار بعد الصيانة» + سطورها،
--    وبنرجّع سطر اللاب الأصلي لحالة «سليم».
--    (approvals مربوط بـ on delete cascade فبيتشال تلقائيًا)
-- ============================================================
do $$
declare
  r record;
  v_orig uuid;
begin
  for r in
    select e.id as dup_entry_id, s.id as dup_serial_id, s.serial
      from public.production_entries e
      join public.lap_serials s on s.entry_id = e.id
     where e.notes = 'إعادة اختبار بعد الصيانة — اللاب سليم'
  loop
    -- سطر اللاب الأصلي: نفس السيريال ولسه معلّم «رجع من الصيانة»
    select o.id into v_orig
      from public.lap_serials o
     where o.serial = r.serial
       and o.id <> r.dup_serial_id
       and o.maintenance_status = 'returned_to_worker'
     order by o.created_at desc
     limit 1;

    if v_orig is not null then
      update public.lap_serials
         set stage_code = null,
             maintenance_status = null,
             maintenance_done_at = null,
             maintenance_done_by = null
       where id = v_orig;
    end if;

    delete from public.lap_serials where id = r.dup_serial_id;
    delete from public.production_entries where id = r.dup_entry_id;
  end loop;
end $$;

notify pgrst, 'reload schema';
