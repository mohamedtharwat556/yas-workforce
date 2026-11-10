-- ============================================================
-- phase20: «نوع التاست» في طابور الصيانة عند المشرف
-- نضيف اسم العملية (نوع التاست) لكل لاب في طابور «تحت الصيانة».
--
-- شغّله في: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================

drop function if exists public.fn_maintenance_queue();

create function public.fn_maintenance_queue()
returns table (
  serial_id uuid,
  entry_id uuid,
  serial text,
  laptop_type text,
  model text,
  dest_code text,
  operation_name text,
  worker_name text,
  entry_date date,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select s.id, s.entry_id, s.serial, s.laptop_type, s.model, s.stage_code,
         o.name_ar, p.full_name, e.entry_date, s.created_at
    from public.lap_serials s
    join public.production_entries e on e.id = s.entry_id
    left join public.profiles p on p.id = e.worker_id
    left join public.operations o on o.id = s.operation_id
   where public.current_role() in ('supervisor','accountant')
     and s.stage_code is not null
     and s.stage_code not in ('assembly','ready_for_release')
     and coalesce(s.maintenance_status, 'in_maintenance') = 'in_maintenance'
   order by s.created_at desc;
$$;

revoke all on function public.fn_maintenance_queue() from public, anon;
grant execute on function public.fn_maintenance_queue() to authenticated;

notify pgrst, 'reload schema';
