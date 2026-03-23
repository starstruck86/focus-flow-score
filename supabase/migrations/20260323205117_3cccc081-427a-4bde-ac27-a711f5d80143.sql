ALTER TABLE public.dismissed_duplicates
  ADD CONSTRAINT dismissed_duplicates_user_type_key_unique
  UNIQUE (user_id, record_type, duplicate_key);