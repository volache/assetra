-- Cadastral parcels are stored as editable business data rather than build-time files.
create extension if not exists postgis with schema extensions;

create table public.land_parcels (
  id uuid primary key default gen_random_uuid(),
  parcel_key text not null unique,
  section_code text not null,
  section_name text not null,
  land_number text not null,
  county text,
  township text,
  registration_date date,
  area numeric,
  zoning text,
  land_use_type text,
  announced_land_value numeric,
  announced_land_price numeric,
  announced_price_date date,
  public_classification text,
  property_number text,
  property_name text,
  acquisition_date date,
  property_value numeric,
  cadastral_link text,
  documents jsonb not null default '{}'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  notes text,
  related_building_numbers jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  geometry extensions.geometry(MultiPolygon, 4326) not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

create index land_parcels_geometry_gix on public.land_parcels using gist (geometry);
create index land_parcels_section_idx on public.land_parcels (section_code, land_number);
create index land_parcels_property_number_idx on public.land_parcels (property_number);

create table public.land_parcel_asset_links (
  land_parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  asset_identity_id uuid not null references public.asset_identities(id) on delete restrict,
  relationship_type text not null default 'associated'
    check (relationship_type in ('associated', 'occupies', 'constructed_on')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (land_parcel_id, asset_identity_id, relationship_type)
);

create index land_parcel_asset_links_identity_idx
  on public.land_parcel_asset_links (asset_identity_id);

create table public.land_parcel_revisions (
  id uuid primary key default gen_random_uuid(),
  land_parcel_id uuid not null references public.land_parcels(id) on delete cascade,
  revision_kind text not null check (revision_kind in ('created', 'updated')),
  snapshot jsonb not null,
  geometry extensions.geometry(MultiPolygon, 4326) not null,
  changed_at timestamptz not null default now(),
  changed_by uuid references public.profiles(id) on delete set null
);

create index land_parcel_revisions_parcel_changed_idx
  on public.land_parcel_revisions (land_parcel_id, changed_at desc);

create or replace function public.touch_land_parcel()
returns trigger
language plpgsql
security invoker
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end;
$$;

create trigger touch_land_parcel
before insert or update on public.land_parcels
for each row execute function public.touch_land_parcel();

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

create trigger record_land_parcel_revision
after insert or update on public.land_parcels
for each row execute function public.record_land_parcel_revision();

alter table public.land_parcels enable row level security;
alter table public.land_parcel_asset_links enable row level security;
alter table public.land_parcel_revisions enable row level security;

create policy "admins read land parcels"
on public.land_parcels for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins manage land parcels"
on public.land_parcels for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins read land parcel asset links"
on public.land_parcel_asset_links for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins manage land parcel asset links"
on public.land_parcel_asset_links for all to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
)
with check (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create policy "admins read land parcel revisions"
on public.land_parcel_revisions for select to authenticated
using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = 'admin')
);

create view public.land_parcel_features
with (security_invoker = true)
as
select
  parcel.id,
  parcel.parcel_key,
  jsonb_build_object(
    'type', 'Feature',
    'id', parcel.parcel_key,
    'geometry', extensions.st_asgeojson(parcel.geometry)::jsonb,
    'properties', jsonb_build_object(
      'basic_info', jsonb_strip_nulls(jsonb_build_object(
        'county', parcel.county,
        'township', parcel.township,
        'section_code', parcel.section_code,
        'section_name', parcel.section_name,
        'land_number', parcel.land_number,
        'registration_date', parcel.registration_date,
        'area', parcel.area,
        'zoning', parcel.zoning,
        'land_use_type', parcel.land_use_type,
        'announced_land_value', parcel.announced_land_value,
        'announced_land_price', parcel.announced_land_price,
        'announced_price_date', parcel.announced_price_date
      )),
      'property_info', jsonb_strip_nulls(jsonb_build_object(
        'public_classification', parcel.public_classification,
        'property_number', parcel.property_number,
        'property_name', parcel.property_name,
        'acquisition_date', parcel.acquisition_date,
        'property_value', parcel.property_value
      )),
      'cadastral_link', parcel.cadastral_link,
      'documents', parcel.documents,
      'photos', parcel.photos,
      'notes', parcel.notes,
      'related_building_numbers', parcel.related_building_numbers
    )
  ) as feature
from public.land_parcels parcel
where parcel.is_active;

grant select on public.land_parcel_features to authenticated;
grant all on public.land_parcels, public.land_parcel_asset_links, public.land_parcel_revisions to service_role;
