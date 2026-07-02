
-- ============ AN03 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're on a technical eval call with Maya Chen, Director of Growth Engineering at CartLoop, a home-goods marketplace app with 2.1M MAUs. Their marketing team runs Meta and TikTok campaigns for individual SKUs but can only see aggregate install counts in Branch — not which shared product drove which install. Maya says: "Our merchandising team keeps asking me which products actually convert from a share. Right now I can tell them installs went up 12% last week, but I can't tell them the vintage lamp was 40% of it. Can Branch answer that, and what does the app team need to build?"$s$,
  drill_spoken_task = $s$In under 90 seconds, tell Maya what to instrument, name the two Branch classes involved, and explain what her merchandising team will see in reporting once it ships. Assume she is technical.$s$,
  drill_model_answer = $s$When you tie Branch events to a BranchUniversalObject, every install and purchase that came from shared content traces back to the specific product, article, or item that was shared. A retail user shares a product link — that creates a BUO for that product. Every time someone taps that link, installs, and buys, the purchase traces back to that exact product. This is how a brand answers which products drive installs, not just views. Without BUO linkage, you have install counts. With it, you have per-content attribution that flows into your analytics and ad platform postbacks.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"names_classes","label":"Names BranchUniversalObject AND BranchEvent, with contentItems as the linkage","must":true},
    {"id":"merch_outcome","label":"States outcome in merchandising-team terms — per-content / per-SKU attribution, not aggregate installs","must":false},
    {"id":"downstream","label":"Ties the data to downstream analytics warehouse and/or ad-platform postbacks","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$Two Branch classes do the work here — BranchUniversalObject and BranchEvent. A BUO represents a piece of content, one per product. A BranchEvent represents an action — a purchase, an add-to-cart. You link them by setting the event's contentItems field to the BUO. That's the whole pattern: a BUO for the thing, an event for the action, contentItems as the join.

Bring this up any time a customer asks which of their content drives installs — retail merchandising, media publishers judging article performance, marketplace apps ranking listings. It's also the answer when a growth engineer says their ad-platform postbacks show installs but no product context. If they're only counting installs today, this is the upgrade path.

Without BUO linkage the customer has a number without a subject — they know installs went up, not what caused it. With it, every install and purchase traces back to the specific product that was shared, and that data flows into their analytics warehouse and their ad-platform postbacks. That's the difference between reporting and merchandising decisions.

Now listen to the elite line — pay attention to how it opens with the mechanic, then makes the outcome concrete for a merchandiser.$s$,
  drill_ready = true
WHERE concept_id = 'AN03' AND is_exemplar = true;

-- ============ AT05 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're on a discrepancy call with Devansh Rao, MMP lead at StreamRise, a subscription video app spending $2.3M/quarter on Meta. Devansh: "Facebook is claiming installs that happened three weeks after the ad ran. Branch says 8,400 installs from Meta last month, Meta's dashboard says 14,100. My CFO thinks we're either double-paying or under-reporting, and I need to get to the bottom of it before Friday's marketing review."$s$,
  drill_spoken_task = $s$In 60–90 seconds, name the likely root cause, tell Devansh where in Branch you would check first, and give him the specific ask you would take to Meta to reconcile — not a generic "let's align numbers."$s$,
  drill_model_answer = $s$Attribution windows define how long after a click or impression Branch will credit a campaign for an install or event. Click-through windows are typically 30 days for installs and 7 days for re-engagements. View-through windows are shorter — usually 24 hours — because impressions signal less intent than clicks. You configure these per network partner in the Branch dashboard under Attribution Windows. The practical conversation: when a customer says "Facebook is claiming installs that happened three weeks after the ad ran," that is a view-through window mismatch between what Branch is using and what Facebook is using. Aligning windows is the first step in any discrepancy conversation.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"vt_mismatch","label":"Diagnoses view-through window mismatch specifically as the likely cause","must":true},
    {"id":"dashboard_location","label":"Points to Branch dashboard → Attribution Windows (per network partner) as where to check","must":false},
    {"id":"first_step_framing","label":"Frames aligning windows as step 1 of a longer reconciliation, not the whole answer","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$Attribution windows define how long after a click or impression Branch credits a campaign. Click-through is typically 30 days for installs, 7 days for re-engagements. View-through is much shorter — usually 24 hours — because an impression signals less intent than a click. You set these per network partner in the Branch dashboard under Attribution Windows. Different networks, different windows.

Use this any time a network is claiming more installs than Branch — Meta, TikTok, Snap, anyone running heavy view-through inventory. It also comes up when the customer asks why their MMP number doesn't match a network number. Before you touch anything else, compare the two windows side by side. That is the first move.

It matters because view-through mismatch is the single most common cause of MMP-versus-network discrepancies, and fixing it costs nothing — no engineering, no re-instrumentation, just a config change. If you skip the window check you spend three weeks blaming the SDK and land in the same place.

Now listen to the elite line — notice how it defines the windows first, then makes the discrepancy conversation concrete.$s$,
  drill_ready = true
WHERE concept_id = 'AT05' AND is_exemplar = true;

-- ============ ERX02 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're the AE on Reveler, a travel booking app, $410K ARR, renewing in five months. Your VP has been pushing you to bring in a $600K expansion proposal for Universal Ads. But your champion has flagged that the original Web-to-App rollout is still leaking sessions on Safari 17, and the CMO — Lena Voss — has been quiet for six weeks. You get a 20-minute check-in with Lena tomorrow. Your VP wants the expansion pitch. Your gut says otherwise.$s$,
  drill_spoken_task = $s$Open the call with Lena in 45–60 seconds. Name the open wound, name what you're going to do about it, and set the terms for when the bigger conversation happens. Do not pitch Universal Ads.$s$,
  drill_model_answer = $s$If there's an open wound from the original deployment, I refuse to talk expansion until it's closed. I'll say it out loud to the exec: "Before I bring you a bigger idea, I owe you a clean rollout on what you already paid for — here's what I'm going to fix in the next 30 days, and I'll come back to you when it's done." That sequence is what makes them lean in when I do come back.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"refuses_expansion","label":"Explicitly refuses / defers the expansion conversation until the original deployment is closed","must":true},
    {"id":"named_commitment","label":"Commits to a specific fix window (roughly 30 days) with a named return trigger","must":false},
    {"id":"exec_register","label":"Delivered to the exec in exec register — not routed through the champion, not defensive","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$The move here is a sequenced refusal. You name the open wound out loud to the exec, you commit to closing it in a specific window — usually 30 days — and you promise to bring the bigger idea back only after that's done. Three parts: acknowledge, commit, defer. Never sneak an expansion pitch into the same conversation.

Use this on any renewal or expansion cycle where the original deployment isn't clean — a broken integration, a missed onboarding milestone, a data quality issue nobody has owned. Also when a champion goes quiet or an exec stops taking your meetings; nine times out of ten there is an open wound you haven't named yet.

It matters because pitching expansion on top of an unresolved deployment tells the exec you care about your quota more than their outcome, and that kills trust for the next 18 months. Naming it first flips it — you become the AE who volunteered to eat the hard conversation, and that's exactly what makes them lean in when the expansion pitch comes back.

Now listen to the elite line — notice how the refusal, the commitment, and the defer all land in one sentence to the exec.$s$,
  drill_ready = true
WHERE concept_id = 'ERX02' AND is_exemplar = true;

-- ============ ID02 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$Solutions call with Priya Kaul, Staff Android engineer at PulseFit, a fitness app. Priya: "Our team is seeing intermittent bugs where deep-link params come back empty on cold start. Sometimes we get the right screen, sometimes we drop the user on the home tab. We're also trying to attribute LTV back to the install campaign 90 days later and can't figure out which method to call. Can you walk me through session semantics so I can explain it to my team?"$s$,
  drill_spoken_task = $s$In 60–90 seconds, name both methods, explain when the params reset, and give Priya the diagnosis for her cold-start bug. Assume she'll re-explain this to three other engineers.$s$,
  drill_model_answer = $s$A Branch session starts when the app opens and ends when it backgrounds. Link data is available in the init callback at session start — getLatestReferringParams returns the current session's link data, and it resets each time a new session starts. getFirstReferringParams returns the original install attribution, set once at first open and never overwritten. The session lifecycle matters for two common developer errors: reading link params outside the init callback (they may not be populated yet) and expecting getLatestReferringParams to persist across sessions (it does not — use getFirstReferringParams for install-time attribution). For an AE in a technical conversation, these two methods and when each is appropriate covers 80% of deep link data questions.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"names_both_methods","label":"Names getLatestReferringParams and getFirstReferringParams and distinguishes their scopes","must":true},
    {"id":"init_callback_diag","label":"Identifies reading params outside the init callback as the likely cold-start bug","must":false},
    {"id":"ltv_answer","label":"Ties getFirstReferringParams to the 90-day install-attribution / LTV question","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$A Branch session starts when the app opens and ends when it backgrounds. Link data is available in the init callback at session start. getLatestReferringParams returns the current session's link data and resets each new session. getFirstReferringParams returns the original install attribution — set once at first open, never overwritten. Two methods, two scopes.

Bring this up in any technical conversation with a mobile engineer touching deep-link params — cold-start bugs, per-session routing, install-time attribution questions like LTV modeling. It comes up on nearly every implementation review because the two methods look similar and get confused for each other.

It matters because these two methods and knowing which one belongs where cover roughly 80% of deep-link data questions. Reading params outside the init callback, or expecting getLatestReferringParams to persist across sessions, are the two errors that cost engineering teams weeks of debugging — and both go away once the AE names the right scope.

Now listen to the elite line — notice how it names both methods, both scopes, and both common errors in a single walkthrough.$s$,
  drill_ready = true
WHERE concept_id = 'ID02' AND is_exemplar = true;

-- ============ NEG01 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're on a legal-and-procurement call for a $780K renewal-plus-expansion with FinWave. Their procurement lead, Karim Al-Sayed, opens with: "We need 15% off list, a 60-day payment term instead of net-30, an MSA change on liability caps, and we can only commit to a 12-month term this year instead of the 24 you proposed." Your champion is on mute. Your instinct is to push back on the discount first. Don't.$s$,
  drill_spoken_task = $s$Respond to Karim in 30–45 seconds. Do not answer any of the four asks. Get the full picture on the table before you trade.$s$,
  drill_model_answer = $s$I never respond ask-by-ask. "Before I react to any of this, walk me through everything you need — terms, price, timeline, MSA edits. I'd rather solve the whole picture than negotiate piecemeal." Then I package my response and trade across the asks.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"refuses_askbyask","label":"Explicitly refuses to respond ask-by-ask, out loud","must":true},
    {"id":"requests_full_list","label":"Requests the full list — terms, price, timeline, paper edits — before reacting","must":false},
    {"id":"trade_framing","label":"Frames the pause as solving the whole picture / trading across asks, not stalling","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$The move here is a deliberate pause before you trade anything. You name that you're not going to react ask-by-ask, you ask for everything they need on the table — terms, price, timeline, paper edits — and only then do you package a response that trades one ask against another. Three steps: pause, gather, package.

Use this on any late-stage procurement or legal call where the buyer opens with multiple asks stacked together. Also any time you feel the pull to defend price the moment it's raised — that pull is the signal to stop, not to answer. Any time the ask feels rehearsed or coordinated across their team, this is the move.

It matters because responding ask-by-ask hands them free wins. Every ask you concede in isolation costs you the leverage to trade it later. When you see the whole picture you can trade term length against discount, payment terms against MSA edits, and you land closer to the original number with a cleaner paper trail.

Now listen to the elite line — notice how it names the refusal and requests the full picture in one calm move.$s$,
  drill_ready = true
WHERE concept_id = 'NEG01' AND is_exemplar = true;

-- ============ PS02 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're on a privacy-architecture call with Anja Møller, VP Data Protection at NordicMedia, a publisher operating across EU (heavy GDPR opt-out) and US (mixed CCPA). Their legal team just flagged that all their app users appear as "organic" in Branch reporting since they enabled a global privacy setting last month, and marketing has lost all paid-channel attribution. Anja: "We can't be non-compliant, but we also can't fly blind on a $12M paid budget. What does Branch actually let us do here?"$s$,
  drill_spoken_task = $s$In 75–90 seconds: name the four levels, diagnose what almost certainly happened last month, and describe the per-user pattern that fixes it. Anja will forward this to her CMO.$s$,
  drill_model_answer = $s$Branch's four Consumer Privacy Protection levels control how much data is collected per user. Full: standard Branch measurement — all device signals, full attribution. Privacy: reduced signals — advertising IDs and IP addresses excluded, deep linking still works, attribution is probabilistic only. Analytics Only: events fire and are measured but nothing is attributed to a paid channel — all traffic appears organic in reporting. No Attribution: deep linking only, zero measurement or attribution. The enterprise setup: Full for opted-in users, Privacy or Analytics Only for GDPR opt-outs, No Attribution for users exercising deletion rights. These can be applied dynamically per user based on consent status — not set globally for the whole app.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"names_four_levels","label":"Names all four levels — Full, Privacy, Analytics Only, No Attribution — with the right behavior for each","must":true},
    {"id":"diagnoses_global","label":"Diagnoses that Analytics Only (or similar) was set globally last month, making all traffic appear organic","must":false},
    {"id":"per_user_pattern","label":"Prescribes the per-user pattern: Full for opted-in, Privacy/Analytics Only for GDPR opt-outs, No Attribution for deletion requests","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$Branch has four Consumer Privacy Protection levels. Full — all device signals, complete attribution. Privacy — advertising IDs and IP excluded, deep linking still works, attribution goes probabilistic. Analytics Only — events fire but nothing attributes to a paid channel; everything looks organic. No Attribution — deep linking only, zero measurement. Set per user, dynamically, based on consent status.

Bring this into any privacy-architecture conversation with an EU or heavily regulated customer, any time paid attribution suddenly collapses and legal was recently involved, and any GDPR or CCPA review where the customer is trying to reconcile compliance with attribution. It also comes up when they're deciding what to do at consent-banner decline.

It matters because the mistake enterprises make is applying one level globally — usually Analytics Only, to be safe — and losing all paid attribution as a side effect. The per-user pattern gives them compliance for the opt-outs and full measurement for everyone else. That's the difference between $12M spent blind and $12M spent measurable.

Now listen to the elite line — notice how each of the four levels gets one sharp definition before the per-user pattern lands.$s$,
  drill_ready = true
WHERE concept_id = 'PS02' AND is_exemplar = true;

-- ============ PU02 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You're on a product review with Rafael Ortega, Head of Mobile at ThreadStack, a fashion marketplace. Their share-to-install conversion is 7%, industry benchmark is 14%. Rafael: "When someone shares a dress from our app and their friend doesn't have it installed, right now Branch drops them into the App Store cold. My PM thinks we're losing intent between the tap and the download. Is there a way to show them what they're about to install before we send them to the store?"$s$,
  drill_spoken_task = $s$In 60–90 seconds, name the Branch feature, tell Rafael where it's configured, and describe what the shared user actually sees end-to-end — including what happens after install. Speak to his PM's intent-loss theory directly.$s$,
  drill_model_answer = $s$A Deepview is the web page Branch shows a user before sending them to the app store — it previews the content they were trying to reach. When someone clicks a Branch link and does not have the app, instead of going straight to the App Store with no context, they land on a branded preview page that shows the product, article, or offer they clicked on. The CTA sends them to the store, and the deferred deep link carries them to that exact content after install. Configure one in the Branch dashboard under Link Settings — set the title, description, image, and CTA text. Use a Deepview when you want the app store redirect to be a conscious choice, not a blind redirect.$s$,
  drill_rubric = $j${"criteria":[
    {"id":"names_deepview","label":"Names Deepview and describes it as the branded preview page shown before the App Store redirect","must":true},
    {"id":"config_location","label":"Points to Link Settings in the Branch dashboard (title, description, image, CTA) as the configuration location","must":false},
    {"id":"deferred_dl_close","label":"Closes the loop on deferred deep linking — user lands on the exact shared product after install","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$A Deepview is the web page Branch shows a user before sending them to the App Store — a branded preview of what they're about to install. Configure it in the Branch dashboard under Link Settings: title, description, image, CTA text. The CTA sends them to the store, and the deferred deep link carries them to that exact content after install.

Bring this up on any retail, media, or marketplace conversation where share-to-install conversion is underperforming, or where the customer says users are dropping off between the link and the app. It also comes up when a PM is skeptical of blind App Store redirects and wants a considered install experience.

It matters because the naked App Store redirect strips all context — the user forgets what they clicked before the download finishes. The Deepview turns the redirect into a conscious choice, which is why customers who add them typically see share-to-install conversion move meaningfully. It's a config change, not an engineering project.

Now listen to the elite line — notice how it explains what the user sees, where you configure it, and closes on the deferred-deep-link payoff.$s$,
  drill_ready = true
WHERE concept_id = 'PU02' AND is_exemplar = true;

-- ============ QBX01 ============
UPDATE public.ki_curriculum SET
  drill_scenario = $s$You have a QBR next Thursday with your top account, MetroTransit, a $1.2M ARR public-transit ticketing app. Their COO, Whitney Prasad, will be in the room. Your CSM sent you a proposed agenda: 40 minutes on new features shipped, 15 minutes on adoption metrics, 5 minutes on roadmap. Your champion, Diego Fuentes, VP Product, just Slacked you: "Please don't turn this into a demo. Whitney wants to know if this is still working for us." Rewrite the agenda in your head and tell Diego how you'll actually run the hour.$s$,
  drill_spoken_task = $s$In 60–75 seconds, tell Diego how you'll structure the QBR. Name the split, name the two things you'll cover, and name the single question you'll end on. This is a coaching moment for Diego — he'll use your framing to prep Whitney.$s$,
  drill_model_answer = $s$I don't use a QBR to celebrate. I use it to validate that the original business case is being delivered and to extract the next problem. Half the time goes to "here's what you said you wanted, here's what happened, did we get there." The other half is one question: "now that this is working, what's the next thing on your list that's keeping you up at night."$s$,
  drill_rubric = $j${"criteria":[
    {"id":"two_half_split","label":"Splits the QBR roughly 50/50 between validation of the original business case and next-problem extraction","must":true},
    {"id":"validation_framing","label":"Frames the first half as: here's what you said you wanted, here's what happened, did we get there","must":false},
    {"id":"forward_question","label":"Ends on a forward-looking problem-extraction question (what's next / what's keeping you up at night)","must":false}
  ]}$j$::jsonb,
  drill_teach_script = $s$The move is a two-half QBR. Half one: validate the original business case — here's what they said they wanted, here's what happened, did we get there. Half two: one question — what's the next thing on your list keeping you up at night. That's it. No demo, no roadmap parade, no feature updates unless they earn their way in.

Use this on every QBR with a strategic account, especially post-value-realization when the temptation is to celebrate. It also works for a 30-minute exec 1:1 inside an expansion cycle — QBR structure travels. Any time the CSM's default agenda leads with features shipped, this is the rewrite.

It matters because celebration QBRs get you a polite nod and no expansion pipeline. Validation-plus-extraction QBRs put the original commitment on the table honestly and end with the exec handing you the next problem to solve — which is exactly the input you need to build the next 12 months of ARR inside that account.

Now listen to the elite line — notice how the two halves and the closing question all land in one crisp sentence.$s$,
  drill_ready = true
WHERE concept_id = 'QBX01' AND is_exemplar = true;
