-- Add contact_status column to accounts table
ALTER TABLE public.accounts 
ADD COLUMN contact_status text DEFAULT 'not-started';
