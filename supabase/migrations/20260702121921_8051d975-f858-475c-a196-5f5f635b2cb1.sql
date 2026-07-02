DELETE FROM public.flashcard_state WHERE card_id IN (SELECT id FROM public.flashcards WHERE deck_id = 'e9f5ba11-da36-4704-a977-4ce092f7fc3c');
DELETE FROM public.flashcards WHERE deck_id = 'e9f5ba11-da36-4704-a977-4ce092f7fc3c';
UPDATE public.flashcard_decks SET card_count = 0, generation_status = 'empty' WHERE id = 'e9f5ba11-da36-4704-a977-4ce092f7fc3c';