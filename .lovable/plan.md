

# Plan: Dave Conversational AI — Full ElevenLabs WebRTC Implementation

## What We're Building
Replace Dave's current record-upload-transcribe-process-TTS pipeline with ElevenLabs Conversational AI (WebRTC). One persistent audio connection, sub-300ms latency, natural turn-taking, barge-in, and client tools that execute app actions mid-conversation.

## Prerequisites
- `ELEVENLABS_API_KEY` already exists as a secret
- `@elevenlabs/react` already installed
- You need to create an ElevenLabs Conversational AI Agent in their dashboard and provide the Agent ID. I'll store it as `ELEVENLABS_AGENT_ID` secret and walk you through agent setup after building

## Changes

### 1. New Secret: `ELEVENLABS_AGENT_ID`
Prompt you to add the Agent ID after you create the agent in ElevenLabs dashboard.

### 2. Database Migration: `voice_reminders` table
```sql
CREATE TABLE voice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  message text NOT NULL,
  remind_at timestamptz NOT NULL,
  delivered boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE voice_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their reminders" ON voice_reminders
  FOR ALL TO authenticated USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

### 3. New Edge Function: `supabase/functions/dave-conversation-token/index.ts`
- Authenticates user via JWT
- Calls ElevenLabs API to generate a single-use WebRTC conversation token using `ELEVENLABS_AGENT_ID`
- Fetches dynamic context (calendar events, accounts, tasks, pipeline stats, pending voice reminders) from database
- Returns token + context string + `firstMessage` override (proactive briefing before 10am)
- Time-of-day logic: morning briefing vs. afternoon/evening greeting

### 4. New Hook: `src/hooks/useDaveContext.ts`
- Fetches and formats dynamic context for Dave's system prompt overrides
- Includes: upcoming meetings, recent accounts, open/overdue tasks, pipeline stats, pending reminders, current page
- Generates `firstMessage` text for proactive morning briefing
- Returns context object consumed by the conversation overlay

### 5. New Component: `src/components/DaveConversationMode.tsx`
Full-screen conversational overlay — the core