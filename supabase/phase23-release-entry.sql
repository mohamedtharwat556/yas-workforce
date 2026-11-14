-- =========================================================
-- phase23 — إصدار الإدخال من الحسابات
-- =========================================================
-- بعد اعتماد المشرف، الإدخال بيبقى 'approved'. الحسابات هي اللي بتصدره
-- فيبقى 'released' — ودي الخطوة اللي كانت ناقصة في الواجهة خالص،
-- فالحالة 'released' مكانش فيه أي إدخال بيوصلها.
--
-- الإصدار على مستوى الإدخال بس (مش اللاب) عشان منكسرش مسار الصيانة/
-- إعادة الاختبار: لو علّمنا اللاب 'released' مش هينفع يتحرّك تاني في المراحل
-- لو رجع تاني في إدخال جديد.

create or replace function public.fn_release_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.fn_release_entry(uuid) from public, anon;
grant execute on function public.fn_release_entry(uuid) to authenticated;
