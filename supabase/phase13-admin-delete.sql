-- ============================================================
-- YAS Workforce — المرحلة 13: أدوات حذف إدارية
-- - fn_delete_audit_log: حذف سجل أوديت واحد نهائيًا (المشرف/الحسابات).
-- - fn_delete_all_audit_logs: حذف كل أحداث السجل في فترة معيّنة (المشرف/الحسابات).
-- - fn_delete_all_entries: حذف كل إدخالات الإنتاج في النظام (الحسابات فقط).
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) حذف سجل أوديت واحد (المشرف/الحسابات)
-- ============================================================
create or replace function public.fn_delete_audit_log(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'delete audit log is supervisor/accountant-only';
  end if;

  delete from public.audit_logs where id = p_id;
end;
$$;

-- ============================================================
-- 2) حذف كل أحداث السجل في فترة معيّنة (المشرف/الحسابات)
--    p_from / p_to اختياريين: لو null يبقى مفتوح من غير حد للطرف ده.
-- ============================================================
create or replace function public.fn_delete_all_audit_logs(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if public.current_role() not in ('supervisor','accountant') then
    raise exception 'delete audit logs is supervisor/accountant-only';
  end if;

  -- ملاحظة: شرط WHERE إجباري لأن إمتداد supautils في Supabase يرفض DELETE بدون WHERE.
  select count(*) into v_count
    from public.audit_logs
   where (p_from is null or created_at >= p_from)
     and (p_to   is null or created_at <= p_to);

  delete from public.audit_logs
   where (p_from is null or created_at >= p_from)
     and (p_to   is null or created_at <= p_to);

  return v_count;
end;
$$;

-- ============================================================
-- 3) حذف كل إدخالات الإنتاج في النظام (الحسابات فقط)
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
    raise exception 'delete all entries is accountant-only';
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
$$;

-- ============================================================
-- 4) الصلاحيات: المستخدمون المصادق عليهم فقط (التحقق من الدور جوه الدالة)
-- ============================================================
revoke all on function public.fn_delete_audit_log(uuid) from public, anon;
revoke all on function public.fn_delete_all_audit_logs(timestamptz, timestamptz) from public, anon;
revoke all on function public.fn_delete_all_entries() from public, anon;
grant execute on function public.fn_delete_audit_log(uuid) to authenticated;
grant execute on function public.fn_delete_all_audit_logs(timestamptz, timestamptz) to authenticated;
grant execute on function public.fn_delete_all_entries() to authenticated;
