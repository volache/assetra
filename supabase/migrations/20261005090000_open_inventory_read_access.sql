-- All active users may read current inventory; writes and ownership documents keep their own restrictions.
drop policy if exists "active users read permitted inventory" on public.asset_records;
create policy "active users read inventory" on public.asset_records for select to authenticated using (
  is_current and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);
