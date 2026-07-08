
ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_opportunities_archived_at ON public.opportunities(archived_at) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_call_transcripts_archived_at ON public.call_transcripts(archived_at) WHERE archived_at IS NULL;

-- W2: Quarantine Acoustic-era opportunities (no current-account linkage)
UPDATE public.opportunities
SET archived_at = now()
WHERE archived_at IS NULL
  AND (
    account_id IS NULL
    OR account_id NOT IN (SELECT id FROM public.accounts WHERE deleted_at IS NULL)
  );

-- W2: Quarantine Acoustic-era call transcripts (keep only Branch-role interview mocks)
UPDATE public.call_transcripts
SET archived_at = now()
WHERE archived_at IS NULL
  AND title !~* '(Iterable|Klaviyo|GC\.ai|Branch\.io)';
