
ALTER TABLE public.tasks DROP CONSTRAINT tasks_linked_opportunity_id_fkey;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_linked_opportunity_id_fkey 
  FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.renewals DROP CONSTRAINT renewals_linked_opportunity_id_fkey;
ALTER TABLE public.renewals ADD CONSTRAINT renewals_linked_opportunity_id_fkey 
  FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.call_transcripts DROP CONSTRAINT call_transcripts_opportunity_id_fkey;
ALTER TABLE public.call_transcripts ADD CONSTRAINT call_transcripts_opportunity_id_fkey 
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;

ALTER TABLE public.resource_links DROP CONSTRAINT resource_links_opportunity_id_fkey;
ALTER TABLE public.resource_links ADD CONSTRAINT resource_links_opportunity_id_fkey 
  FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;
