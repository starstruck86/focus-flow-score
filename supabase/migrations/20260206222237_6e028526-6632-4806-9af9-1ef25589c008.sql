-- Add UPDATE policy for calendar_events
CREATE POLICY "Users can update own calendar events"
ON public.calendar_events
FOR UPDATE
USING (auth.uid() = user_id);

-- Add DELETE policy for calendar_events
CREATE POLICY "Users can delete own calendar events"
ON public.calendar_events
FOR DELETE
USING (auth.uid() = user_id);