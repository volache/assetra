-- The revision trigger writes to an audit-only table.  It must retain that
-- authority when an administrator updates a parcel through RLS.
create or replace function public.record_land_parcel_revision()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.land_parcel_revisions (
    land_parcel_id, revision_kind, snapshot, geometry, changed_by
  ) values (
    new.id,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    to_jsonb(new) - 'geometry',
    new.geometry,
    new.updated_by
  );
  return null;
end;
$$;

revoke all on function public.record_land_parcel_revision() from public, anon, authenticated;
