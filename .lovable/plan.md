

# ElevenLabs Client Tool Registration Guide

All 36 tools formatted for the ElevenLabs "Add client tool" UI. For each tool I list the **Name**, **Description**, and each **Parameter** with its Data type, Identifier, Required status, and Description.

**Global defaults** (unless noted):
- Wait for response: ✅ checked (so Dave can speak the result)
- Disable interruptions: unchecked
- Pre-tool speech: Select (auto)
- Execution mode: Select (default)
- Value Type for all params: **LLM Prompt**

---

## 1. navigate
- **Description**: Navigate to a page in the app
- **Param 1**: String | `path` | Required | "The route path, e.g. /dashboard, /quota, /coach, /trends, /settings, /renewals, /outreach, /prep, /tasks"

## 2. create_task
- **Description**: Create a new task for the user
- **Param 1**: String | `title` | Required | "The task title"
- **Param 2**: String | `dueDate` | Not required | "Due date in YYYY-MM-DD format"
- **Param 3**: String | `priority` | Not required | "Priority level" | Enum: high, medium, low
- **Param 4**: String | `linkedAccount` | Not required | "Account name to link the task to"

## 3. update_account
- **Description**: Update a field on an account record
- **Param 1**: String | `accountName` | Required | "The account name to update"
- **Param 2**: String | `field` | Required | "The field to update, e.g. status, tier, owner, industry, next_step"
- **Param 3**: String | `value` | Required | "The new value for the field"

## 4. update_opportunity
- **Description**: Update a field on an opportunity record
- **Param 1**: String | `opportunityName` | Required | "The opportunity name"
- **Param 2**: String | `field` | Required | "The field to update, e.g. stage, arr, close_date, next_step, status"
- **Param 3**: String | `value` | Required | "The new value"

## 5. update_methodology
- **Description**: Update a MEDDICC methodology field on an opportunity
- **Param 1**: String | `opportunityName` | Required | "The opportunity name"
- **Param 2**: String | `field` | Required | "MEDDICC field" | Enum: metrics, economic_buyer, decision_criteria, decision_process, identify_pain, champion, competition
- **Param 3**: String | `value` | Required | "The updated value or notes"

## 6. log_touch
- **Description**: Log a touch or interaction with an account
- **Param 1**: String | `accountName` | Required | "The account name"
- **Param 2**: String | `touchType` | Required | "Type of touch" | Enum: call, email, meeting, linkedin, other
- **Param 3**: String | `notes` | Not required | "Notes about the interaction"

## 7. move_deal
- **Description**: Move an opportunity to a new stage
- **Param 1**: String | `opportunityName` | Required | "The opportunity name to move"
- **Param 2**: String | `newStage` | Required | "The new stage number or name, e.g. 1, 2, 3, 4, 5, Closed Won, Closed Lost"

## 8. add_note
- **Description**: Add a note to an account or opportunity
- **Param 1**: String | `target` | Required | "The account or opportunity name"
- **Param 2**: String | `note` | Required | "The note content"

## 9. lookup_account
- **Description**: Look up details about an account including contacts, opportunities, and recent activity
- **Param 1**: String | `accountName` | Required | "The account name to look up"

## 10. scenario_calc
- **Description**: Run a what-if scenario calculation for quota attainment
- **Param 1**: Number | `arr` | Required | "The ARR amount to simulate"
- **Param 2**: String | `description` | Not required | "Description of the scenario"

## 11. pipeline_pulse
- **Description**: Get a quick summary of the current pipeline health and key metrics
- *(No parameters)*

## 12. daily_briefing
- **Description**: Get today's daily briefing including meetings, tasks, and priorities
- *(No parameters)*

## 13. debrief
- **Description**: Log a meeting or call debrief with key takeaways
- **Param 1**: String | `accountName` | Required | "The account the meeting was about"
- **Param 2**: String | `summary` | Required | "Summary of what happened"
- **Param 3**: String | `nextSteps` | Not required | "Agreed next steps"
- **Param 4**: String | `sentiment` | Not required | "How the meeting went" | Enum: positive, neutral, negative

## 14. draft_email
- **Description**: Draft a follow-up or outreach email
- **Param 1**: String | `to` | Required | "Recipient name or email"
- **Param 2**: String | `subject` | Required | "Email subject line"
- **Param 3**: String | `body` | Required | "Email body content"

## 15. set_reminder
- **Description**: Set a reminder for a future date and time
- **Param 1**: String | `text` | Required | "What to be reminded about"
- **Param 2**: String | `dateTime` | Required | "When to remind, in YYYY-MM-DD or natural language like 'tomorrow at 3pm'"

## 16. open_copilot
- **Description**: Open the AI copilot with a specific question or request
- **Param 1**: String | `query` | Required | "The question or request to send to the copilot"

## 17. prep_meeting
- **Description**: Generate a meeting prep brief for an upcoming meeting
- **Param 1**: String | `accountName` | Required | "The account the meeting is with"
- **Param 2**: String | `meetingType` | Not required | "Type of meeting" | Enum: discovery, demo, negotiation, review, check-in

## 18. start_roleplay
- **Description**: Start a mock call roleplay simulation for practice
- **Param 1**: String | `scenario` | Not required | "The scenario to practice, e.g. cold call, discovery, objection handling"
- **Param 2**: String | `accountName` | Not required | "Account to use as context"

