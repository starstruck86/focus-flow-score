alter table public.call_logs
  add column if not exists nba_situation text,
  add column if not exists nba_text text,
  add column if not exists nba_ki_titles text[];