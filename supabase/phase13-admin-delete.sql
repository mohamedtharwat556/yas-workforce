-- ============================================================
-- YAS Workforce — المرحلة 13: أدوات حذف إدارية (لدور الحسابات فقط)
-- - fn_delete_audit_log: حذف سجل أوديت واحد نهائيًا.
-- - fn_delete_all_entries: حذف كل إدخالات الإنتاج في النظام (تصفير).
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) حذف سجل أوديت واحد (الحسابات فقط)
-- ============================================================
create or replace function public.fn_delete_audit_log(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'accountant' then
    raise exception 'حذف سجل الأوديت متاح لدور الحسابات فقط';
  end if;

  delete from public.audit_logs where id = p_id;
end;
$$;

-- ============================================================
-- 2) حذف كل إدخالات الإنتاج في النظام (الحسابات فقط)
--    الحذف بينزل cascade على البنود/السيريالات/المرفقات/الاعتمادات.
-- ============================================================
create or replace function public.fn_delete_all_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'حذف كل الإدخالات متاح لدور الحسابات فقط';
  end if;

  select count(*) into v_count from public.production_entries;
  delete from public.production_entries;

  perform public.fn_audit(
    'delete_all_entries',
    'production_entries',
    null,
    null,
    jsonb_build_object('deleted', v_count)
  );

  return v_count;
end;
$$;

-- ============================================================
-- 3) الصلاحيات: المستخدمون المصادق عليهم فقط (التحقق من الدور جوه الدالة)
-- ============================================================
revoke all on function public.fn_delete_audit_log(uuid) from public, anon;
revoke all on function public.fn_delete_all_entries() from public, anon;
grant execute on function public.fn_delete_audit_log(uuid) to authenticated;
grant execute on function public.fn_delete_all_entries() to authenticated;
