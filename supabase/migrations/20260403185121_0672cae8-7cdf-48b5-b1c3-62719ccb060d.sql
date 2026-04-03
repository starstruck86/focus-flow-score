UPDATE resources 
SET content = replace(content, '[BODY_PLACEHOLDER]', (
  -- The lesson body will be injected via the placeholder replacement
  SELECT '[Wistia Video: 8hbepqbtld]

I''ve reviewed accounts with hundreds of reps in my career. When scoring accounts, most reps place too much weight on revenue and employee count. 

They default to, "the bigger the account, the bigger the opportunity."

If they work for a mature company, they will often put too much weight on an internally calculated "Account Score" heavily influenced by revenue and employee count. 

Heavy reliance on any of these three metrics is ineffective for two reasons: 

Data quality (especially for privately held companies) is usually garbage

These quantitative measures don''t tell the whole story

I doubt the "data quality sucks" statement is surprising to you. I''ve never spoken to a salesperson that thought they had great CRM data. 

The impact is painful: ops will highlight accounts for you to work based on revenue and employee count numbers that are often wrong. 

However, even if you have perfect data for every company in your patch, there''s more nuance in territory management than just numbers. 

For example, which of these two companies would you rather prospect into:

Company A: $500 million revenue, 2,000 employees, no clear use case for your product

Company B: $50 million revenue, 500 employees, multiple clear use cases for your product

If you are like me, you chose the latter. 

But are you prioritizing your current territory accordingly? Or, are you over-indexing on account size and growing frustrated as you are unable to open many conversations? 

Allow me to introduce the Prioritization Framework I''ve used as an AE, manager, director, and VP: Use Case and Budget. 

Some quick definitions: 

Use Case: You can identify where and how your product would be used. 

At LaunchDarkly, this would be as simple as, "Does this company build software?" If they build software, they need to optimize and de-risk software releases. 

It''s even better when you see multiple use cases for your product within the same account. Multiple use cases means multiple ways to break in. 

Budget: The company likely invests, or would invest, in solutions like yours. 

I get a lot of questions on this criteria: "How can I know if they have budget without talking to them?" 

What I''m looking for is the potential that they have budget - not that they''ve already allocated budget. 

My three favorite signals for potential budget are the use of a competitor, headcount growth in your target department, or relevant problems and priorities. 

1) The use of a competitive solution

I look for competitive solutions by searching their current employee''s LinkedIn profiles for competitor names as well as looking at open job descriptions. 

People often list tools they use on their profile.  

Companies nearly always list solutions they use on job descriptions, hoping to find applicants that already know how to use those solutions. 

If they are spending on a competitor, there''s potential budget for you to capture.

2) Headcount growth in target department(s)

This is a great way to validate potential budget in an account (much better than revenue). If they are investing in headcount, they''ll invest in solutions to support that headcount.

I get this data in two ways:

Open job postings (similar to the "Using your competitors" section)

LinkedIn "Insights" tab (requires a premium subscription - example image below)

At LaunchDarkly, a company growing their engineering team is a good sign that budget for our solutions could be made available. 

One way to get this data quickly is to look up the company page on LinkedIn, and toggle over to the "Insights" tab:

Any solvent company can find budget to solve big enough problems. If account research surfaces likely problems that your solution solves, it''s likely that budget could be found. 

At LaunchDarkly, I''m looking for:

Recent downtime 

Complimentary tech stack

Upcoming product launches

If they''ve had downtime recently, it''s likely they''d invest budget in a solution to help them prevent that in the future. 

If they use adjacent products (e.g., observability tools), it''s likely software release processes are enough of a priority to continue investment. 

If they have upcoming product launches, they are investing to get them right. 

If you can identify the problems your solution solves along with signals a company is facing those problems you''ll have a good idea of where they are putting resources. 

Now that you understand the Use Case/Budget concept, here is how I have my teams tier their accounts:

Priority 1 - Use Case and Budget

Priority 2 - Use Case or Budget

Priority 3 - No Use Case or Budget 

Here''s a simple, practical example of prioritization in terms of a luxury car salesman:

Priority 1 - Middle-aged professional. They can drive, and they have discretionary income. 

Priority 2 (Use Case, no budget) - Teenager. They can drive but won''t likely have discretionary income.

Priority 2 (Budget, no use case) - Retiree on their private island. They have money but don''t need a car on their little plot of paradise (I hope this is me in 30 years…)

Priority 3 - Pre-teen. They can''t drive and almost certainly don''t have discretionary income. 

Here''s another example of prioritization for LaunchDarkly, a B2B software-as-as-service (SaaS) company:

Priority 1 - SaaS Company with 50+ engineers and hiring more. They build applications (indicator of use case), and they are investing in engineers (indicator of budget)

Priority 2 (Use Case, no budget) - Small tech startup. They build applications (use case), but their engineering team headcount has gone down 10% over the prior six months which indicates potential reduction of investment for developer tools. 

Priority 2 (Budget, no use case): A systems integrator. They spend a lot on engineers (indicator of budget), but are building applications for their customers instead of their own applications (no use case)

Priority 3: Manufacturing company. Their model is monetizing physical goods, not software. No budget or use case. 

Ideally, you can have your sales operations team add a custom field in your CRM with a picklist to assign each of your accounts one of these scores. That way, you can manage your territory fully inside your CRM. 

If that''s not an option, building out in Excel or Google Sheets is a suitable alternative. The goal is to have one place where you can quickly see your top priority accounts. 

Once organized, plan to spend 80%+ of your time on Priority 1 accounts. 

Then, plan to use more automated approaches + SDR support on Priority 2, and never look at Priority 3 accounts again. 

Organizing your territory in this way is a time-consuming exercise. Do not skip it, or try to find shortcuts. Even the most optimized sales process will not make up for working low quality territory. 

If you''d like a template to build off of, start here. 

I''ve intentionally kept this module fairly low tech, so you can score your territory without any special technology. 

In the next, I''ll show you how you can supercharge territory management with technology, while introducing you to the concept of TAM vs Propensity.'
)),
content_length = LENGTH(replace(content, '[BODY_PLACEHOLDER]', (
  SELECT '[Wistia Video: 8hbepqbtld]

I''ve reviewed accounts with hundreds of reps in my career. When scoring accounts, most reps place too much weight on revenue and employee count.'
))),
updated_at = now()
WHERE id = '3d5cfab0-9cfa-4c8b-b554-a49131e73f75';
