ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS parent_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS account_family text;

UPDATE public.accounts SET
  parent_account_id = 'f3493bd1-1ab4-45c4-9167-311c28cca108',
  account_family = 'Comcast/NBCUniversal'
WHERE id = '0ccf2e80-5823-4377-8e64-eda859f74877'
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

UPDATE public.accounts SET
  parent_account_id = '0ccf2e80-5823-4377-8e64-eda859f74877',
  account_family = 'Comcast/NBCUniversal'
WHERE id IN ('7311d1ba-11bd-4b10-af72-76faeae202ad', '24a40942-6c17-49ea-ace6-fe1c9b11fd6b')
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

UPDATE public.accounts SET account_family = 'Comcast/NBCUniversal'
WHERE id = 'f3493bd1-1ab4-45c4-9167-311c28cca108'
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

UPDATE public.accounts SET
  parent_account_id = '4269249e-b1e7-47ad-b5b5-361b0ed0cb63',
  account_family = 'Disney'
WHERE id = '95269c10-5a51-4f0c-9333-904d7630d027'
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

UPDATE public.accounts SET account_family = 'Disney'
WHERE id = '4269249e-b1e7-47ad-b5b5-361b0ed0cb63'
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

UPDATE public.accounts SET account_family = 'A&E Networks'
WHERE id = '77e9ff81-5323-4b1b-9efd-a502411a359a'
  AND user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';