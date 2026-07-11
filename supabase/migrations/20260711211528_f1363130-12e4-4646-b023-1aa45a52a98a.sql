UPDATE public.territory_profile
SET territory_description = '13 enterprise accounts (21 active including sub-brands)'
WHERE user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';

SELECT id, user_id, role, quota_amount, quota_currency, quota_type, motion, territory_description
FROM public.territory_profile
WHERE user_id = '9f11e308-4028-4527-b7ba-5ea365dc1441';