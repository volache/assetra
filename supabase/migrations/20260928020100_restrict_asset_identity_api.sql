-- Identities are internal reconciliation anchors and are only accessed by
-- trusted database/Edge Function flows, never directly by client users.
create policy "asset identities are service managed"
on public.asset_identities for select to authenticated
using (false);
