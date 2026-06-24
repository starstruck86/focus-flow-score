
create table if not exists public.account_project_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_family text not null,
  custom_instructions text not null default '',
  pinned boolean not null default false,
  order_index bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account_family)
);

grant select, insert, update, delete on public.account_project_settings to authenticated;
grant all on public.account_project_settings to service_role;

alter table public.account_project_settings enable row level security;

create policy "users manage their own project settings"
  on public.account_project_settings
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_aps_user_family
  on public.account_project_settings (user_id, account_family);

create index if not exists idx_accounts_family_user
  on public.accounts (user_id, account_family)
  where deleted_at is null;

create trigger trg_aps_updated_at
  before update on public.account_project_settings
  for each row execute function public.update_updated_at_column();