## 19. start_drill
- **Description**: Start an objection handling drill session
- **Param 1**: String | `objectionType` | Not required | "Type of objection to drill" | Enum: price, timing, competitor, status_quo

## 20. grade_call
- **Description**: Grade a call transcript for coaching feedback
- **Param 1**: String | `accountName` | Not required | "The account the call was with"

## 21. log_activity
- **Description**: Log a sales activity
- **Param 1**: String | `activityType` | Required | "Type of activity" | Enum: call, email, meeting, linkedin, research
- **Param 2**: String | `accountName` | Not required | "Account name if applicable"
- **Param 3**: String | `notes` | Not required | "Notes about the activity"

---

## NEW TOOLS (22–36)

## 22. update_daily_metrics
- **Description**: Update the user's daily activity metrics like calls, connects, emails, meetings set. Use mode 'add' to increment or 'set' to replace the value.
- **Wait for response**: ✅
- **Param 1**: String | `metric` | Required | "The metric to update: calls, dials, connects, conversations, emails, manual_emails, meetings, meetings_set, prospects, prospects_added, customer_meetings, opps_created, opportunities_created, accounts_researched, contacts_prepped"
- **Param 2**: Number | `value` | Required | "The number to add or set"
- **Param 3**: String | `mode` | Not required | "Whether to add to or replace the current value" | Enum: add, set

## 23. get_daily_metrics
- **Description**: Get the user's daily activity metrics for today including calls, connects, emails, meetings set, and more
- **Wait for response**: ✅
- *(No parameters)*

## 24. add_contact
- **Description**: Add a new contact to the CRM
- **Wait for response**: ✅
- **Param 1**: String | `name` | Required | "Full name of the contact"
- **Param 2**: String | `accountName` | Not required | "Account the contact belongs to"
- **Param 3**: String | `title` | Not required | "Job title"
- **Param 4**: String | `email` | Not required | "Email address"

## 25. lookup_contact
- **Description**: Look up contacts at a specific account
- **Wait for response**: ✅
- **Param 1**: String | `accountName` | Required | "The account name to look up contacts for"

## 26. create_opportunity
- **Description**: Create a new opportunity/deal in the pipeline
- **Wait for response**: ✅
- **Param 1**: String | `name` | Required | "Opportunity name"
- **Param 2**: String | `accountName` | Required | "Account name"
- **Param 3**: Number | `arr` | Not required | "Annual recurring revenue amount"
- **Param 4**: String | `stage` | Not required | "Deal stage, e.g. 1, 2, 3, discovery, negotiation"

## 27. lookup_renewal
- **Description**: Look up upcoming renewals, optionally filtered to a time range
- **Wait for response**: ✅
- **Param 1**: String | `timeRange` | Not required | "Time range like 'this quarter', 'next 30 days', 'this month'. Defaults to this quarter."

## 28. update_renewal
- **Description**: Update a renewal record's health status or risk reason
- **Wait for response**: ✅
- **Param 1**: String | `accountName` | Required | "The account name for the renewal"
- **Param 2**: String | `health` | Not required | "Renewal health status" | Enum: green, yellow, red
- **Param 3**: String | `riskReason` | Not required | "Reason for the risk status"

## 29. complete_task
- **Description**: Mark a task as complete by searching for it by name
- **Wait for response**: ✅
- **Param 1**: String | `taskName` | Required | "The task title or partial match to find and complete"

## 30. list_tasks
- **Description**: List the user's tasks for today or upcoming tasks
- **Wait for response**: ✅
- **Param 1**: String | `filter` | Not required | "Filter tasks" | Enum: today, overdue, upcoming, all

## 31. get_calendar
- **Description**: Get the user's calendar events for today or tomorrow
- **Wait for response**: ✅
- **Param 1**: String | `day` | Not required | "Which day to check" | Enum: today, tomorrow

## 32. quota_status
- **Description**: Get the user's current quota attainment, showing closed won vs target with percentage
- **Wait for response**: ✅
- *(No parameters)*

## 33. log_reflection
- **Description**: Log a daily reflection including what worked, blockers, and lessons learned
- **Wait for response**: ✅
- **Param 1**: String | `whatWorked` | Not required | "What went well today"
- **Param 2**: String | `blocker` | Not required | "Main blocker or challenge"
- **Param 3**: String | `lesson` | Not required | "Key lesson or takeaway"

## 34. check_in
- **Description**: Check the user in for today, marking their daily check-in as complete
- **Wait for response**: ✅
- *(No parameters)*

## 35. lookup_transcript
- **Description**: Look up the most recent call transcript for an account
- **Wait for response**: ✅
- **Param 1**: String | `accountName` | Required | "The account name to find transcripts for"

## 36. start_power_hour
- **Description**: Start a power hour focused calling session
- **Wait for response**: ✅
- *(No parameters)*

---

## Setup Tips

1. Add each tool one at a time using **Add client tool**
2. For tools with no parameters, just fill Name + Description and save
3. For enum values, add each value one at a time using the **+** button
4. The **Identifier** field is the parameter name (e.g. `path`, `metric`, `value`)
5. Leave Dynamic Variables and Dynamic Variable Assignments empty for all tools
6. **"Wait for response"** should be checked for all tools so Dave can speak the result back

This is a one-time setup. Once registered, Dave will be able to invoke all 36 tools via voice.

