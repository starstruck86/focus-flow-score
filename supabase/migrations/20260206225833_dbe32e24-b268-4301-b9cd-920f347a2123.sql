-- Add INSERT policy for calendar_events to prevent unauthorized event creation
CREATE POLICY "Users can insert own calendar events"
ON public.calendar_events
FOR INSERT
WITH CHECK (auth.uid() = user_id);