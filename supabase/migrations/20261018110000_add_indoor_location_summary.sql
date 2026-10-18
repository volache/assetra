-- Applied to the Assetra project as part of the indoor floor plan work.  Version numbers are stamped when a migration is
-- applied, so they differ from this file's prefix.  Do not re-run it against the live database.
--
-- One row per 存置地點 code: how many current assets sit there.  Runs with the caller's rights, so the inventory's own
-- row-level security decides what each person counts.
create view public.indoor_location_summary with (security_invoker = true) as
select location_code, max(location_name) as location_name, count(*)::integer as asset_count
from public.asset_records
where is_current and location_code is not null
group by location_code;
grant select on public.indoor_location_summary to authenticated;
