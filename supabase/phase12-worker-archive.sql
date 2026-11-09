-- ============================================================
-- YAS Workforce — المرحلة 12: أرشيف العامل (خاص بالموظف فقط)
-- - الموظف بعد ما يتعتمد إدخاله يقدر «ينقله لأرشيفه» فيخفّ زحمة الصفحة الرئيسية.
-- - الموظف يقدر «يحذف» إدخال من أرشيفه (إخفاء عن الموظف نفسه فقط) من غير
--   ما يتأثر المشرف أو الحسابات (مفيش حذف فعلي من القاعدة).
-- - الأعمدة منفصلة عن أرشيف الحسابات (archived_at/status='archived') عشان
--   الأنظمة الاتنين ميتلخبطوش.
-- آمن للتشغيل أكثر من مرة (idempotent).
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query.
-- ============================================================

-- ============================================================
-- 1) أعمدة أرشيف الموظف
-- ============================================================
alter table public.production_entries add column if not exists worker_archived_at timestamptz;
alter table public.production_entries add column if not exists worker_hidden_at timestamptz;

-- ============================================================
-- 2) الموظف ينقل إدخاله المعتمد لأرشيفه
-- ============================================================
create or replace function public.fn_worker_archive_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
begin
  select * into v from public.production_entries where id = p_entry_id;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.worker_id <> auth.uid() then raise exception 'الإدخال ده مش بتاعك'; end if;
  if v.status not in ('approved', 'released') then
    raise exception 'ينفع تأرشف الإدخالات المعتمدة بس (الحالة الحالية: %).', v.status;
  end if;

  update public.production_entries
    set worker_archived_at = now(), worker_hidden_at = null
    where id = p_entry_id
    returning * into v;

  return v;
end;
$$;

-- ============================================================
-- 3) الموظف يشيل إدخال من أرشيفه (إخفاء عن الموظف فقط — مفيش حذف فعلي)
-- ============================================================
create or replace function public.fn_worker_hide_entry(p_entry_id uuid)
returns public.production_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.production_entries;
begin
  select * into v from public.production_entries where id = p_entry_id;
  if not found then raise exception 'الإدخال غير موجود'; end if;
  if v.worker_id <> auth.uid() then raise exception 'الإدخال ده مش بتاعك'; end if;
  if v.worker_archived_at is null then raise exception 'الإدخال مش في أرشيفك.'; end if;

  update public.production_entries
    set worker_hidden_at = now()
    where id = p_entry_id
    returning * into v;

  return v;
end;
$$;

-- ============================================================
-- 4) الصلاحيات: المستخدمون المصادق عليهم فقط (التحقق من الملكية جوه الدالة)
-- ============================================================
revoke all on function public.fn_worker_archive_entry(uuid) from public, anon;
revoke all on function public.fn_worker_hide_entry(uuid) from public, anon;
grant execute on function public.fn_worker_archive_entry(uuid) to authenticated;
grant execute on function public.fn_worker_hide_entry(uuid) to authenticated;
