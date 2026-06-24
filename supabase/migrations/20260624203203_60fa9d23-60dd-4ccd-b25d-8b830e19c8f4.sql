
create table if not exists public.strategy_custom_pills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null,
  name text not null,
  description text default '',
  instruction text default '',
  fields jsonb default '[]'::jsonb,
  prompt_template text default '',
  output_type text default 'chat',
  run_mode text default 'insert',
  ask_clarifying boolean default false,
  is_active boolean default true,
  order_index bigint,
  attachments jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

grant select, insert, update, delete on public.strategy_custom_pills to authenticated;
grant all on public.strategy_custom_pills to service_role;

alter table public.strategy_custom_pills enable row level security;

create policy "Users manage own custom pills"
  on public.strategy_custom_pills
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists idx_custom_pills_user_surface
  on public.strategy_custom_pills(user_id, surface);

create trigger strategy_custom_pills_updated_at
  before update on public.strategy_custom_pills
  for each row execute function public.update_updated_at_column();
