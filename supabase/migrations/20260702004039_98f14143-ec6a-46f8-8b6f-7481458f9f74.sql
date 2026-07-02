
CREATE TABLE public.flashcard_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('curriculum_topic','resource','chapter')),
  source_ref text NOT NULL,
  spoke text,
  title text,
  description text,
  generation_status text NOT NULL DEFAULT 'empty' CHECK (generation_status IN ('empty','generating','complete','failed')),
  card_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_ref)
);
GRANT SELECT ON public.flashcard_decks TO authenticated;
GRANT ALL ON public.flashcard_decks TO service_role;
ALTER TABLE public.flashcard_decks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "decks readable by authenticated" ON public.flashcard_decks FOR SELECT TO authenticated USING (true);
CREATE POLICY "decks writable by service role" ON public.flashcard_decks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.flashcards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deck_id uuid NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE,
  ki_id uuid NOT NULL,
  concept_id text,
  card_type text NOT NULL CHECK (card_type IN ('trigger','definition','talk_track')),
  front text NOT NULL,
  back text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  generation_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deck_id, ki_id, card_type)
);
CREATE INDEX flashcards_deck_idx ON public.flashcards(deck_id);
GRANT SELECT ON public.flashcards TO authenticated;
GRANT ALL ON public.flashcards TO service_role;
ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cards readable by authenticated" ON public.flashcards FOR SELECT TO authenticated USING (true);
CREATE POLICY "cards writable by service role" ON public.flashcards FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.flashcard_state (
  user_id uuid NOT NULL,
  card_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE,
  confidence smallint CHECK (confidence BETWEEN 1 AND 5),
  times_seen int NOT NULL DEFAULT 0,
  last_seen_at timestamptz,
  due_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, card_id)
);
CREATE INDEX flashcard_state_due_idx ON public.flashcard_state(user_id, due_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_state TO authenticated;
GRANT ALL ON public.flashcard_state TO service_role;
ALTER TABLE public.flashcard_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "state select own" ON public.flashcard_state FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "state insert own" ON public.flashcard_state FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "state update own" ON public.flashcard_state FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "state delete own" ON public.flashcard_state FOR DELETE TO authenticated USING (auth.uid() = user_id);
