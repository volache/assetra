alter table public.asset_photos
  add column if not exists display_order bigint;

update public.asset_photos
set display_order = -(extract(epoch from created_at) * 1000000)::bigint
where display_order is null;

alter table public.asset_photos
  alter column display_order set default (-(extract(epoch from clock_timestamp()) * 1000000)::bigint),
  alter column display_order set not null;

create index if not exists asset_photos_identity_order_idx
  on public.asset_photos (asset_identity_id, display_order, created_at desc);

create or replace function public.reorder_asset_photos(
  p_asset_identity_id uuid,
  p_photo_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  existing_count integer;
begin
  if p_asset_identity_id is null or p_photo_ids is null then
    raise exception 'missing photo ordering data';
  end if;

  select count(*)::integer
  into existing_count
  from public.asset_photos
  where asset_identity_id = p_asset_identity_id;

  if cardinality(p_photo_ids) <> existing_count
    or (select count(distinct photo_id) from unnest(p_photo_ids) as photo_id) <> existing_count
    or exists (
      select 1
      from unnest(p_photo_ids) as requested(photo_id)
      left join public.asset_photos photo
        on photo.id = requested.photo_id
       and photo.asset_identity_id = p_asset_identity_id
      where photo.id is null
    ) then
    raise exception 'photo ordering does not match this asset';
  end if;

  update public.asset_photos as photo
  set display_order = requested.position - 1
  from unnest(p_photo_ids) with ordinality as requested(photo_id, position)
  where photo.id = requested.photo_id
    and photo.asset_identity_id = p_asset_identity_id;
end;
$$;

revoke all on function public.reorder_asset_photos(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_asset_photos(uuid, uuid[]) to service_role;
