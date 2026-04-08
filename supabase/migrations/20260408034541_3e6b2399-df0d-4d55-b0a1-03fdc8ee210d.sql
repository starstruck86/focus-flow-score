
-- Clear stale extraction_batches for 32 remaining api_failure resources
DELETE FROM extraction_batches WHERE resource_id IN (
  'c85a0675-48ea-4ee1-8edd-c3ea731f6fdf','32af2f9e-f90d-4d6d-b557-f63c94125b78',
  '438a618c-3362-4627-8cf9-e9ebfcb4d5d0','2f83ec30-cd08-4a8e-a24b-cd2a1e328a4c',
  '19821aaf-e6f7-47e2-b8fb-2583476e85b0','c0562a52-b0e5-4d0e-a44a-9d9bec5ae5fa',
  'cd6f2099-a606-4c49-b62c-154ba9124858','e23937e1-284b-46e4-90d7-810ae93e904b',
  'a072f7e7-78ad-4681-a735-f42776100553','d8187824-748d-45af-8346-9fbbaf798c63',
  '1f4fd1e8-d739-489f-af44-2b5df3dae8e1','f066a684-5762-41eb-b213-5fa2c40b76b0',
  '80f54487-0027-4137-b55b-e9053812032b','c1df9ffc-4b9a-4755-9372-1c2fc0f678f0',
  '07a7f828-a362-4f93-b44d-8fdb53aa522f','387c8172-b5d0-4ec4-ab9a-89103c2a516a',
  '15bbc347-a8a9-4129-af49-72c2d1fec6c4','0e029550-a2ed-45d8-b29a-30bc8b27e9a0',
  '7733ba41-a776-44ae-bd95-0a46f4c0c484','c7f3ed30-b2a8-44e1-88bb-1c073b7b5a91',
  '146bea2e-80d2-421f-8433-3ea948d56332','c18f23a0-cbe0-475d-85c6-23d69a6ffc5e',
  '29dc1509-16f7-45c1-a96f-2299dbc7a562','a38e7319-f313-42d7-959c-79f867b7807a',
  '95eb1aa3-136f-4aee-8ff8-b90dfa585d67','b6087ed8-d683-4269-9198-7da1aff1ab68',
  'c3ce5f88-91d3-42b2-bf7e-daab52ee393c','5de0f677-cded-4eb8-83d1-768c7806bd6a',
  '13ee3ee3-e5f4-4284-8740-ff384f4acd4e','0afa0161-e561-4ceb-b75f-f2589991cd83',
  'eb780e6f-bbdf-43f9-a96b-ad17fb566a1c','be377622-97ef-4a4a-b447-ab6aff519617'
);

-- Reset resource state for fresh reruns
UPDATE resources SET 
  active_job_status = NULL,
  active_job_started_at = NULL,
  active_job_updated_at = NULL,
  extraction_batch_status = NULL,
  enrichment_status = 'extraction_retrying',
  extraction_retry_eligible = true
WHERE id IN (
  'c85a0675-48ea-4ee1-8edd-c3ea731f6fdf','32af2f9e-f90d-4d6d-b557-f63c94125b78',
  '438a618c-3362-4627-8cf9-e9ebfcb4d5d0','2f83ec30-cd08-4a8e-a24b-cd2a1e328a4c',
  '19821aaf-e6f7-47e2-b8fb-2583476e85b0','c0562a52-b0e5-4d0e-a44a-9d9bec5ae5fa',
  'cd6f2099-a606-4c49-b62c-154ba9124858','e23937e1-284b-46e4-90d7-810ae93e904b',
  'a072f7e7-78ad-4681-a735-f42776100553','d8187824-748d-45af-8346-9fbbaf798c63',
  '1f4fd1e8-d739-489f-af44-2b5df3dae8e1','f066a684-5762-41eb-b213-5fa2c40b76b0',
  '80f54487-0027-4137-b55b-e9053812032b','c1df9ffc-4b9a-4755-9372-1c2fc0f678f0',
  '07a7f828-a362-4f93-b44d-8fdb53aa522f','387c8172-b5d0-4ec4-ab9a-89103c2a516a',
  '15bbc347-a8a9-4129-af49-72c2d1fec6c4','0e029550-a2ed-45d8-b29a-30bc8b27e9a0',
  '7733ba41-a776-44ae-bd95-0a46f4c0c484','c7f3ed30-b2a8-44e1-88bb-1c073b7b5a91',
  '146bea2e-80d2-421f-8433-3ea948d56332','c18f23a0-cbe0-475d-85c6-23d69a6ffc5e',
  '29dc1509-16f7-45c1-a96f-2299dbc7a562','a38e7319-f313-42d7-959c-79f867b7807a',
  '95eb1aa3-136f-4aee-8ff8-b90dfa585d67','b6087ed8-d683-4269-9198-7da1aff1ab68',
  'c3ce5f88-91d3-42b2-bf7e-daab52ee393c','5de0f677-cded-4eb8-83d1-768c7806bd6a',
  '13ee3ee3-e5f4-4284-8740-ff384f4acd4e','0afa0161-e561-4ceb-b75f-f2589991cd83',
  'eb780e6f-bbdf-43f9-a96b-ad17fb566a1c','be377622-97ef-4a4a-b447-ab6aff519617'
);
