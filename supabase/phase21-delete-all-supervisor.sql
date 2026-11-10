-- ============================================================
-- phase21: السماح للمشرف كمان بحذف كل إدخالات الإنتاج
-- قبل كده كانت الدالة للحسابات فقط (phase13)، دلوقتي بقت مشرف + حسابات
-- عشان زر «حذف الكل» يشتغل من صفحة الموظفين للمشرف برضه.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
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
  if public.current_role() not in ('supervisor', 'accountant') then
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
$$;

-- الصلاحيات: المستخدمون المصادق عليهم فقط (التحقق من الدور جوه الدالة)
revoke all on function public.fn_delete_all_entries() from public, anon;
grant execute on function public.fn_delete_all_entries() to authenticated;

notify pgrst, 'reload schema';
