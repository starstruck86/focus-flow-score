import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  FileText, Mail, Presentation, Target, Shield, BarChart3, Users, MessageSquare,
} from 'lucide-react';

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: { title: string; content: string; type: string }) => void;
}

const TEMPLATES = [
  {
    id: 'discovery',
    title: 'Discovery Prep',
    icon: Target,
    type: 'prep',
    category: 'Meeting Prep',
    description: 'Research brief for discovery calls',
    content: `# Discovery Prep: [Account Name]

## Company Overview
- **Industry:** 
- **Size:** 
- **Key Products/Services:** 

## Key Stakeholders
| Name | Title | Role in Deal | Notes |
|------|-------|-------------|-------|
|      |       |             |       |

## Business Context
### Current Situation
- 

### Potential Pain Points
1. 
2. 
3. 

### Trigger Events / Timing Signals
- 

## Discovery Questions
### Situation
1. Can you walk me through your current process for...?
2. How is your team currently handling...?

### Problem
1. What challenges are you facing with...?
2. What happens when...?

### Impact
1. How does this impact your...?
2. What would it mean for your team if...?

### Need-Payoff
1. If you could solve this, what would that look like?
2. What would success look like in 6 months?

## Competitive Landscape
- **Known competitors:** 
- **Our differentiators:** 

## Call Objectives
1. Understand their current workflow
2. Identify 2-3 pain points
3. Confirm next steps and timeline

## Next Steps
- [ ] Research completed
- [ ] Questions prepared
- [ ] Calendar invite confirmed
`,
  },
  {
    id: 'followup',
    title: 'Follow-Up Email',
    icon: Mail,
    type: 'email',
    category: 'Communication',
    description: 'Post-meeting follow-up template',
    content: `# Follow-Up Email: [Meeting Topic]

## Subject Line
Re: [Meeting Topic] — Next Steps & Summary

## Email Body

Hi [Name],

Thank you for taking the time to meet today. I appreciated learning more about [specific thing discussed].

### Key Takeaways
1. **[Pain Point 1]** — You mentioned that...
2. **[Pain Point 2]** — We discussed how...
3. **[Opportunity]** — There's an opportunity to...

### Agreed Next Steps
- [ ] [Your action item] — by [date]
- [ ] [Their action item] — by [date]
- [ ] [Shared action item] — by [date]

### Resources
- [Relevant case study or resource]
- [Product documentation link]

### Next Meeting
I've sent a calendar invite for [date/time] to [agenda for next meeting].

Looking forward to continuing the conversation.

Best,
[Your Name]
`,
  },
  {
    id: 'qbr',
    title: 'QBR Deck Outline',
    icon: Presentation,
    type: 'presentation',
    category: 'Reviews',
    description: 'Quarterly business review structure',
    content: `# Quarterly Business Review: [Account Name]
## Q[X] [Year]

---

## Agenda
1. Partnership Overview
2. Key Metrics & ROI
3. Wins & Milestones
4. Challenges & Solutions
5. Roadmap & Recommendations
6. Next Quarter Priorities

---

## Partnership Overview
- **Contract Start:** 
- **Current ARR:** 
- **Products in Use:** 
- **Key Stakeholders:** 

---

## Key Metrics & ROI

| Metric | Baseline | Current | Change |
|--------|----------|---------|--------|
|        |          |         |        |

### ROI Summary
- **Time Saved:** 
- **Revenue Impact:** 
- **Cost Reduction:** 

---

## Wins & Milestones
1. ✅ 
2. ✅ 
3. ✅ 

---

## Challenges & Solutions
| Challenge | Root Cause | Solution | Status |
|-----------|-----------|----------|--------|
|           |           |          |        |

---

## Roadmap & Recommendations
### Short-term (Next 30 Days)
- 

### Medium-term (Next Quarter)
- 

### Long-term (Next 6-12 Months)
- 

---

## Next Quarter Priorities
1. 
2. 
3. 

---

## Questions & Discussion
`,
  },
  {
    id: 'roi',
    title: 'ROI Analysis',
    icon: BarChart3,
    type: 'document',
    category: 'Business Case',
    description: 'Return on investment calculation',
    content: `# ROI Analysis: [Solution] for [Account]

## Executive Summary
[One paragraph summarizing the business case]

## Current State Costs

### Direct Costs
| Cost Category | Annual Cost | Notes |
|--------------|-------------|-------|
| Current solution licensing | $ | |
| Manual process labor hours | $ | |
| Error/rework costs | $ | |
| **Total Current Costs** | **$** | |

### Hidden Costs
- Opportunity cost of slow processes: $
- Employee turnover due to frustration: $
- Compliance risk exposure: $

## Proposed Solution Investment

| Investment | Cost | Frequency |
|-----------|------|-----------|
| Platform licensing | $ | Annual |
| Implementation | $ | One-time |
| Training | $ | One-time |
| **Total Year 1** | **$** | |
| **Total Year 2+** | **$** | |

## Expected Returns

### Quantifiable Benefits
| Benefit | Annual Value | Confidence |
|---------|-------------|------------|
| Time savings | $ | High |
| Error reduction | $ | Medium |
| Revenue acceleration | $ | Medium |
| **Total Annual Benefits** | **$** | |

### Strategic Benefits
- Improved visibility and reporting
- Scalability for growth
- Competitive advantage

## ROI Calculation
- **Net Benefit Year 1:** $
- **Net Benefit Year 2:** $
- **3-Year ROI:** X%
- **Payback Period:** X months

## Risk Factors
1. 
2. 

## Recommendation
[Clear recommendation with next steps]
`,
  },
  {
    id: 'executive',
    title: 'Executive Summary',
    icon: Users,
    type: 'document',
    category: 'Communication',
    description: 'C-level overview document',
    content: `# Executive Summary: [Topic]

## The Opportunity
[2-3 sentences describing the business opportunity]

## Current Challenges
1. **[Challenge 1]** — Impact: [quantified impact]
2. **[Challenge 2]** — Impact: [quantified impact]
3. **[Challenge 3]** — Impact: [quantified impact]

## Proposed Solution
[Brief description of the solution and why it's the right fit]

### Key Differentiators
- 
- 
- 

## Expected Outcomes
| Outcome | Timeline | Metric |
|---------|----------|--------|
|         |          |        |

## Investment & ROI
- **Investment:** $X
- **Expected ROI:** X% over [timeframe]
- **Payback Period:** X months

## Risk Mitigation
- 

## Recommended Next Steps
1. [Immediate action] — [date]
2. [Follow-up action] — [date]
3. [Decision point] — [date]

## Team
| Name | Role | Responsibility |
|------|------|---------------|
|      |      |               |
`,
  },
  {
    id: 'competitive',
    title: 'Competitive Pitch',
    icon: Shield,
    type: 'battlecard',
    category: 'Sales',
    description: 'Competitive positioning guide',
    content: `# Competitive Pitch: Us vs. [Competitor]

## Quick Reference
- **Our Strengths:** 
- **Their Weaknesses:** 
- **Key Differentiator:** 

## Positioning Statement
When the prospect mentions [Competitor], lead with:
> "[Positioning statement that acknowledges competitor and pivots to our strength]"

## Feature Comparison
| Capability | Us | Competitor | Why It Matters |
|-----------|-----|-----------|---------------|
|           | ✅  | ❌        |               |

## Common Objections & Responses

### "We're already using [Competitor]"
**Acknowledge:** "That makes sense — they're well-known in this space."
**Reframe:** "What we hear from customers who've switched is..."
**Redirect:** "Would it be worth 15 minutes to see how we handle [specific pain point]?"

### "[Competitor] is cheaper"
**Acknowledge:** "Price is definitely important."
**Reframe:** "When you factor in [hidden cost], the total cost of ownership..."
**Redirect:** "Let me show you the ROI our customers typically see..."

## Win Stories
### [Customer Name]
- **Situation:** Switched from [Competitor]
- **Why they switched:** 
- **Results:** 
- **Quote:** ""

## Landmines to Plant
1. Ask about [specific capability they lack]
2. Ask about [pain point their customers have]
3. Ask about [scaling limitation]

## Do NOT Say
- ❌ [Negative statement to avoid]
- ❌ [Another thing to avoid]
`,
  },
  {
    id: 'cold-outreach',
    title: 'Cold Outreach',
    icon: MessageSquare,
    type: 'email',
    category: 'Prospecting',
    description: 'Multi-touch outreach sequence',
    content: `# Cold Outreach Sequence: [Persona/Vertical]

## Touch 1: Initial Email
**Subject:** [Personalized subject line]

Hi [First Name],

[Opening line referencing trigger event, mutual connection, or specific observation about their company]

[One sentence about the problem you solve — tied to their world]

[Social proof: "Companies like [similar company] have seen [specific result]"]

Would it make sense to connect for 15 minutes this week?

[Your Name]

---

## Touch 2: Follow-Up (Day 3)
**Subject:** Re: [Previous subject]

Hi [First Name],

Quick follow-up — [add new value or insight not in first email].

[Brief case study or data point]

Worth a conversation?

---

## Touch 3: LinkedIn (Day 5)
Connect request with note:
"Hi [Name], I noticed [observation]. I work with [similar companies] on [problem]. Would love to connect."

---

## Touch 4: Breakup Email (Day 8)
**Subject:** Should I close your file?

Hi [First Name],

I've reached out a couple times about [problem/solution]. I don't want to be a pest.

If the timing isn't right, no worries — I'll close out your file. But if [problem] is still on your radar, I'd love to help.

Either way, wishing you a great [quarter/week].

[Your Name]

---

## Personalization Notes
- **Trigger events to reference:** 
- **Relevant case studies:** 
- **Industry-specific language:** 
`,
  },
  {
    id: 'meeting-recap',
    title: 'Meeting Recap',
    icon: FileText,
    type: 'document',
    category: 'Internal',
    description: 'Internal meeting summary & actions',
    content: `# Meeting Recap: [Account/Topic]
**Date:** [Date]  
**Attendees:** [Names]  
**Duration:** [X] minutes

## Summary
[2-3 sentence overview of the meeting]

## Key Discussion Points
1. **[Topic 1]**
   - 
   
2. **[Topic 2]**
   - 

3. **[Topic 3]**
   - 

## Decisions Made
- ✅ 
- ✅ 

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
|        |       |          | 🔲     |

## Deal Impact
- **Stage Movement:** [Current] → [Next]
- **Confidence Change:** [Up/Down/Same]
- **Risk Flags:** 
- **Next Meeting:** [Date/Topic]

## Internal Notes
[Anything not to share with the customer]
`,
  },
];

export function TemplatePicker({ open, onOpenChange, onSelect }: TemplatePickerProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Start from Template</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto max-h-[60vh] pr-1">
          {TEMPLATES.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => {
                  onSelect({ title: t.title, content: t.content, type: t.type });
                  onOpenChange(false);
                }}
                className="flex flex-col items-start gap-2 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-accent/30 transition-all text-left group"
              >
                <div className="flex items-center gap-2 w-full">
                  <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.title}</p>
                    <Badge variant="outline" className="text-[9px] mt-0.5">{t.category}</Badge>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{t.description}</p>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
