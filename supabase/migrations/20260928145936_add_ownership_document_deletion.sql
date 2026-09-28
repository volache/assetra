alter table public.ownership_documents
  add column replaces_document_id uuid references public.ownership_documents(id) on delete set null,
  add column deleted_at timestamptz,
  add column deleted_by uuid references public.profiles(id) on delete set null;

alter table public.ownership_documents
  drop constraint ownership_documents_status_check,
  add constraint ownership_documents_status_check
    check (status in ('pending', 'active', 'superseded', 'deleted'));

alter table public.ownership_document_access_logs
  drop constraint ownership_document_access_logs_action_check,
  add constraint ownership_document_access_logs_action_check
    check (action in ('view', 'download', 'upload', 'delete'));
