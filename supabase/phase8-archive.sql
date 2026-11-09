-- ============================================================
-- YAS Workforce — المرحلة 8: أرشفة الإدخالات المعتمدة
-- - إضافة حالة جديدة للإدخال: 'archived' (مؤرشف).
-- - دوال للأرشفة والاسترجاع (لدور «الحسابات» فقط) — بدل الحذف النهائي.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) أعمدة الأرشفة + توسيع حالات الإدخال
-- ============================================================
alter table public.production_entries add column if not exists archived_at timestamptz;
alter table public.production_entries add column if not exists archived_by uuid
  references public.profiles(id) on delete set null;

alter table public.production_entries drop constraint if exists production_entries_status_check;
alter table public.production_entries add constraint production_entries_status_check
  check (status in ('draft','submitted','approved','released','returned','archived'));

-- ============================================================
-- 2) أرشفة إدخال معتمد (للحسابات فقط)
-- ============================================================
create or replace function public.fn_archive_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
  v_before jsonb;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'الأرشفة متاحة لدور الحسابات فقط';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.status not in ('approved','released') then
    raise exception 'ينفع تأرشف الإدخالات المعتمدة بس (الحالة الحالية: %).', v.status;
  end if;

  v_before := to_jsonb(v);

  update public.production_entries
    set status = 'archived', archived_at = now(), archived_by = auth.uid()
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('archive_entry', 'production_entries', p_entry_id, v_before, to_jsonb(v));

  return v;
end;
$$;

-- ============================================================
-- 3) استرجاع إدخال من الأرشيف (للحسابات فقط)
-- ============================================================
create or replace function public.fn_restore_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
  v_before jsonb;
begin
  if public.current_role() <> 'accountant' then
    raise exception 'الاسترجاع متاح لدور الحسابات فقط';
  end if;

  select * into v from public.production_entries where id = p_entry_id for update;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.status <> 'archived' then
    raise exception 'الإدخال مش في الأرشيف.';
  end if;

  v_before := to_jsonb(v);

  update public.production_entries
    set status = 'approved', archived_at = null, archived_by = null
    where id = p_entry_id
    returning * into v;

  perform public.fn_audit('restore_entry', 'production_entries', p_entry_id, v_before, to_jsonb(v));

  return v;
end;
$$;

-- ============================================================
-- 4) الصلاحيات: الدوال تُنفّذ بواسطة المستخدمين المصادقين فقط
--    (التحقق من الدور جوه الدالة نفسها)
-- ============================================================
revoke all on function public.fn_archive_entry(uuid) from public, anon;
revoke all on function public.fn_restore_entry(uuid) from public, anon;
grant execute on function public.fn_archive_entry(uuid) to authenticated;
grant execute on function public.fn_restore_entry(uuid) to authenticated;
