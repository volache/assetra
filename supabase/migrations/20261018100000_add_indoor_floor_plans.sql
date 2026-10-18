-- Indoor floor plans: the rooms traced with prototypes/indoor-map, linked to the 存置地點 codes that
-- asset_records.location_code already uses.  Coordinates are the tracing tool's own drawing units (centimetres, y up),
-- one coordinate system per floor; no drawing underlay is stored, only the room outlines.
--
-- Applied to the Assetra project (name: add_indoor_floor_plans).  Version numbers are stamped when a migration is
-- applied, so they differ from this file's prefix.  Do not re-run it against the live database.
create table public.indoor_floors (
  id uuid primary key default gen_random_uuid(),
  floor_key text not null unique,           -- the tool's floor title, e.g. 航廈二樓: what an import matches on
  building text not null,
  label text not null,                      -- 一樓, 二樓, 機房 ...
  sort_order integer not null,              -- building by building, low floor to high
  unit text not null default 'cm',
  bounds jsonb,                             -- [minX, minY, maxX, maxY] of the rooms, so a viewer can fit the floor
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.indoor_spaces (
  id uuid primary key,                      -- the room's permanent uid from the tool, so a re-import updates the same room
  floor_id uuid not null references public.indoor_floors (id) on delete cascade,
  tool_id text,                             -- the id shown in the tool (T001 ...); only unique within a floor
  name text,
  usage text,                               -- 空間用途 note typed by hand
  space_type text not null default 'room' check (space_type in ('room', 'public', 'void')),
  ring jsonb not null,                      -- [[x, y], ...] outer outline
  holes jsonb not null default '[]'::jsonb, -- [[[x, y], ...], ...] parts taken by other rooms
  area_m2 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index indoor_spaces_floor_id_idx on public.indoor_spaces (floor_id);

-- A room can carry several 存置地點 codes (the same place under more than one code); one of them is the main one.
create table public.indoor_space_locations (
  space_id uuid not null references public.indoor_spaces (id) on delete cascade,
  location_code text not null,
  location_name text,                       -- the name as it was when the code was assigned
  is_primary boolean not null default false,
  primary key (space_id, location_code)
);
create unique index indoor_space_locations_one_primary on public.indoor_space_locations (space_id) where is_primary;
create index indoor_space_locations_code_idx on public.indoor_space_locations (location_code);

alter table public.indoor_floors enable row level security;
alter table public.indoor_spaces enable row level security;
alter table public.indoor_space_locations enable row level security;

-- Same reading rule as the inventory: any active user.  Only active administrators change anything.
create policy "active users read indoor floors" on public.indoor_floors for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);
create policy "active users read indoor spaces" on public.indoor_spaces for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);
create policy "active users read indoor space locations" on public.indoor_space_locations for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);

create policy "admins write indoor floors" on public.indoor_floors for all to authenticated
  using (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'))
  with check (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'));
create policy "admins write indoor spaces" on public.indoor_spaces for all to authenticated
  using (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'))
  with check (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'));
create policy "admins write indoor space locations" on public.indoor_space_locations for all to authenticated
  using (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'))
  with check (exists (select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.status = 'active' and r.role = 'admin'));
