-- Notes are reference context, while every non-note kind is an actionable task.
-- Keep the legacy transfer_request enum value readable; new records use `other`.
alter type public.collaboration_kind add value if not exists 'custodian_change';
alter type public.collaboration_kind add value if not exists 'location_change';
alter type public.collaboration_kind add value if not exists 'other';

alter table public.asset_collaborations
  alter column status drop default,
  alter column status drop not null;

update public.asset_collaborations
set status = null
where kind = 'note';

alter table public.asset_collaborations
  add constraint asset_collaborations_note_or_task_status_check
  check (
    (kind = 'note' and status is null)
    or (kind <> 'note' and status is not null)
  );

create index asset_collaborations_open_tasks_idx
  on public.asset_collaborations (asset_identity_id, status, updated_at desc)
  where kind <> 'note' and status in ('open', 'in_progress');
