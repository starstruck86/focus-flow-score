
-- For renewal opportunities where prior_contract_arr is null, 
-- set prior_contract_arr = arr (the account's current spend)
-- and renewal_arr = arr (flat renewal assumption)
UPDATE opportunities 
SET prior_contract_arr = arr, renewal_arr = arr 
WHERE prior_contract_arr IS NULL 
  AND renewal_arr IS NULL 
  AND arr IS NOT NULL
  AND name LIKE '%Renewal%';
