-- ============================================================
-- YAS Workforce — المرحلة 16: إرسال اللاب بعد إعادة الاختبار للمشرف
-- - fn_worker_send_retest: الموظف يخلّص إعادة اختبار اللاب اللي رجع من الصيانة
--   → يتسجّل إدخال جديد بحالة «مُرسل» واللاب سليم (بدون وجهة)
--   → الإدخال يظهر تلقائيًا عند المشرف في صفحة الاعتماد، واللاب يخرج من
--     قائمة «في انتظار إعادة الاختبار».
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

create or replace function public.fn_worker_send_retest(p_serial_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serial public.lap_serials;
  v_old public.production_entries;
  v_new public.production_entries;
  v_new_id uuid := gen_random_uuid();
begin
  if public.current_role() <> 'worker' then
    raise exception 'إرسال نتيجة إعادة الاختبار متاح للموظف فقط';
  end if;

  select * into v_serial from public.lap_serials where id = p_serial_id for update;
  if not found then raise exception 'اللاب غير موجود'; end if;
  if v_serial.maintenance_status <> 'returned_to_worker' then
    raise exception 'اللاب مش في انتظار إعادة الاختبار';
  end if;

  select * into v_old from public.production_entries where id = v_serial.entry_id;
  if not found then raise exception 'الإدخال الأصلي غير موجود'; end if;
  if v_old.worker_id <> auth.uid() then raise exception 'غير مسموح'; end if;

  -- إدخال جديد «مُرسل» للمشرف بنفس عملية الإدخال الأصلي، واللاب سليم (بدون وجهة)
  insert into public.production_entries (id, worker_id, operation_id, entry_date, quantity, notes, status, submitted_at)
  values (
    v_new_id, auth.uid(), v_old.operation_id, current_date, 1,
    'إعادة اختبار بعد الصيانة — اللاب سليم', 'submitted', now()
  )
  returning * into v_new;

  insert into public.lap_serials (entry_id, serial, laptop_type, model, stage_code)
  values (v_new_id, v_serial.serial, v_serial.laptop_type, v_serial.model, null);

  perform public.fn_notify_role(
    'supervisor', 'entry_submitted', 'لاب جاهز بعد إعادة الاختبار',
    'السيريال: ' || v_serial.serial || ' — اتعمله تست وبقى سليم', auth.uid()
  );

  perform public.fn_audit('worker_send_retest', 'production_entries', v_new_id, null, to_jsonb(v_new));
  return v_new;
end;
$$;

revoke all on function public.fn_worker_send_retest(uuid) from public, anon;
grant execute on function public.fn_worker_send_retest(uuid) to authenticated;

notify pgrst, 'reload schema';
