# Focus Flow Score — repository SQL migration inventory

Generated read-only from the tracked `supabase/migrations/*.sql` files. It does not establish which migrations ran in Lovable Cloud, which runtime objects drifted, or whether a future export includes the same objects. Unqualified identifiers below are normalized to `public.*` only for comparison; their source evidence remains authoritative.

- Migration files: **282**
- Chronological range: **20260205170426 → 20260716160050**
- Explicit table declarations: **155 occurrences / 155 unique names**
- Explicit table drops: **3 statements**. `strategy_synthesis_cache` is dropped and recreated in the same migration; only **2** names are dropped after their last CREATE (`public.whoop_connections`, `public.whoop_daily_metrics`), leaving **153** repository-created names in final chronological migration state. This is not a claim about runtime state.
- Explicit view declarations: **6**; materialized views: **0**
- Explicit indexes: **196**; functions: **19 declarations / 11 names**; triggers: **57**
- Policies: **381 creates / 43 drops**; RLS state statements: **156**
- Constraint clauses inventoried: **380** in CREATE TABLE plus **60** ALTER TABLE constraint operations
- Explicit enum/type declarations: **0**; explicit sequences/identity/serial declarations: **0**

## Chronological migration ledger with SHA-256

| Timestamp | File | SHA-256 | Repository-declared effect summary |
|---|---|---|---|
| 20260205170426 | `20260205170426_8a014c2f-1eda-40d4-abab-f3fb49b8c5fc.sql` | `3be9a31560f28c934f1b2c81207b56f61ac6e015f8bff44fc62c50156891a25b` | extensions pg_cron, pg_net |
| 20260206162934 | `20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql` | `8eada0e95f8e8aa5eb3b286039b4a03c66f43cd779c7ec1d7d4babd6146cfaf2` | create table public.work_schedule_config, public.holidays, public.pto_days, public.workday_overrides, public.streak_events, public.badges_earned, public.streak_summary; alter table public.work_schedule_config, public.holidays, public.pto_days, public.workday_overrides, public.streak_events, public.badges_earned, public.streak_summary; triggers 3; policies +21/-0 |
| 20260206212920 | `20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql` | `ceafe511659123231706933ece6602405379568d4c1d6d575885567b35d2a9fb` | alter table public.badges_earned, public.calendar_events, public.holidays, public.pto_days, public.streak_events, public.streak_summary, public.work_schedule_config, public.workday_overrides; policies +24/-22 |
| 20260206213330 | `20260206213330_982a1ea2-7260-431d-9903-74d12714e6d9.sql` | `ac5c97ad2109db29e4c5615972e3980c74d67eb06821c09472bb0a8e785a6d40` | create/replace function public.update_updated_at_column |
| 20260206214905 | `20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql` | `112038deb848350d50b706d64bb54edee569caf2ceba49764abc21679f0fd6b4` | create table public.daily_journal_entries; alter table public.daily_journal_entries, public.work_schedule_config; indexes 1; triggers 1; policies +4/-0 |
| 20260206222237 | `20260206222237_6e028526-6632-4806-9af9-1ef25589c008.sql` | `2119458491f6db959799fa07340109ec2c3041e2ed9823b1f0b02592d4375f86` | policies +2/-0 |
| 20260206222905 | `20260206222905_7d0feae7-32a6-47bc-a900-4c37f11b25a7.sql` | `7bd17ba6165ab2107217e3bead77e178096fbf09e83687368f4a0916af38ab0e` | alter table public.daily_journal_entries, public.streak_events |
| 20260206225833 | `20260206225833_dbe32e24-b268-4301-b9cd-920f347a2123.sql` | `b6f05dff6eb32932e99335140c90aef29d5807b75bb05af3f75afffb387ef54b` | policies +1/-0 |
| 20260208035859 | `20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql` | `6b5a6f74e4490403feb5d0d751202de36433101d8e3865e6b7c72dc23c60cea2` | create table public.accounts, public.contacts, public.opportunities, public.renewals, public.account_contacts; alter table public.accounts, public.contacts, public.opportunities, public.renewals, public.account_contacts; indexes 9; triggers 4; policies +20/-0 |
| 20260209013312 | `20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql` | `133358598ad606a48e2248289d52f88418358f69682d8dca8e8aa2397d70e777` | create table public.sales_age_snapshots, public.quota_targets; alter table public.sales_age_snapshots, public.quota_targets; indexes 1; triggers 2; policies +6/-0 |
| 20260209034615 | `20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql` | `5baa549203ca875f948c9c4146320bc658edbc0bf361b0326326fcb31e49d370` | create table public.import_header_mappings, public.import_value_mappings, public.import_account_aliases; alter table public.import_header_mappings, public.import_value_mappings, public.import_account_aliases; triggers 2; policies +12/-0 |
| 20260209145632 | `20260209145632_c42db157-b79b-4270-9b73-9b7bb0d7c598.sql` | `02e1d5da5998c1f4676f11bb1d0bc161386367c4a09d48923600373cc2974d5a` | alter table public.daily_journal_entries |
| 20260210161436 | `20260210161436_1543c084-60e7-4b8c-b133-94936de457e9.sql` | `1a2af49fc8bea1962247b5e89b86b866a689fb69b8a5022898609601d073e631` | alter table public.accounts |
| 20260311034007 | `20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql` | `b15e05591632cb23d6eeea037a7285241e022a6784c001eea6ae900220c8f334` | create table public.power_hour_sessions; alter table public.power_hour_sessions; policies +4/-0 |
| 20260311050339 | `20260311050339_e08b0398-ca3d-449f-8d70-d20fad0c0d13.sql` | `f0132e0e1311e54962ba4615397ec0b3ce43b032a110f0bba487aa11d385262c` | alter table public.accounts |
| 20260311053151 | `20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql` | `d2f9b013ac8a808fc99cc9436c986f1a4b475d65425b8c291cd3b8f9959f270a` | create table public.daily_digest_items; alter table public.daily_digest_items; indexes 2; policies +4/-0 |
| 20260311053345 | `20260311053345_0e6b6807-73e1-47a1-8764-b9646aa1d938.sql` | `7c46412e6771ee447a6321054ace6f92e1099f6bb8757038e3a12e3296029572` | extensions pg_cron, pg_net |
| 20260311142153 | `20260311142153_5ebf55f2-b734-4be2-ab88-11506cf847bf.sql` | `0aa075eab0c1894b1c15887dba17de799c71b3c0277bcf2664bb0f30535b42fc` | alter table public.accounts |
| 20260312173207 | `20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql` | `573a473066889d370724287a0be24df8bd2f501e26338d01bcda2e1724596650` | policies +3/-0; storage bucket/policy |
| 20260313152201 | `20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql` | `72f1f01cd0e9a8800d66f7b48dfa24348c9771fdbb47c4c446f17820444ecc04` | create table public.whoop_connections, public.whoop_daily_metrics; alter table public.whoop_connections, public.whoop_daily_metrics; policies +10/-0 |
| 20260313152210 | `20260313152210_5032d4fc-4f72-4799-ba42-ec17ddaf7929.sql` | `89d8f2f4f524153c1b2316e442938aca41a513f2aadd7b71b2d4245548cc4aa7` | policies +0/-2 |
| 20260313152844 | `20260313152844_91f427bd-0527-4b4e-89b6-a85b65fc9181.sql` | `3e3f47aa181d3646a45a31f714d1488b87615e4df43e02f1e313523ae0c410dd` | alter table public.whoop_connections |
| 20260313155532 | `20260313155532_65796571-1a27-4c55-911a-1efdab773822.sql` | `1ff7ef70f44c4fbb6e003ae9e8fae8c4a15ae2fc72fd4c16613ef8426b733b4f` | alter table public.daily_journal_entries |
| 20260313184614 | `20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql` | `67ed0cf2f7a9010a7758444672bdfd12c4f2b41bd427df0b5c6d8fbe9f836c9d` | create table public.weekly_reviews, public.dismissed_action_items; alter table public.weekly_reviews, public.dismissed_action_items; policies +6/-0 |
| 20260313191429 | `20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql` | `b0291c35dd525271fc05705a34d102742baeaa883a10df9e69f655e4abcbaabe` | create table public.call_transcripts; alter table public.call_transcripts; indexes 5; triggers 1; policies +4/-0 |
| 20260313195930 | `20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql` | `453f280468576cf198dccc5cbdac0ea65c4bb5dc1079dc8c413929b0fe1ac573` | create table public.resource_links; alter table public.resource_links; policies +4/-0 |
| 20260313223056 | `20260313223056_a77e6bab-ba46-462b-b04c-992eaefee089.sql` | `199cc900be8d359005307b3494306c3e51c4a86baf4497f262a1481d0ae96b4a` | alter table public.daily_journal_entries |
| 20260314020413 | `20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql` | `3bbd3a03bb810df6435480ab590a51b08ae975b1e08e2af1fedb1de133ab2f65` | create table public.daily_time_blocks, public.ai_feedback; alter table public.daily_time_blocks, public.ai_feedback; policies +6/-0 |
| 20260314020835 | `20260314020835_d89565d3-f904-4b6a-b387-97ec03496c0d.sql` | `1e7f69c3bc934bc2f83316a6a69b3f2f6ae03d4ddf0995f76e1914379eb37d9f` | alter table public.daily_time_blocks |
| 20260314163750 | `20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql` | `2aa766afe52520f26e39a9b9c07dd40742ec84058034eea266254a1f1b33bdcf` | create table public.conversion_benchmarks, public.pipeline_hygiene_scans, public.weekly_battle_plans; alter table public.conversion_benchmarks, public.pipeline_hygiene_scans, public.weekly_battle_plans; policies +9/-0 |
| 20260314171710 | `20260314171710_6625322a-a4b8-4a3a-a7d0-4b0de0d17971.sql` | `a27bfc68d14e0c18bc75127a0d9575cbf757921595bd08c97f4537c4c5a2ee68` | indexes 1 |
| 20260314172322 | `20260314172322_8d43c238-e7e3-4e0f-b654-7d2da04091ce.sql` | `377eadc6ee24315211ae5f618304d7a6561ac73b3980ba7bf3a08ba93fc0bfb2` | indexes 1 |
| 20260314174001 | `20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql` | `baef52b2ccd297d6dc433f5a48e08e4d96f0e8f0beecc135750d91711731f9a7` | create table public.tasks; alter table public.tasks; triggers 1; policies +4/-0 |
| 20260314225746 | `20260314225746_1c58c8de-b3b2-4171-b7ba-3cae0195325b.sql` | `bc9e2217159b50f5eae166d1953fbeb721ac5cb1cf783c7fb5fafa9a1e562e57` | alter table public.daily_journal_entries |
| 20260315163148 | `20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql` | `6f53235cf76f9c0641535e6432a0f60c6f0b844e233ef34b347adbb59bd9b4d0` | create table public.icp_sourced_accounts; alter table public.contacts, public.icp_sourced_accounts; policies +1/-0 |
| 20260316190955 | `20260316190955_b4a7c6fa-f7bf-48ab-85ac-8978c66786cf.sql` | `94bd0cd0f3c76ed3279c25a2686a7ea7729d3c3230959eab9aadf5a23b70952e` | delete from public.opportunities; delete from public.renewals |
| 20260316191118 | `20260316191118_5780bebe-68dd-460b-bf07-0bc963d62ad0.sql` | `449c4de1411fccb38c06e73dda0b264eda10f45331ad1b2d456906d23369cd44` | update public.opportunities |
| 20260316191139 | `20260316191139_deb5b5e5-251c-46da-951c-db0469e612d4.sql` | `fc73525d41c8eaf578cfc955d46420e967e05e698b230cabec97223f359c9275` | delete from public.opportunities; delete from public.renewals |
| 20260317052005 | `20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql` | `93176a348121330893951457b368d79a691a87dc99326b2764c784a8fe4b352c` | create table public.daily_plan_preferences; alter table public.daily_plan_preferences; triggers 1; policies +3/-0 |
| 20260317064409 | `20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql` | `59411dfca4e6bb0be403c929d9cbf367513f325cddcfca5dc007157df31e13af` | create table public.transcript_grades; alter table public.transcript_grades; policies +4/-0 |
| 20260317065810 | `20260317065810_ebebdee6-360d-4851-b8d3-9c9976d6bfe9.sql` | `12cca8bac6c15532c8b794caeed5d62526ad9fbeae87a5a6378cfcdc7db96fe2` | alter table public.transcript_grades |
| 20260317084651 | `20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql` | `92e11ef5e1d21f68d8ded072b22d470ad2e53aee73fd058a8fe0dbaedc10718f` | create table public.mock_call_sessions; alter table public.mock_call_sessions; policies +4/-0 |
| 20260317133610 | `20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql` | `e2b6f4c0e09ba9913bc03d8627db33d511decab628bda9f3f1aa189efd325524` | alter table public.tasks, public.renewals, public.call_transcripts, public.resource_links |
| 20260317133854 | `20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql` | `e2b6f4c0e09ba9913bc03d8627db33d511decab628bda9f3f1aa189efd325524` | alter table public.tasks, public.renewals, public.call_transcripts, public.resource_links |
| 20260317200136 | `20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql` | `a557d800fcf5a8cbfd8b5303b612648fb7e657966c9ad612d812b6adf581b8e6` | create table public.opportunity_methodology; alter table public.opportunity_methodology; policies +4/-0 |
| 20260317225106 | `20260317225106_ec53f795-9ce9-4e89-814a-460fa8b29eb4.sql` | `c9c3101a102e03be70151ad9939d0d86b096481986266ded049519f64d50ffa2` | extensions pg_cron, pg_net |
| 20260318153529 | `20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql` | `94260a3224f149da27f6807df9db551fae13596548ddddc7f88137573c52360a` | create table public.resource_folders, public.resources, public.resource_versions; alter table public.resource_folders, public.resources, public.resource_versions; triggers 2; policies +4/-0; storage bucket/policy |
| 20260319044715 | `20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql` | `afbfce5e74b1bc6292b778c07ecb7750be5e30ed478f5a376d8b2efd6f6ddd6d` | create table public.template_suggestions; alter table public.resources, public.template_suggestions; policies +1/-0 |
| 20260319111425 | `20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql` | `b9f88da5577ac7645cf0e2e306c6505d897634285e2f1d9150f4bdbcf7060e45` | create table public.voice_reminders; alter table public.voice_reminders; policies +1/-0 |
| 20260319140133 | `20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql` | `022c2bdef2d6dd3d34987c7b26a853c94914ee069bfb20f2933c86c0c4c2ec55` | create table public.dave_transcripts; alter table public.dave_transcripts; policies +3/-0 |
| 20260319192008 | `20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql` | `3be0f68c4370444e032ca1933d239a8220cef9868565411fefe476fe449b0bbf` | create table public.resource_digests; alter table public.resource_digests, public.transcript_grades; policies +1/-0 |
| 20260320015821 | `20260320015821_05a8fd39-1925-438e-aab6-f6980d43c04f.sql` | `dedf422528e449f42b82b4feaad0019ebd558664373b7e561f788afb1f6b1d28` | alter table public.resources |
| 20260320202927 | `20260320202927_1d5c420a-9a6c-4693-abb0-f25872853415.sql` | `54111318b98a6901e8897527eb66b64550470685dbce2e2ded7b6e90dfca6007` | alter table public.tasks |
| 20260320220010 | `20260320220010_502996f9-ba1e-4ab3-a871-2e39d9958fd6.sql` | `9dd2815c827c18c1950964aa4f456085546ae5310588694b09649ec9fccf5809` | alter table public.transcript_grades, public.call_transcripts |
| 20260320221358 | `20260320221358_e78ea58a-5cd7-4a4f-beea-07c2d9b3c505.sql` | `b95210380e813f70b816b1bd8cd69c4e7b277841d708758065f1aff95e6550c5` | create table public.custom_prompts; alter table public.custom_prompts, public.resources; policies +1/-0 |
| 20260320222336 | `20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql` | `13e2168b9cae2c18641b73deafdef76bac5e713409602ca221ea64b6755bd3b7` | create table public.deal_patterns; alter table public.deal_patterns; policies +1/-0 |
| 20260321175220 | `20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql` | `ebea359d9a529024f9fd10acce0cf347d3eee2a53e91dc148064f70c92a76f04` | create table public.coaching_plans, public.resource_usage_events; alter table public.coaching_plans, public.resource_usage_events; policies +2/-0 |
| 20260321181110 | `20260321181110_8b21f5c4-9794-437d-a816-de142876c404.sql` | `a034b26f69630b11116981210f82ca1929fa07bf3e17f878c1ac2c2e413298d4` | alter table public.resources |
| 20260322165710 | `20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql` | `95eba03ed589e8cb9746b58e5aaf2b6b2f18d51eb463b85bb24080a7ac44dded` | create table public.error_logs; alter table public.error_logs; indexes 3; policies +2/-0 |
| 20260322170324 | `20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql` | `6dc8282536fa0d764b8e35d5585b92eee136c58a71114ab7b76feab0fe3614f9` | create table public.resource_jobs, public.resource_job_steps, public.resource_chunks; alter table public.resource_jobs, public.resource_job_steps, public.resource_chunks; policies +3/-0; publication change |
| 20260323020137 | `20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql` | `8ca96727d9762dede88f438d8272d54a19462ce353f7b06c9be98c935b179f09` | create table public.intelligence_units, public.knowledge_signals; alter table public.intelligence_units, public.knowledge_signals, public.resources; indexes 6; policies +2/-0 |
| 20260323021440 | `20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql` | `b652f8317bbd46cfc9db463c0e9520174e5cb47b858dc26132fbecae3e326237` | create table public.strategy_outcomes; alter table public.strategy_outcomes; indexes 3; policies +1/-0 |
| 20260323110853 | `20260323110853_07cd44b1-2c4a-40a3-be46-b714a2d35ebc.sql` | `c9c3101a102e03be70151ad9939d0d86b096481986266ded049519f64d50ffa2` | extensions pg_cron, pg_net |
| 20260323145932 | `20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql` | `0ed816b2960176aaa4f657daf35e84be15f56e95ea68183a2fe35ccdb01aefd0` | create table public.weekly_research_queue, public.research_queue_events; alter table public.weekly_research_queue, public.research_queue_events; triggers 1; policies +2/-0 |
| 20260323161535 | `20260323161535_505676e5-01f6-4e9b-9742-4a12bea8701d.sql` | `97cfe02772d620071eea3dfc40178895ac666378b772303cd99767fea2c480a2` | alter table public.daily_time_blocks |
| 20260323164713 | `20260323164713_e022d530-f786-4fb9-9dbc-21f3e7ce85b7.sql` | `52115881557061d52e45fac17c6ddafcebc4eb760286aedd7dbe6487e49014a0` | alter table public.daily_time_blocks |
| 20260323192251 | `20260323192251_81c8e8ce-cdda-4d8c-a365-74a9f93e0780.sql` | `b53c807f7cc84813c293d6d1ecc3116d4d5bca25010de03a9ee9c97ceef7b99b` | grants/revokes |
| 20260323193351 | `20260323193351_b2fece95-d450-4009-a86c-f69d8fd664d9.sql` | `3bad6a0208d6f0cc1fa133956f249cab6d148dbdff4fbf896d4540d8c05ccbb4` | policies +1/-0 |
| 20260323205117 | `20260323205117_3cccc081-427a-4bde-ac27-a711f5d80143.sql` | `ed7b2903a8bfa129dc054276fb03a50996d1b19ea5053ca70252458d40c3c11f` | alter table public.dismissed_duplicates |
| 20260325144003 | `20260325144003_85b01010-5a5b-45b2-8996-c9e3d3d163b5.sql` | `30eb219a57b379992394c10fe44c524378b809ed51970fc47a036d91268048f5` | alter table public.resources; indexes 1 |
| 20260326011845 | `20260326011845_45ce3d75-0ea0-4534-8639-5e2543730923.sql` | `36a12ca606e413314415c7936b4701efd16af8f970191ca5a938d5b626c14374` | alter table public.resources |
| 20260326091059 | `20260326091059_d43a38b2-ffe9-4a22-bb09-63413aa6c7bf.sql` | `e206e1e2b05c2313f7a9bdda279e2c80de89327871cc18e653cba27ba92263d3` | create table public.playbooks; alter table public.playbooks; policies +1/-0 |
| 20260326092242 | `20260326092242_5b939d98-b42e-46de-8dba-01e0af71d815.sql` | `2cad10e21e02a1001bbbdcd2e72939c0e4a9370ff624f0e4235ba77d099f5ec9` | alter table public.playbooks |
| 20260326104621 | `20260326104621_184f3a81-af00-4ed2-8290-7c9f812f2803.sql` | `b1fa8c662328d034ab22ff31750bb39be86420bf60206eec62b18e788f8be85c` | alter table public.playbooks |
| 20260326111352 | `20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql` | `ed92424cdd2aa7aadafe16c82c0bae4ebf826f577dd2b0aa07cf8a0e0b38e47e` | create table public.playbook_usage_events; alter table public.playbook_usage_events; indexes 1; policies +1/-0 |
| 20260326144021 | `20260326144021_1ca8807c-dc08-4445-b2da-4c4bfa0ffd9e.sql` | `c28cab7c22322964b363fd50126cf823ae0fc88b4a403fc888dc07f29ddf32b1` | alter table public.resources |
| 20260326154737 | `20260326154737_3e874121-8355-4e5b-ab50-2706d2a55717.sql` | `975833e207a002162518b66d8d80a172c8211f51d0e4cfe79dd89efc1b31aace` | update public.resources |
| 20260326175413 | `20260326175413_23f399b3-1e5c-42a4-8eaf-5edf1591786f.sql` | `92496410870b074b34cb4c11174ff54016cd1092db130da419e72fe20fc19df4` | grants/revokes |
| 20260326182804 | `20260326182804_5487b117-3964-4e43-b32a-dda993132f1b.sql` | `6f84bbfb06d3dc03c814c8cbc4a1cd479ba2de6faf08ecd66f3c515617078f30` | policies +0/-2 |
| 20260327182103 | `20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql` | `91cfe9d5123e8e780d970b88b0efc9ee5497a60b68bc8b910305d21a7048297c` | create table public.source_registry; alter table public.source_registry, public.resources; policies +1/-0 |
| 20260327205143 | `20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql` | `970d58b3adccc8b1070cef6a37c2bed9bbfb5e566a83920030d2eff7b2477086` | create table public.audio_jobs; alter table public.audio_jobs; indexes 2; policies +1/-0 |
| 20260327211720 | `20260327211720_8ab1ee49-3677-4a92-a198-6eb0f7ce99c9.sql` | `263e0122a8eaad9c176d212f901d01ada78aa1a9e5e4b837ab3f8557bb84dbcd` | alter table public.audio_jobs |
| 20260328034915 | `20260328034915_8e6d0931-bdcf-42c4-bc9e-46d177043a02.sql` | `838ea5fdc688730071dc056557f2bf852f1632e3c1a11d631488a48fe76b87fe` | create table public.verification_runs; alter table public.verification_runs; policies +1/-0 |
| 20260328190948 | `20260328190948_62be992d-b045-4f54-b1c2-31fb777f48b2.sql` | `a7daf4bde60a851b5ef65e7673473ad01e6c04ff9ce1dde8308a2c45db77b9c3` | publication change |
| 20260328203031 | `20260328203031_a5826e79-9cce-48d3-be9e-346e818e0b52.sql` | `7dfc1be19a14024c8bc2056fb0f3e8b3d31471f27822d656b7d0c40e0f709c3c` | update public.resources |
| 20260328203546 | `20260328203546_5ebbd1ed-2d34-4857-8b28-5d450f583171.sql` | `54dc569f5532f933f9f929d52b8dfee5ea05b9b85da8639f0aab59c163d0fa60` | update public.resources |
| 20260328203828 | `20260328203828_4fe2e1a0-472b-4d7d-be9d-bf80bef86501.sql` | `84b27f80f5605c38fc12023d9a20f9bd0f378b3369cb443bb74732a6f834b755` | update public.resources |
| 20260328221253 | `20260328221253_be397010-3abf-4153-bd3c-17b6bda5bd3b.sql` | `d8aaaeb9c36494654f3358074718a5ebb9e2ede1431e1f2fd8d62d1e2bc7b7d2` | alter table public.resources; indexes 2 |
| 20260329031208 | `20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql` | `93afdbf1273480d47399b7328ae6d42cccaba5aabe63333f36fe383136586f6f` | create table public.approved_users; create/replace function public.is_approved_user; alter table public.approved_users; policies +1/-0 |
| 20260329133300 | `20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql` | `405fdf5a9c4492a7f30f0606c95eab7ee27110b2c2502f69360e01dded334abd` | create table public.enrichment_attempts; alter table public.enrichment_attempts, public.resources; indexes 2; policies +2/-0 |
| 20260329144426 | `20260329144426_4726c67a-0c9d-4de5-a1e8-d9b5a8e63989.sql` | `ea7c3a1ddd5d5fdd3f3e38524054fbfdbdec24d46ae1936288593bc3ac9e29f4` | update public.enrichment_attempts; update public.resources |
| 20260329195417 | `20260329195417_1d5b7efc-5ff4-4625-a2a4-1f772fff496f.sql` | `53f94797a6919ee38ae01ef40c5e83cbf6878c648de7f5656e676422d15ba856` | update public.resources |
| 20260330034033 | `20260330034033_7b700539-2058-40be-a861-c451e390356f.sql` | `770c9cd776630e96cd4ee34317b870c37ed228f2ca4a8a3839d077db4f76db03` | create table public.knowledge_items; alter table public.knowledge_items; indexes 5; policies +1/-0 |
| 20260330123816 | `20260330123816_d623c18b-5552-4b9f-aa5c-1a5850be42ee.sql` | `2f587b900f294c262297b89b5864e08130e621323f0b92841df7152344b57b51` | alter table public.knowledge_items |
| 20260330132601 | `20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql` | `7c131ce2dc0ba345fdedd4b013d03c8f5a8590f84cd48febe4c70579ddb94237` | create table public.knowledge_usage_log; alter table public.knowledge_usage_log; indexes 3; policies +2/-0 |
| 20260330152818 | `20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql` | `dc2fbe48b7950dbac66d6172e62c90b5de8952d7fad05523cf7fedc998ffcc2f` | create table public.execution_templates, public.execution_outputs; alter table public.execution_templates, public.execution_outputs; indexes 4; policies +2/-0 |
| 20260331013034 | `20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql` | `ac01c9721e552d6b784428b5e9000fe02447be7c063b1c7753cdb9046141295b` | create table public.pipeline_diagnoses; alter table public.pipeline_diagnoses; indexes 3; triggers 1; policies +4/-0; publication change |
| 20260331014904 | `20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql` | `3745d450cbdb6ff1082cbbe391e405ccb2e3f2295545fca45d87a130d9029d9b` | create table public.pipeline_runs; alter table public.pipeline_runs, public.pipeline_diagnoses; indexes 2; triggers 1; policies +3/-0 |
| 20260331032436 | `20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql` | `07991c8db7882b91243313f08afd9cff7afe6a5de913928fa233bdc81d695026` | create table public.asset_provenance, public.cluster_resolutions; alter table public.asset_provenance, public.cluster_resolutions; indexes 3; policies +4/-0 |
| 20260331033027 | `20260331033027_3d484f8a-a704-40f2-a238-c2b6edd949b7.sql` | `81e15f44d6b941397ac52259e1d50a310cad9656564967c111ba03dd69d3409b` | alter table public.knowledge_items, public.cluster_resolutions, public.asset_provenance |
| 20260331061756 | `20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql` | `d559a4333d18ac36587ab0b1e4c3686c1f22a4179d7d4161ce9d6aba9eb64d8e` | create table public.extraction_pipeline_jobs; alter table public.extraction_pipeline_jobs, public.resources; indexes 3; policies +1/-0 |
| 20260331161739 | `20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql` | `1a82f54534da91f20846fff4322e31e16c03db0109f3fd16b1d027136593f4cf` | create table public.batch_runs, public.batch_run_jobs; alter table public.batch_runs, public.batch_run_jobs; indexes 3; policies +2/-0 |
| 20260331162257 | `20260331162257_09975dd2-f8b8-4dba-9604-51abc0c2c1a0.sql` | `652a96140f1f3a2faa42ca3f3ac1a58064ea5351e294145e060ec8d89ed14261` | alter table public.batch_run_jobs |
| 20260331225620 | `20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql` | `a645a2aba8423e77291308143d4ab8b3c59b8fde9e012c9935cece3b77183c48` | create table public.stage_resources; alter table public.stage_resources; indexes 2; policies +1/-0 |
| 20260331230654 | `20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql` | `ca0c0b054864167acf9d843b8e41efd6d6c3960b1248855804d66ca7595a7430` | create table public.stage_playbooks; alter table public.stage_playbooks; indexes 1; policies +1/-0 |
| 20260401010430 | `20260401010430_24e02eef-5c22-49e0-a6a2-7b6a60960805.sql` | `d01fc45ebd5655e4663a445acdc0c7e1d60c11a7a8efeb2e72234b0b8b750171` | alter table public.knowledge_items |
| 20260401015007 | `20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql` | `75d1430867570f6a36f72ba2f54e2eebcbb39a3f01af1e0eef5b411d5aafdd4b` | create table public.playbook_feedback; alter table public.playbook_feedback; indexes 1; policies +2/-0 |
| 20260401022820 | `20260401022820_060a5542-167e-47ac-b4fa-890b425e94fb.sql` | `ba5b856d7410e1c08f7eb4a5d537ab233291a61e417cb7ff429d3ba7b7b76274` | policies +3/-0 |
| 20260401023903 | `20260401023903_870c54b2-e8b9-4953-9eea-2cef865fc83b.sql` | `0fc281d7400798a802e1bdd247a64fa8b57c6c2c708a0c936047cf21d958380e` | alter table public.knowledge_items |
| 20260401024348 | `20260401024348_0dbbc691-eb8c-4d9b-b904-e8a665149d51.sql` | `b42464ec9fbbfe7339a58721db07bbd9f69fa512f734ab249329b22acf5e172c` | alter table public.knowledge_items |
| 20260401033608 | `20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql` | `4ed792f6a191ce6e9ed75dd7f94b2321fb47062d6dd4a16daabcc9d5085070a1` | create table public.podcast_import_queue; alter table public.podcast_import_queue; indexes 2; triggers 1; policies +1/-0; publication change |
| 20260401035457 | `20260401035457_0260b635-3ab1-49fb-8e47-1c52e034a825.sql` | `b0cdd55d3c09c6438dca46789ab28dafd63c7b7f4837080b8d595153dac5e253` | alter table public.podcast_import_queue |
| 20260401040011 | `20260401040011_31e60e1d-0ef3-4399-bcf2-c881661a00b7.sql` | `e521b4e5731aff4a2e178dda993066f3559c91bb22a7ea89e8284ce651ed14db` | alter table public.podcast_import_queue |
| 20260401041441 | `20260401041441_92bfac32-0118-48b8-a64f-1cde15570f9a.sql` | `76cb1694307ff69064ddd927be1176243a0c0901d494c29382167ccd89a25003` | alter table public.podcast_import_queue |
| 20260401185013 | `20260401185013_acdc7ba1-22f1-4cf7-a886-d5bf34b608e4.sql` | `c46c3ad1f630c5efc185b0eeecdcef7ecdf897d4c53d42932983f393574a9684` | alter table public.podcast_import_queue, public.resources |
| 20260401202156 | `20260401202156_5cc0ac6b-5fda-46b5-ba42-5ff03c6ef6df.sql` | `be1c627c7595613b1585f7df3e5d698d82fcc83c734ed7d0e31b1902d856ef70` | update public.podcast_import_queue |
| 20260401232215 | `20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql` | `d2dcd56e9e3fd021e84da55d4dbb4c95b8954747b393284a9b4db1fe1b2ea6fa` | create table public.course_lesson_imports; alter table public.course_lesson_imports; indexes 2; triggers 1; policies +4/-0 |
| 20260401232841 | `20260401232841_09e3164e-b2b0-4f91-a55c-a78222dab065.sql` | `7cbd45e9115714d937de03cbf00c27a14555a856961724d07a0c18d5362824c0` | alter table public.course_lesson_imports |
| 20260402005242 | `20260402005242_e425c768-f55d-4df1-af0f-e138d8f826fc.sql` | `6e9b92af09fa4115603d3a83c801f045f4f61e58bca31293c7a279dbc516e507` | update public.resources |
| 20260402143510 | `20260402143510_80e1093e-aa03-4d76-9ca6-ab89c57935eb.sql` | `61a2e6d8cda1ac66ba4ab89a603ed48d28c2b0106eae13ff40c3182cb68aa42a` | alter table public.knowledge_items; indexes 1 |
| 20260402153554 | `20260402153554_7ceb8a9f-9922-4aee-bdc3-b3e60d6af3e4.sql` | `f9d29cdf8db578bdaeb0024da523fcc4202f6624535c9b9d69aea0c682ba3d4e` | alter table public.resources; indexes 1 |
| 20260402195204 | `20260402195204_3b141466-26b9-4e3e-90eb-496287b2216f.sql` | `6360f7d580e9bb9279409071d1bd08dc636cf5c76169abf1b58e1a1e72ba9c1e` | update public.resources |
| 20260403035620 | `20260403035620_b1be7ea2-4935-4a03-9864-ed87295d58e5.sql` | `66c124b171eaa173e66617a21d4793d4af70d5677b5054c03b3b075880c8aac7` | alter table public.resources; indexes 1 |
| 20260403130218 | `20260403130218_cb68e44c-c55e-471b-8109-4f58e17d95e8.sql` | `766ad6011d1251bd6e0ad7d2383237ea3730475405d49fbd3fed73ae10531a7d` | alter table public.podcast_import_queue; indexes 2 |
| 20260403131709 | `20260403131709_31756bfa-c098-48f0-a394-2b8b7cf8ce52.sql` | `472af68787e357e5b54e5e7f56318c92c6f4a3f0ed0bff56437e57621a6d9f6b` | create/replace function public.claim_podcast_queue_items |
| 20260403185002 | `20260403185002_a4a71b52-17ee-462f-bdcb-d584beeea516.sql` | `a0938d1be4fc44a38e97098f3bbd979e70ad169259c887979628fdda3b6df7f8` | update public.resources |
| 20260403185121 | `20260403185121_0672cae8-7cdf-48b5-b1c3-62719ccb060d.sql` | `d6d4e121f4d5f635039da368ae2f7b3ea3e2837d7eb9ca13a1bf7c0813c4f497` | update public.resources |
| 20260403185132 | `20260403185132_e14cd686-c669-4d6f-a6fe-8e1bc62f7782.sql` | `9e42149cba89ef9e09ee2da78f7ba917f5afc4355d9c4d44cccddc1cadc1e528` | update public.resources |
| 20260403190324 | `20260403190324_2b19e3ba-8fda-4c03-995b-ca0b43ab1754.sql` | `a07d6d890cef17091ddf1a684d999d71a1c890a462391273641bcbec512daf8c` | update public.resources |
| 20260403190334 | `20260403190334_2f1f44b6-cb2a-47ab-83d8-daf558776177.sql` | `3f30b57a09fe7a0fcd6193122fb869e647535f449cc174340ac8dfc768b93c9e` | update public.resources |
| 20260403190720 | `20260403190720_bbbf157e-5421-45cd-b680-07fc0c746eb3.sql` | `8c0eee6e21ff81db568758d92af9bba102084f09949bd5600213a3c0c044ce7e` | delete from public.knowledge_items |
| 20260403204224 | `20260403204224_ddf18f88-1c53-48cc-a14b-45e8a5b3eae0.sql` | `2a29163a5bae8f865410305fa8ced2036e0baaadfc24606835705e0df95883eb` | alter table public.knowledge_items |
| 20260403235358 | `20260403235358_a4f20458-6682-4cfe-9150-235335c39204.sql` | `8fd293691928e2109f1d6578fd742795d978c02317b5b09f0d83e2b6304fb62b` | alter table public.resources |
| 20260404001325 | `20260404001325_3607b5ba-ca64-46c4-adb7-bcc67a6ffc35.sql` | `7c3871a7c7b8583e5c80a92dd1d20b8616c824541434ebe10ce8b32134cb5cf3` | alter table public.resources |
| 20260404002356 | `20260404002356_ef64b19d-40af-43ce-b543-23ef2e4460a4.sql` | `509ef1662c53686bf6302f486c84748cc010e0f911932286238724b716629919` | alter table public.resources |
| 20260404003058 | `20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql` | `77a9194de926f2988491e37724e8f92b3d97b61ad82cae1b46b122d5556d2745` | create table public.resource_extraction_attempts; alter table public.resource_extraction_attempts; indexes 5; policies +2/-0 |
| 20260404030109 | `20260404030109_11bf8759-0c73-4a3d-9646-be83317cd93b.sql` | `6bdeb381db65b96c19d69d1408930fa2206f58d629b097d1f4049d868befd09b` | alter table public.resource_extraction_attempts |
| 20260404040125 | `20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql` | `e98d3accd15f29a1495b76b208bcf9339bd9849b628ca83149e5ef6441fcfe12` | create table public.resource_collections, public.resource_collection_members; alter table public.resource_collections, public.resource_collection_members, public.resources; triggers 1; policies +8/-0 |
| 20260404043351 | `20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql` | `a022e237f8b5c3f390a9318da2dbc737e2b089b33345aeb1790bd100a60f74fc` | create table public.library_reconciliation_runs, public.library_reconciliation_items; alter table public.library_reconciliation_runs, public.library_reconciliation_items; indexes 3; triggers 2; policies +6/-0 |
| 20260405030408 | `20260405030408_38907ce7-0761-4861-952c-485652052ecc.sql` | `47532858013a3f91c794a8f1c9312f7bc00bdf846bd500e119173d4ecd99ec81` | update public.resources |
| 20260405040313 | `20260405040313_5c57e8c0-ae45-4b73-90d1-7f88981491e7.sql` | `bb2bb8a0b4858a0f2f8b719dfd9a8ab13d03938c4161cdf4fc0ae18b2947da1f` | alter table public.resources |
| 20260405042236 | `20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql` | `2b799e57c13d76b89a5cd940ec8a25e6d1e8dd64d299d253036938c0f4d9da1e` | create table public.extraction_runs; alter table public.extraction_runs, public.resources; indexes 2; policies +3/-0 |
| 20260405042249 | `20260405042249_22ff221d-136f-46d4-9cf4-13545bacc360.sql` | `071b48859a86fd91d4d963d968b11e783f314ce8bf9f62b2d71c05138f1bfaef` | policies +2/-1 |
| 20260405194229 | `20260405194229_485aeee9-955c-491c-9a43-9aeaae35ed3d.sql` | `86d21cadfd0845f302e5407e5e7eec86d36b299250f6deea0e2037fde347cfb0` | alter table public.knowledge_items, public.resources; indexes 1 |
| 20260405203433 | `20260405203433_74621966-a8de-454a-af89-c9db0e9d5427.sql` | `2f3016311d32bc8c1c384fcfd485a3aef31e9e9adb0aa3a58d8615d21c5489fa` | alter table public.knowledge_items; indexes 1 |
| 20260405203610 | `20260405203610_d3ceff93-6894-4ca9-afe9-6e262992c8bf.sql` | `7ce291d9a4f1bfa7028c3353e39fb534b1eca25a74536d9501e03788bdb1c5ae` | update public.resources |
| 20260406000509 | `20260406000509_4f39cc38-cb32-4bb7-be9c-a8bddb8b8a78.sql` | `9d851dae73387ae32a4669148b94adf4f7d3079ce493e55a420179edcc046281` | alter table public.resources |
| 20260406021618 | `20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql` | `e42214cc145feceb224c8c349a5c83e1e02165ca514e37abb88ddebecfbcd415` | create table public.extraction_batches; alter table public.extraction_batches; indexes 1; policies +2/-0 |
| 20260407003209 | `20260407003209_2afef1b2-d509-4f8a-acda-f68263c4e68e.sql` | `5cb9340d63ebeebf431a25cf395aa0eeae0021377abcf8819cde0bc1cfbc4816` | delete from public.knowledge_items; update public.extraction_batches; delete from public.extraction_runs; update public.resources |
| 20260407122956 | `20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql` | `ec3b4c4fb634c995bf57d5f5ba40d28ceb27e5f5619442252fc6300488bf95d3` | create table public.background_jobs; alter table public.background_jobs; indexes 2; triggers 1; policies +4/-0; publication change |
| 20260407202427 | `20260407202427_c606f6a6-c7fc-4b9e-aaad-2764cacd58ea.sql` | `08d195fd1fe17a61b8fb109cc7a981f77774f81a9554820a914344a95dd2ae70` | alter table public.accounts |
| 20260407212117 | `20260407212117_965fa332-b761-4612-8e4d-e578ea450b72.sql` | `75528ebb0aa5aac5ba25aa7511f97ac1d9ed38da98ccdd835754e633f9822964` | create/replace view public.active_accounts; grants/revokes |
| 20260407212131 | `20260407212131_03f71716-6fad-4ded-a575-47b01f6cf9e7.sql` | `45f818a7d4947955603364e19ff746a4ce3b55f5140cafbb1c644ba797943c9e` | alter view public.active_accounts |
| 20260408012020 | `20260408012020_c8420372-8266-43c2-b417-50efe6414d26.sql` | `a8b16bf5994a880d9c745f8ac29aa3e7e92825bf0fc189f7b76db2224d778a15` | alter table public.resources |
| 20260408033258 | `20260408033258_7db5ee9b-f6f4-427e-99b6-51dc16540254.sql` | `dbe47096f83488ddc46d18090b3e6534e8387a76e0e288de448e9744093298f2` | delete from public.extraction_batches; update public.resources |
| 20260408034541 | `20260408034541_3e6b2399-df0d-4d55-b0a1-03fdc8ee210d.sql` | `4c74990b505fdedd463549317c9b43ce22d17e571066074c04b4fafff1bfb81d` | delete from public.extraction_batches; update public.resources |
| 20260409113905 | `20260409113905_0bc4585a-e9a8-4ac2-96a1-e63132844c94.sql` | `82209d7b52c1dad6edf520cce001e91952e7db190355052fde057cddb32f00fc` | alter table public.course_lesson_imports |
| 20260409120435 | `20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql` | `3f23b94532ff8fc76818b05aec2ff6000d8e4c4f26a5cc05d05a5657d820483e` | create table public.lesson_assets; alter table public.lesson_assets; triggers 1; policies +4/-0 |
| 20260410034645 | `20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql` | `7842ac70350ecbccae0b633cb4f49d6e1613fde59fde06109a17ded50da62d4a` | create table public.dojo_sessions, public.dojo_session_turns; alter table public.dojo_sessions, public.dojo_session_turns; indexes 3; triggers 1; policies +6/-0 |
| 20260410141956 | `20260410141956_52db6e26-f214-4f48-a30d-73d9062feb0b.sql` | `ee9458ac76146e9a9a8b8c4f3b01c92c19ea8cb97aa2e473b8dd799a400a500f` | alter table public.resources |
| 20260410203637 | `20260410203637_d90ed380-ec79-432f-beca-4ecb49a90abb.sql` | `22c2dde2e9cbf840685a22ec370ace8418ca661b1991d40c024c54d07153be60` | create/replace function public.claim_podcast_queue_items |
| 20260410203919 | `20260410203919_0dcd8379-a009-4e51-8194-28b2f4a86461.sql` | `291553d490b228cb6d976130cef7789473290def0974d7d900a41bc5609d3fea` | create/replace function public.claim_podcast_queue_items |
| 20260410221307 | `20260410221307_574f6105-9483-4ba4-8b64-d61e1264eb34.sql` | `fa37e333c5dbe1b0073584b572b03d522d5bd419a1943c0a09991e339c4bb5c1` | alter table public.dojo_sessions |
| 20260411221816 | `20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql` | `3c7593a982e00fdfac9e825636cee18a5d98b350bfe49ee138d78f0b1ae008f8` | create table public.learning_courses, public.learning_modules, public.learning_lessons, public.learning_progress, public.learning_quiz_answers; alter table public.learning_courses, public.learning_modules, public.learning_lessons, public.learning_progress, public.learning_quiz_answers; indexes 6; policies +8/-0 |
| 20260412145108 | `20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql` | `1bd43c96abd82bcab44b30532ca6fb689e759d04b82f4989b39c1ee07700985b` | create table public.training_blocks, public.daily_assignments, public.block_snapshots; alter table public.training_blocks, public.daily_assignments, public.block_snapshots, public.dojo_sessions; indexes 4; triggers 1; policies +8/-0 |
| 20260412182430 | `20260412182430_8ac7cba8-8479-4a84-9160-3ae5f85a50b8.sql` | `589308b89c5473726ba3bea941621219a1ef4a9b24cd6f6bf46ba8f856998355` | alter table public.dojo_sessions |
| 20260412185125 | `20260412185125_8c63511a-3799-41ab-8753-cd86ac8a49db.sql` | `b57bd0a5236ac7d18b1841d7b84e6c7a3a2578b4723b5b73b76b48fc24a3bd6b` | alter table public.daily_assignments |
| 20260413002642 | `20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql` | `2a4889dd8cacde4d14a2daeccb6f43aa39b60907dd6955f6b647b34d0f6cb94f` | create table public.skill_builder_sessions; alter table public.skill_builder_sessions; triggers 1; policies +4/-0 |
| 20260413142229 | `20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql` | `958e9a449bf43e62b5bf0762b3d72670102add8fd7f2b1eeef481b5af915526e` | create table public.closed_loop_sessions; alter table public.closed_loop_sessions; indexes 2; triggers 1; policies +3/-0 |
| 20260413150219 | `20260413150219_e94d5516-d89e-4d77-800a-58508b8ea650.sql` | `d1afa0f6dec8d74515a70556cecaf9fb54a5ccfb37ec108d7681af5a95e1a958` | create/replace function public.get_resource_content_prefixes |
| 20260415045353 | `20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql` | `29bcebe19f61be049e7010bba557e2a3edda614a6e4376fbb0db6957272fe56a` | create table public.strategy_threads, public.strategy_messages, public.strategy_thread_resources, public.account_strategy_memory, public.opportunity_strategy_memory, public.territory_strategy_memory, public.strategy_rollups, public.strategy_outputs, public.strategy_uploaded_resources, public.strategy_workflow_runs; alter table public.strategy_threads, public.strategy_messages, public.strategy_thread_resources, public.account_strategy_memory, public.opportunity_strategy_memory, public.territory_strategy_memory, public.strategy_rollups, public.strategy_outputs, public.strategy_uploaded_resources, public.strategy_workflow_runs; indexes 8; triggers 6; policies +10/-0 |
| 20260415045912 | `20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql` | `6e8231151f668f89804242f09e22182f21ef90c1c6b8d9a4275522d184204876` | policies +3/-0; storage bucket/policy |
| 20260415053701 | `20260415053701_43e1de1e-0d2d-4c28-8bff-d1b756085a33.sql` | `3c2bf759141aa7b3156634b1f70542ace905b4743d5dd3366da5656f0bdc3cd0` | alter table public.strategy_uploaded_resources |
| 20260415055225 | `20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql` | `92edbded8f9c81b8fdb0ba42553d35c72c4daab1a9238b9d66747ffa700ebf66` | create table public.strategy_artifacts; alter table public.strategy_artifacts; indexes 3; triggers 1; policies +4/-0 |
| 20260415065448 | `20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql` | `8390c8fa45b7761ea908e96a0f61c145a350a6b00c60822e457f43569a48a979` | create table public.strategy_artifact_feedback; alter table public.account_strategy_memory, public.opportunity_strategy_memory, public.territory_strategy_memory, public.strategy_artifacts, public.strategy_artifact_feedback; indexes 4; policies +1/-0 |
| 20260415072138 | `20260415072138_ca98e0f4-8921-4814-a47b-c70661ed89b0.sql` | `eb8be9c601a92d3fe213d3fb5b98eb746ac462fbe18790c19bd3c4386c167564` | alter table public.strategy_messages, public.strategy_outputs, public.strategy_artifacts |
| 20260415085724 | `20260415085724_a357c647-06ce-40bc-9632-b2cfe1837c51.sql` | `5df822797689e54660de7b096a943739f58e448e977f94186e1706625e420079` | alter table public.strategy_artifacts |
| 20260415123207 | `20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql` | `5e89074fb82288064df238e33acd6acbd398c1214cbc691ff430752145e1995c` | create table public.smoke_test_results; alter table public.smoke_test_results; indexes 1; policies +2/-0 |
| 20260415165519 | `20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql` | `ad34efa80a1586e06e11435ccae40e9d650f39eff23253b2216c28cd0f6d67ce` | create table public.command_shortcuts, public.command_feedback; alter table public.command_shortcuts, public.command_feedback; triggers 1; policies +2/-0 |
| 20260416143953 | `20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql` | `db99efba8dd0ca5c7115ef078d8cd810c015ce439e26d354d1b6c0517466776b` | create table public.task_templates, public.task_runs; alter table public.task_templates, public.task_runs; policies +6/-0 |
| 20260417104251 | `20260417104251_3b0928df-bf21-440f-bdf7-409817e98dd3.sql` | `ba1596bedeb8fcbe501b1f07a4f4974af4d7a8c9de36cb3baf5ccba751c937c3` | alter table public.task_runs; indexes 2 |
| 20260417113101 | `20260417113101_1065568c-bfc0-4315-8725-477e5f60384b.sql` | `73d4dd72577ab2c5d5fcffaba6660859106d7e7db8bdd564fb0f0946389fc137` | update public.task_runs |
| 20260418185848 | `20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql` | `154c63b03b3abf066707a8579d6e8c548d3850a6403a32bb273f35565b7e9aca` | create table public.strategy_promotion_proposals; alter table public.strategy_promotion_proposals; indexes 5; triggers 1; policies +5/-0 |
| 20260418192147 | `20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql` | `99205b5581a7b71536789c1dcb30803ce12288b391974bd6b6af169bca0b97e5` | alter table public.contacts, public.call_transcripts, public.resources, public.account_contacts, public.account_strategy_memory, public.opportunity_strategy_memory; indexes 5 |
| 20260418201159 | `20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql` | `f558d514e1632ce0fd3924dc32d6eaec625040bfef13395d6305273029d74208` | alter table public.strategy_promotion_proposals; indexes 1 |
| 20260418211313 | `20260418211313_43305570-fd47-43fb-a47b-6d726d710446.sql` | `49df1b9b3a68ce332f416264a3df9a324a81d1358b7f6592e79d1b73f2ee2cc0` | alter table public.account_contacts; indexes 2 |
| 20260418234123 | `20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql` | `fc1bf3ab92e30e510910ea7da4a13673315223b3978cd99c7f0fb017f3fd7bf6` | create table public.strategy_thread_conflicts; create/replace function public.compute_thread_trust_state; alter table public.strategy_threads, public.strategy_thread_conflicts; indexes 2; triggers 1; policies +4/-4 |
| 20260419002409 | `20260419002409_da4e7e06-a550-4a2e-944b-5a5cb43944c8.sql` | `cdd5c2ab495770aa3d8fd8c69922b069753ffee2c0072d02527e0d2826e4f73c` | alter table public.resources; indexes 1 |
| 20260419024334 | `20260419024334_b8be2134-48cb-4f4b-8fbe-9fe5667fe098.sql` | `c977173a1690f62f3109327b7e8bc1bbf61a2d0bbbe8fa65fe16bd91c71c4375` | insert into public.strategy_artifacts; insert into public.strategy_uploaded_resources |
| 20260419024403 | `20260419024403_635bb45e-8357-498c-8f8b-984b4a6acf64.sql` | `499502c11814ec89ed61ffee2b8433c831f8a87325098578cd54e174bcfad527` | insert into public.strategy_promotion_proposals; update public.strategy_promotion_proposals |
| 20260419024448 | `20260419024448_1595efa8-ec0a-47fd-acdf-24fea0c90ce0.sql` | `a00e189083bc423d725dfc4308171c531b6a45737d0a661f779605c349a0099c` | insert into public.strategy_promotion_proposals |
| 20260419031210 | `20260419031210_4f237bf7-f274-43e0-8919-f9419c49d97c.sql` | `956380901917245899feddb39f708d79020e98ea80044bb649c5a872422c3798` | insert into public.strategy_threads; insert into public.strategy_artifacts; insert into public.strategy_uploaded_resources; insert into public.strategy_promotion_proposals |
| 20260420130037 | `20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql` | `886603943e7b20980e230f2c651b68b3e5921ecf21d9f24f84e9f707938a215e` | create table public.strategy_stress_runs, public.strategy_stress_turns; alter table public.strategy_stress_runs, public.strategy_stress_turns; indexes 3; policies +2/-0 |
| 20260420173611 | `20260420173611_3d7dc2ae-778b-47f2-a663-c6e5f2666bd0.sql` | `5a78d49b68196dfd5fc0202055c430a9dd22cc374a3fd318925314fb24655ad2` | alter table public.strategy_stress_turns |
| 20260421165449 | `20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql` | `0daca5103bb273390f9ee09626acc04daec6217b9eecc4251b2d69f346b37c7b` | create table public.strategy_benchmark_audit_logs; alter table public.strategy_benchmark_runs, public.strategy_benchmark_audit_logs; indexes 4; policies +1/-0 |
| 20260421171359 | `20260421171359_00445f9f-32fd-4b4c-a527-a675aeb86ada.sql` | `706ca5b6661567f92f60917fc160167a94864c98f4bb60d5e64a7138dba1c30d` | create/replace function public.get_resource_lifecycle_summary; grants/revokes |
| 20260421193959 | `20260421193959_a1a09c8f-6363-4224-9482-0d52e81bfd64.sql` | `4c176bfd49cebe5a442fe205e9d5605a389881829d73fb8cdac862046e7bfcde` | policies +1/-0 |
| 20260421194016 | `20260421194016_b5aebdcd-e66a-4f96-a60e-66b272472e83.sql` | `4cfe632a3832df5bb1d743943604290e3872c620627358d83380bbe8b767f34e` | policies +1/-1 |
| 20260422020625 | `20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql` | `25eb9741029fc6109cafe1e2f67511e09b76fcbf38afa7c70ba2d5e543c7547e` | create table public.library_cards, public.routing_decisions; alter table public.knowledge_items, public.playbooks, public.library_cards, public.routing_decisions; indexes 6; policies +4/-4 |
| 20260422112337 | `20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql` | `0fca78f4b6421f7205b4899dac0b886503014307aa26101a0c7f9652ed9c4776` | create table public.canary_reviews; alter table public.canary_reviews; indexes 1; policies +2/-0 |
| 20260422123454 | `20260422123454_5926f74a-551a-43a4-a76e-55fe45dc97ca.sql` | `4af6b95673f0d57f149c87a6f531acc69fe8edad72e71864f43c7e8c41b5c577` | indexes 1 |
| 20260422150004 | `20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql` | `994d97f1618e813f8b27414e9fbfc56a9a48810d08303131654ae7d58f2c64d7` | create table public.lifecycle_audit_events; alter table public.lifecycle_audit_events; indexes 3; policies +2/-0 |
| 20260422163735 | `20260422163735_5b3fcceb-cab7-481a-86f3-f929b6e9e340.sql` | `e293b4fbdc7925b5a340dfc749f84e86bc59260892afe9dd7986462330cb1540` | alter table public.task_runs |
| 20260423145107 | `20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql` | `f235ca70a0d4ceb31f23606499343120a98222574ed6d4c74118d98418ffac54` | create table public.task_run_sections; alter table public.task_run_sections; indexes 2; triggers 1; policies +3/-0 |
| 20260423184558 | `20260423184558_cbbc3870-5867-4cbd-915a-1455ae33c282.sql` | `2d596757eb1d7bb94e1ed7a5223a7e2865f89f29000f196b1b98500eb00bce52` | alter table public.task_run_sections; indexes 1 |
| 20260423201919 | `20260423201919_ffe4daa9-70cf-44d6-be6f-0002423551e9.sql` | `ca97d10d01a10b6d45436032199709e5fa0440f531f57f2fd5a6846ef079c077` | update public.task_runs; update public.strategy_threads |
| 20260505223434 | `20260505223434_138829e6-b7ce-4303-a6e0-7baa369f86c9.sql` | `8429cd9d7e24e25c35aadd4edc6409ef7b85b856dcc81b27276456364ad3f1a5` | alter table public.strategy_messages, public.strategy_outputs; indexes 2 |
| 20260506195248 | `20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql` | `ced700443ecef4a7c2587c1e037050b2d0eb141d54aa5a6b5706188c2fa149a8` | create table public.strategy_run_telemetry; alter table public.strategy_run_telemetry; indexes 6; policies +3/-0 |
| 20260506195306 | `20260506195306_2fcc89ff-58f2-4442-9329-4e9f47861063.sql` | `081d8d3f9e93a90578fdd522d7f89e16a43361c919993cd00974325bb5c66a56` | policies +0/-1 |
| 20260506224454 | `20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql` | `94a1fe23718292ae7f65d288ad1700115f1e56caa1f6006d40174701471517a5` | create table public.strategy_synthesis_cache; drop table public.strategy_synthesis_cache; alter table public.strategy_synthesis_cache; indexes 2; triggers 1; policies +4/-0 |
| 20260508020735 | `20260508020735_3cddde55-6b8d-4597-8fe5-621f39c662c5.sql` | `79efa6946be03873837f5ebf3f83d58357db835d490813b5aafb51aa856953d1` | alter table public.opportunities, public.contacts |
| 20260513210721 | `20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql` | `dde357e9fbdc80d5b1d6deeea96ba1b009588e7fb557f758828b30f70bba639f` | create table public.circle_credentials; alter table public.circle_credentials; triggers 1; policies +4/-0 |
| 20260514114437 | `20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql` | `e975e5fc3c6527d75a12c30a33c7fa5cd89c1032b0da7e65e7a29d288f11c042` | create table public.course_imports, public.course_lessons; alter table public.course_imports, public.course_lessons; indexes 1; triggers 2; policies +2/-0 |
| 20260515180307 | `20260515180307_1583e40b-062a-4e7d-98f0-0adca2c256a8.sql` | `695e7ce6b14e01a07d0d66a5e2bb0b12a3c42d851e128b9001035a5f7b073521` | create/replace view public.resource_truth_drift |
| 20260515193348 | `20260515193348_af253f6b-68a9-4206-91be-751f6c18d890.sql` | `0c9b8f0af87e13a38f7f1ebe863c751dffa7ccecf12c31d884dc6a5f6dd2593f` | create/replace function public.get_resource_lifecycle_summary |
| 20260617184606 | `20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql` | `f71ebc8bab0e44f2b3c6b30d955f37d8d871cfd0855598f46b08fd9e6b1de19e` | create table public.ki_mastery; alter table public.knowledge_items, public.ki_mastery, public.dojo_sessions; indexes 2; triggers 1; policies +1/-0; grants/revokes |
| 20260617201120 | `20260617201120_d54f87ad-9446-4605-ba7c-d6006f3781c1.sql` | `1270d89dd2ba52a78fc399496a06e1a0674f54f89a35bec20eb66030a20d59cf` | create/replace function public.get_next_ki_for_dimension; grants/revokes |
| 20260618030346 | `20260618030346_81d4a1f9-adc8-4df4-b94d-55fdeddd5c9b.sql` | `cf2134906246eebfa791864120ab69bdf1febe3f307ec27cf77035fb84475bea` | update public.knowledge_items |
| 20260618202958 | `20260618202958_bd9822ba-8076-4f11-8fb1-cdbdaecadb09.sql` | `fe7a3a2c28fac304d4228353f28b0db33034f5bc8e6b8c3e976eb4569e6c58c6` | update public.knowledge_items |
| 20260618203132 | `20260618203132_a907bc8e-7fe7-49f7-87fe-e1708d21bfab.sql` | `40c5125850ecf9050a019ea23d9f7099e44931afdd30727b035603b1b08bc765` | create/replace view public.dimension_scores; grants/revokes |
| 20260618203144 | `20260618203144_0d5f5ce5-aa70-443f-9026-b8f1e1622c1c.sql` | `843fee6edf57c770af05fdc3ff29d7a05e1991fc6aff5e8c9382275ba9a0cf99` | alter view public.dimension_scores |
| 20260618203341 | `20260618203341_862ff68a-fdfc-4184-a963-0b585a193385.sql` | `871ef0729770c2b238bb49a4e8c57d4719272faf1f2629a2dbbddf342cc9dca3` | create/replace function public.signal_dimension_weakness; grants/revokes |
| 20260618204720 | `20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql` | `58a6d81eaf501fcb8ba76c3962f5bd5acfe685aa56772293cca1dbeeb65edd92` | create table public.user_settings; alter table public.user_settings; triggers 1; policies +1/-0; grants/revokes |
| 20260618205532 | `20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql` | `3fbc868d5f30e49a7949ab4992865ee7b0a825cd75b027ff095ba40351219a18` | create table public.user_lesson_progress; alter table public.learning_lessons, public.user_lesson_progress; triggers 1; policies +1/-0; grants/revokes |
| 20260618210020 | `20260618210020_46c652c9-a0e4-4c94-9ba0-6ac81c66ccc8.sql` | `befa52cb2776a048232375e6e789afe1ce87c904f61d24a65f827aa915f442be` | create/replace view public.branch_readiness; alter view public.branch_readiness; grants/revokes |
| 20260618211644 | `20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql` | `0221594493d5eeb6b3ed576b2ff5c3d05acf35abba022f59c6b9f59a673c7132` | create table public.skill_benchmarks; alter table public.skill_benchmarks; policies +1/-0; grants/revokes |
| 20260619011713 | `20260619011713_887c20f9-2ef7-4008-8ff1-b542fc9b7352.sql` | `9668731bc413ff83ee9f97dec2c1d424579bb25ca84281e35172e025a0932f0f` | alter table public.transcript_grades |
| 20260619013605 | `20260619013605_19b9e666-b9ee-4b92-b812-816bd60b3fcc.sql` | `cedcedcc06436948a4635732473104ec7ba67ba6ee8ec81fa2e779285e5ffe11` | create/replace view public.ki_mastery_weekly; alter view public.ki_mastery_weekly; grants/revokes |
| 20260619014224 | `20260619014224_116c05ae-d558-457f-9163-4ea824cf2361.sql` | `0241cdc6fb8780f4da51043d3be23c8826eb40131569a81e173e93bd7616510a` | create/replace function public.get_next_ki_for_dimension; drop function public.get_next_ki_for_dimension |
| 20260619105525 | `20260619105525_93510ef2-72ac-4c65-bcb8-691268a71ec2.sql` | `60de58bd28b57312e478d70a8e6f0363deefb119bfdea30824323f918c31abdc` | alter table public.ki_mastery |
| 20260619111649 | `20260619111649_a1883a9a-521b-4a69-b492-b3740979a78f.sql` | `f86cef6027057d3113a866029e610db6b7a7326c4022ffb80d02cd80aa09fa39` | create/replace function public.get_next_ki_for_dimension; alter table public.ki_mastery |
| 20260619111906 | `20260619111906_dc0a68ab-41e0-401f-a661-e96763085aff.sql` | `b90b9297cab5938c5bc8a831ec2022c7833dd6d8ca528c3d48a255b3d677c387` | create/replace function public.signal_dimension_weakness |
| 20260619115649 | `20260619115649_9b20be45-2309-4a96-89e3-804eaf82f95b.sql` | `e932a89bd19e3d72499cde912516a6f494158e9215eb740204efd618ae29669c` | create/replace function public.get_next_ki_for_dimension |
| 20260619115818 | `20260619115818_9ccab14b-de04-4f9d-8088-f95436bc5a74.sql` | `31b1280d49dd7c31f4b0a6817a31e28c50f4ed17f045938c1a459f2188f8a363` | create/replace function public.get_next_ki_for_dimension; drop function public.get_next_ki_for_dimension |
| 20260623185454 | `20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql` | `696207cdaf9dd9708234226e11c80797a6210723ec3cf4674807d8c8a5b6102f` | create table public.territory_profile; alter table public.territory_profile; triggers 1; policies +1/-0; grants/revokes |
| 20260623193651 | `20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql` | `5d58af77c6d121519480a28ae6c73615f914d89495e710f61ce3b5a87fb07a94` | create table public.call_logs; alter table public.call_logs; indexes 1; triggers 1; policies +1/-0; grants/revokes |
| 20260623194405 | `20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql` | `dff4cd059e9429a9f62bcc77ae54ba0002d5160b68c72e4c5f409d20a67ab013` | create table public.account_signals; alter table public.account_signals; indexes 2; policies +1/-0; grants/revokes |
| 20260623194810 | `20260623194810_2a42a74b-57b7-4747-b613-1c426327c416.sql` | `c7687423156dac28fc3dd5d8a1ac8d498d2b4234364f68e8e5950ddf9ad8707c` | alter table public.accounts |
| 20260623195008 | `20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql` | `740c815678aa5339f8d4ce58135b676dc3e6ebd4c4331afa96139eaa06035993` | create table public.branch_footprint; alter table public.branch_footprint; triggers 1; policies +1/-0; grants/revokes |
| 20260623200100 | `20260623200100_c55c2dc0-b42e-4bc0-96a4-aa46c37c5a57.sql` | `36c0c49d93112d03ca6c45c4bf70d0f322c5570b4ea7b33cc51b2fde1e13493e` | alter table public.knowledge_items; indexes 1 |
| 20260623232312 | `20260623232312_815eccb8-6d8d-4ce1-9ab9-c121553378ea.sql` | `adff96138865db6c516a9920731ef51a08a123ca58acb73cef8f7ec531cab3c4` | alter table public.transcript_grades |
| 20260624193910 | `20260624193910_360abed1-e061-434f-a71c-3856d1c68d41.sql` | `a7df2327f6b4ea3e3421dce0e22cfe64118551c58c6075b45f5d257f97eeabf2` | alter table public.call_logs |
| 20260624203203 | `20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql` | `37c0263e744a1903b2df9d4baccdadb02ddcb349382ebf2b6a288cd4aad6a23e` | create table public.strategy_custom_pills; alter table public.strategy_custom_pills; indexes 1; triggers 1; policies +1/-0; grants/revokes |
| 20260624203925 | `20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql` | `c2bf5a0fec0945c1b40316bd1c59782ce8b324b2c3e0a325cb336a7974e4056a` | create table public.account_project_settings; alter table public.account_project_settings; indexes 2; triggers 1; policies +1/-0; grants/revokes |
| 20260624221815 | `20260624221815_cda2671c-5bff-4bc7-b87f-42b738aec295.sql` | `479c8dc76a0c5f139e9bdf3a61520ed508a3d994a894a993770917df43e05ab1` | alter table public.call_logs |
| 20260702004039 | `20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql` | `6892c095eac2453e30084595529e5c890a1641c52bd143cb6ba90cb7dc6f503a` | create table public.flashcard_decks, public.flashcards, public.flashcard_state; alter table public.flashcard_decks, public.flashcards, public.flashcard_state; indexes 2; policies +8/-0; grants/revokes |
| 20260702034506 | `20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql` | `0ccdddf475695f6eb5fdeab3e06cebf2f7f90611c226e97c40b0bd48b3f09581` | create table public.user_train_prefs; alter table public.user_train_prefs; triggers 1; policies +4/-0; grants/revokes |
| 20260702121921 | `20260702121921_8051d975-f858-475c-a196-5f5f635b2cb1.sql` | `4e507b3fcb615f5479d056ad1b0596dabe08dcce01c7dbed71f12b7cfbc9678b` | delete from public.flashcard_state; delete from public.flashcards; update public.flashcard_decks |
| 20260702123531 | `20260702123531_76fe7c39-9315-47d5-b3a7-f8d29f028efb.sql` | `4e507b3fcb615f5479d056ad1b0596dabe08dcce01c7dbed71f12b7cfbc9678b` | delete from public.flashcard_state; delete from public.flashcards; update public.flashcard_decks |
| 20260702183204 | `20260702183204_340b2639-fb8b-4d40-bed0-cb3e467ca4eb.sql` | `6815440a6e81874dfc6155a70924b57fab7a8077b48aced400e75269393ca298` | alter table public.ki_curriculum |
| 20260702184420 | `20260702184420_2d9e1224-ade2-49c1-98e9-2869516514bb.sql` | `9b7de6ff81531e93a3e03eebd7df0f22057f1a77a03fb20233d5a05d9eb3fde8` | update public.ki_curriculum |
| 20260702190221 | `20260702190221_1ff74b45-7443-4058-97d0-4744ea6df6a8.sql` | `f5c4583c8d256dcc6a5963ce41f3fb964361e4faeb96797c7bdf221a97493754` | delete from public.flashcards; delete from public.flashcard_decks |
| 20260702191624 | `20260702191624_661bc32a-e1b1-46f0-8d30-891425d54878.sql` | `689b8067d78208b812b1ca3725c2fd1dd624cf0c3bc719d2c737f5368021821f` | update public.ki_curriculum |
| 20260702194202 | `20260702194202_48822c45-d6a5-4f6a-8962-85d987c2729e.sql` | `b04f7656073cc7e38d580f7db8f5fca7ab6d715823446b05e2e4b24486b6593a` | update public.ki_curriculum |
| 20260702194634 | `20260702194634_9b645ce5-8e75-4231-ba7c-da9af9f5b104.sql` | `145c5b26fc443eae82b191f569890fb892e71ff013c30bea720b91d87f4b6122` | update public.ki_curriculum |
| 20260702195959 | `20260702195959_8855e7f1-ee1e-4206-8db9-a31c25aebb5e.sql` | `ccda1561552e0ec50fa44f8e12b0456770c43a923bcaf9d50a75959d402be353` | alter table public.curriculum_gates |
| 20260702203829 | `20260702203829_34e5ef77-335c-4286-ae54-ae96a2e6f1da.sql` | `5249d95fb4b61557258d7e3d34b0b7bb8196507926f83f0a521a5deb9a0bed6a` | create/replace view public.training_field_efficacy; grants/revokes |
| 20260702215327 | `20260702215327_df2b95eb-a09b-4128-98c1-cd721c7dda9e.sql` | `c4b075902765f1d7076aea885a078087df0c116c37f2f0130c7dfb579d185328` | create/replace function public.calib_drills_export; grants/revokes |
| 20260702215515 | `20260702215515_8bf62f29-b769-440f-95e2-9166c47b2981.sql` | `2836f2fdd2e2ede454ee6832cea4a4c1d98a44b614f46aeda6da5783f9a2f6ae` | update public.ki_curriculum |
| 20260702221122 | `20260702221122_c4cb6e64-ee25-4ca6-bf3b-ca28dc83024e.sql` | `49a4032101f058523801c6c2ed511094c63cc6a1c34178402367df4c9f0f16df` | drop function public.calib_drills_export |
| 20260702221315 | `20260702221315_dbf4d9ee-0742-4447-9422-e14f183d22ae.sql` | `05ee81cee0cc9cbad3a284809cca42fecaf6b5ba84ccd39b1c4ec74940b3487f` | alter table public.curriculum_gates |
| 20260702230003 | `20260702230003_17837262-4438-48ef-aa10-8d694fedfd51.sql` | `e7464c9dd9d6569103bc31bfc440c39fc2709bfeaa70c559a90b9440a5cb0dee` | update public.ki_curriculum |
| 20260702235617 | `20260702235617_53846882-b994-43d6-b255-ff700d7908ef.sql` | `a7848999f536bd0c43a59e75b64a65197b7cee2c8f70720a4efef2c85591ccef` | update public.ki_curriculum |
| 20260703000000 | `20260703000000_batch7_drills.sql` | `130b95e1186ec0f5e3b951a9b2ffbf0c102e48b19f96c1fa3d3add69cbf2cd73` | update public.ki_curriculum |
| 20260703005516 | `20260703005516_14204041-7689-400e-ba7b-60dda7c86711.sql` | `0d92ddd571f8c8966f11505566d9f1d5e7184fde3a8a88d4a3f64521182182d7` | update public.ki_curriculum |
| 20260703010000 | `20260703010000_batch8_drills.sql` | `e5717144114578768c3be48bdda2db889c33319b93daf961214b377d1fda561f` | update public.ki_curriculum |
| 20260703020000 | `20260703020000_batch9_drills.sql` | `b8493c131a37b1bb18aac20c13e2a25031d331063591761c5cb67f8d468dec1d` | update public.ki_curriculum |
| 20260703174003 | `20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql` | `f74b2584434e49d7cad12e1c37bb2d16c7c196d494bf59aad7c8c47dacbd95fa` | grants/revokes |
| 20260703174041 | `20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql` | `05012db88522272403e1c58c80cee514af02ec0983f5c4b29428f307c7308e49` | grants/revokes |
| 20260703235457 | `20260703235457_166361bf-4c11-4685-a363-14c6caf7b5c2.sql` | `cb137c0381256937a1f6d4d21a133c79bf20ca64c252080e85aa43b5479c831b` | drop table public.whoop_daily_metrics, public.whoop_connections |
| 20260704023604 | `20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql` | `e30341ab31c8fc1d8c0e239400bc485948c6f19f04ac5fe19286543c7286c1b8` | create table public.integration_runs; alter table public.integration_runs, public.user_settings, public.strategy_messages; indexes 3; policies +2/-0; grants/revokes |
| 20260704034559 | `20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql` | `d9246c8a615cefd81b86deaed73aff113cd4621f78e2fe10ca79635ba51c50b2` | alter view public.active_accounts, public.dimension_scores, public.ki_curriculum_full; policies +1/-1 |
| 20260704141918 | `20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql` | `7a3216c3650bcbf10ec28a935b594508273f70e9f523802695f0312c90a09df4` | create table public.products, public.account_product_ownership; alter table public.products, public.account_product_ownership; indexes 3; triggers 2; policies +2/-0; grants/revokes |
| 20260704170523 | `20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql` | `724593ccc589ea5b7e3e615f3d80bbe73fb569458cab48f9f28ae362e5b56196` | create table public.nav_events; alter table public.nav_events, public.user_settings; indexes 1; policies +1/-0; grants/revokes |
| 20260704202956 | `20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql` | `62a6974a923aef53da38e1c58643adc685bd2a20f8402686c01dc077baf8e412` | create table public._agent_staging; alter table public._agent_staging; grants/revokes |
| 20260707002001 | `20260707002001_ea8b0bf0-b33e-4d31-906f-1b04ff6db3b8.sql` | `9d991d59eb0d39cee5c541fa985969a299b7056c6644bf440a9bc51f5a6fac99` | policies +1/-1 |
| 20260708200707 | `20260708200707_a0266e87-16b8-4311-914d-bd2a2640d2dc.sql` | `3d83b383243a72e8e829979a809b33d7646669c9f6581921c91f04e3365ca2f6` | alter table public.opportunities, public.call_transcripts; indexes 2 |
| 20260708220725 | `20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql` | `0a847656ce8ab7943994e61799f5c059b865ed68ec4ce6e2a65160113ef52b46` | alter table public.circle_credentials; policies +0/-4; grants/revokes |
| 20260709184115 | `20260709184115_78ccebfc-3280-4533-bb7a-a8cb2a7b88c6.sql` | `09351d9930754916bc002842b90d74ad3347a308ce96d85b69c902636130323b` | create table public.function_configs; alter table public.function_configs; policies +1/-0 |
| 20260711134232 | `20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql` | `5436473972c0ebc1f4fc4b0f407af06d8f80ec0549f9dcfc7e96115187785d6c` | create table public.agent_cron_map; alter table public.agent_cron_map; policies +1/-0; grants/revokes; cron schedule |
| 20260711211528 | `20260711211528_f1363130-12e4-4646-b023-1aa45a52a98a.sql` | `b6277901cd7b4ad6064876663f3292b4b31ab480d5009102aa2441108649a297` | update public.territory_profile |
| 20260716160050 | `20260716160050_add_cron_attempt_receipts.sql` | `01d9d091cef3a26e9d909249fd30b7e200e73515904d1217a1202de4b5a33857` | create schema cron_receipt_private; create table cron_receipt_private.cron_attempt_receipts; create index public.task_runs_pending_updated_at_id_idx; create functions public.execute_strategy_task_reaper_attempt, public.read_strategy_task_reaper_receipt; RLS state; grants/revokes |

## Tables

- `public.work_schedule_config` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:2`
- `public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:18`
- `public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:26`
- `public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:34`
- `public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:43`
- `public.badges_earned` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:58`
- `public.streak_summary` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:67`
- `public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:2`
- `public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:2`
- `public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:35`
- `public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:56`
- `public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:86`
- `public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:116`
- `public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:2`
- `public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:70`
- `public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:2`
- `public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:15`
- `public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:27`
- `public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:2`
- `public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:2`
- `public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:3`
- `public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:19`
- `public.weekly_reviews` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:2`
- `public.dismissed_action_items` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:43`
- `public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:2`
- `public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:2`
- `public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:3`
- `public.ai_feedback` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:27`
- `public.conversion_benchmarks` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:3`
- `public.pipeline_hygiene_scans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:31`
- `public.weekly_battle_plans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:55`
- `public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:3`
- `public.icp_sourced_accounts` — `supabase/migrations/20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql:10`
- `public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:2`
- `public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:2`
- `public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:2`
- `public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:2`
- `public.resource_folders` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:3`
- `public.resources` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:16`
- `public.resource_versions` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:36`
- `public.template_suggestions` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:3`
- `public.voice_reminders` — `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:1`
- `public.dave_transcripts` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:1`
- `public.resource_digests` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:3`
- `public.custom_prompts` — `supabase/migrations/20260320221358_e78ea58a-5cd7-4a4f-beea-07c2d9b3c505.sql:1`
- `public.deal_patterns` — `supabase/migrations/20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql:1`
- `public.coaching_plans` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:1`
- `public.resource_usage_events` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:15`
- `public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:2`
- `public.resource_jobs` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:3`
- `public.resource_job_steps` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:28`
- `public.resource_chunks` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:57`
- `public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:3`
- `public.knowledge_signals` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:37`
- `public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:2`
- `public.weekly_research_queue` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:3`
- `public.research_queue_events` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:22`
- `public.playbooks` — `supabase/migrations/20260326091059_d43a38b2-ffe9-4a22-bb09-63413aa6c7bf.sql:2`
- `public.playbook_usage_events` — `supabase/migrations/20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql:1`
- `public.source_registry` — `supabase/migrations/20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql:3`
- `public.audio_jobs` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:2`
- `public.verification_runs` — `supabase/migrations/20260328034915_8e6d0931-bdcf-42c4-bc9e-46d177043a02.sql:2`
- `public.approved_users` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:3`
- `public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:2`
- `public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:2`
- `public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:2`
- `public.execution_templates` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:3`
- `public.execution_outputs` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:44`
- `public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:2`
- `public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:3`
- `public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:3`
- `public.cluster_resolutions` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:24`
- `public.extraction_pipeline_jobs` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:3`
- `public.batch_runs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:3`
- `public.batch_run_jobs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:20`
- `public.stage_resources` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:2`
- `public.stage_playbooks` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:2`
- `public.playbook_feedback` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:2`
- `public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:3`
- `public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:3`
- `public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:2`
- `public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:2`
- `public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:37`
- `public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:3`
- `public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:32`
- `public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:2`
- `public.extraction_batches` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:1`
- `public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:3`
- `public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:1`
- `public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:3`
- `public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:30`
- `public.learning_courses` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:7`
- `public.learning_modules` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:26`
- `public.learning_lessons` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:45`
- `public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:75`
- `public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:107`
- `public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:7`
- `public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:43`
- `public.block_snapshots` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:86`
- `public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:1`
- `public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:3`
- `public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:7`
- `public.strategy_messages` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:31`
- `public.strategy_thread_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:46`
- `public.account_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:60`
- `public.opportunity_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:78`
- `public.territory_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:96`
- `public.strategy_rollups` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:113`
- `public.strategy_outputs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:128`
- `public.strategy_uploaded_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:149`
- `public.strategy_workflow_runs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:166`
- `public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:2`
- `public.strategy_artifact_feedback` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:21`
- `public.smoke_test_results` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:2`
- `public.command_shortcuts` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:3`
- `public.command_feedback` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:32`
- `public.task_templates` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:3`
- `public.task_runs` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:33`
- `public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:4`
- `public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:16`
- `public.strategy_stress_runs` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:2`
- `public.strategy_stress_turns` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:29`
- `public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:11`
- `public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:25`
- `public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:66`
- `public.canary_reviews` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:1`
- `public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:2`
- `public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:2`
- `public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:3`
- `public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:8`
- `public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:1`
- `public.course_imports` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:2`
- `public.course_lessons` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:31`
- `public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:44`
- `public.user_settings` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:1`
- `public.user_lesson_progress` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:7`
- `public.skill_benchmarks` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:1`
- `public.territory_profile` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:1`
- `public.call_logs` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:1`
- `public.account_signals` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:1`
- `public.branch_footprint` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:1`
- `public.strategy_custom_pills` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:2`
- `public.account_project_settings` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:2`
- `public.flashcard_decks` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:2`
- `public.flashcards` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:20`
- `public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:40`
- `public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:2`
- `public.integration_runs` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:3`
- `public.products` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:3`
- `public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:24`
- `public.nav_events` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:2`
- `public._agent_staging` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:1`
- `public.function_configs` — `supabase/migrations/20260709184115_78ccebfc-3280-4533-bb7a-a8cb2a7b88c6.sql:1`
- `public.agent_cron_map` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:3`
- `cron_receipt_private.cron_attempt_receipts` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:14`

## Views

- `public.active_accounts` — `supabase/migrations/20260407212117_965fa332-b761-4612-8e4d-e578ea450b72.sql:2`
- `public.resource_truth_drift` — `supabase/migrations/20260515180307_1583e40b-062a-4e7d-98f0-0adca2c256a8.sql:3`
- `public.dimension_scores` — `supabase/migrations/20260618203132_a907bc8e-7fe7-49f7-87fe-e1708d21bfab.sql:1`
- `public.branch_readiness` — `supabase/migrations/20260618210020_46c652c9-a0e4-4c94-9ba0-6ac81c66ccc8.sql:2`
- `public.ki_mastery_weekly` — `supabase/migrations/20260619013605_19b9e666-b9ee-4b92-b812-816bd60b3fcc.sql:1`
- `public.training_field_efficacy` — `supabase/migrations/20260702203829_34e5ef77-335c-4286-ae54-ae96a2e6f1da.sql:4`

## Materialized views

None explicitly declared in tracked migrations.

## Indexes

- `idx_daily_journal_entries_user_date ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:105`
- `idx_accounts_user_id ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:171`
- `idx_accounts_salesforce_id ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:172`
- `idx_accounts_name ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:173`
- `idx_contacts_user_id ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:174`
- `idx_contacts_account_id ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:175`
- `idx_opportunities_user_id ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:176`
- `idx_opportunities_account_id ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:177`
- `idx_renewals_user_id ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:178`
- `idx_renewals_account_id ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:179`
- `idx_sales_age_snapshots_user_date ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:67`
- `idx_digest_items_user_date ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:28`
- `idx_digest_items_account ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:29`
- `idx_call_transcripts_content_search ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:40`
- `idx_call_transcripts_user_id ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:43`
- `idx_call_transcripts_account_id ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:44`
- `idx_call_transcripts_opportunity_id ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:45`
- `idx_call_transcripts_call_date ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:46`
- `UNIQUE pipeline_hygiene_scans_user_date_idx ON public.pipeline_hygiene_scans` — `supabase/migrations/20260314171710_6625322a-a4b8-4a3a-a7d0-4b0de0d17971.sql:1`
- `UNIQUE weekly_battle_plans_user_week_idx ON public.weekly_battle_plans` — `supabase/migrations/20260314172322_8d43c238-e7e3-4e0f-b654-7d2da04091ce.sql:1`
- `idx_error_logs_user_id ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:19`
- `idx_error_logs_created_at ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:20`
- `idx_error_logs_category ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:21`
- `idx_intelligence_units_user ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:31`
- `idx_intelligence_units_resource ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:32`
- `idx_intelligence_units_maturity ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:33`
- `idx_intelligence_units_type ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:34`
- `idx_knowledge_signals_user ON public.knowledge_signals` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:56`
- `idx_knowledge_signals_theme ON public.knowledge_signals` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:57`
- `idx_strategy_outcomes_user ON public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:26`
- `idx_strategy_outcomes_insight ON public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:27`
- `idx_strategy_outcomes_event ON public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:28`
- `idx_resources_enrichment_status ON public.resources` — `supabase/migrations/20260325144003_85b01010-5a5b-45b2-8996-c9e3d3d163b5.sql:37`
- `idx_playbook_usage_user_date ON public.playbook_usage_events` — `supabase/migrations/20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql:29`
- `idx_audio_jobs_resource ON public.audio_jobs` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:38`
- `idx_audio_jobs_user_stage ON public.audio_jobs` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:39`
- `idx_resources_recovery_status ON public.resources` — `supabase/migrations/20260328221253_be397010-3abf-4153-bd3c-17b6bda5bd3b.sql:16`
- `idx_resources_recovery_queue_bucket ON public.resources` — `supabase/migrations/20260328221253_be397010-3abf-4153-bd3c-17b6bda5bd3b.sql:17`
- `idx_enrichment_attempts_resource ON public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:26`
- `idx_enrichment_attempts_user ON public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:27`
- `idx_knowledge_items_user ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:35`
- `idx_knowledge_items_chapter ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:36`
- `idx_knowledge_items_status ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:37`
- `idx_knowledge_items_active ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:38`
- `idx_knowledge_items_source ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:39`
- `idx_knowledge_usage_item ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:30`
- `idx_knowledge_usage_event ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:31`
- `idx_knowledge_usage_user ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:32`
- `idx_execution_templates_user_output ON public.execution_templates` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:77`
- `idx_execution_templates_status ON public.execution_templates` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:78`
- `idx_execution_outputs_user ON public.execution_outputs` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:79`
- `idx_execution_outputs_type ON public.execution_outputs` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:80`
- `UNIQUE idx_pipeline_diagnoses_resource_run ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:35`
- `idx_pipeline_diagnoses_user_state ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:36`
- `idx_pipeline_diagnoses_run ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:37`
- `idx_pipeline_diagnoses_resolution ON public.pipeline_diagnoses` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:54`
- `idx_pipeline_runs_user_status ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:55`
- `idx_asset_provenance_resource ON public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:40`
- `idx_asset_provenance_asset ON public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:41`
- `idx_cluster_resolutions_canonical ON public.cluster_resolutions` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:42`
- `idx_resources_pipeline_queue ON public.resources` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:49`
- `idx_resources_extraction_priority ON public.resources` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:50`
- `idx_extraction_pipeline_jobs_user_status ON public.extraction_pipeline_jobs` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:51`
- `idx_batch_run_jobs_batch ON public.batch_run_jobs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:49`
- `idx_batch_run_jobs_resource ON public.batch_run_jobs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:50`
- `idx_batch_runs_user ON public.batch_runs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:51`
- `idx_stage_resources_user_stage ON public.stage_resources` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:22`
- `idx_stage_resources_resource ON public.stage_resources` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:23`
- `idx_stage_playbooks_user_stage ON public.stage_playbooks` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:25`
- `idx_playbook_feedback_user_stage ON public.playbook_feedback` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:26`
- `idx_piq_status ON public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:33`
- `idx_piq_user_status ON public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:34`
- `idx_course_lesson_imports_resource_id ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:47`
- `idx_course_lesson_imports_user_status ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:48`
- `idx_knowledge_items_review_status ON public.knowledge_items` — `supabase/migrations/20260402143510_80e1093e-aa03-4d76-9ca6-ab89c57935eb.sql:7`
- `idx_resources_re_extract_status ON public.resources` — `supabase/migrations/20260402153554_7ceb8a9f-9922-4aee-bdc3-b3e60d6af3e4.sql:5`
- `idx_resources_active_job ON public.resources` — `supabase/migrations/20260403035620_b1be7ea2-4935-4a03-9864-ed87295d58e5.sql:12`
- `idx_podcast_import_queue_batch_id ON public.podcast_import_queue` — `supabase/migrations/20260403130218_cb68e44c-c55e-471b-8109-4f58e17d95e8.sql:7`
- `idx_podcast_import_queue_pipeline_stage ON public.podcast_import_queue` — `supabase/migrations/20260403130218_cb68e44c-c55e-471b-8109-4f58e17d95e8.sql:8`
- `UNIQUE idx_extraction_attempts_resource_attempt ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:23`
- `idx_extraction_attempts_resource_id ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:27`
- `idx_extraction_attempts_status ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:29`
- `idx_extraction_attempts_failure_type ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:31`
- `idx_extraction_attempts_completed_at ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:33`
- `idx_recon_items_run_id ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:54`
- `idx_recon_items_bucket ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:55`
- `idx_recon_items_resource_id ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:56`
- `idx_extraction_runs_resource ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:45`
- `idx_extraction_runs_user ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:46`
- `UNIQUE idx_knowledge_items_fingerprint_unique ON public.knowledge_items` — `supabase/migrations/20260405194229_485aeee9-955c-491c-9a43-9aeaae35ed3d.sql:34`
- `idx_knowledge_items_extraction_method ON public.knowledge_items` — `supabase/migrations/20260405203433_74621966-a8de-454a-af89-c9db0e9d5427.sql:11`
- `idx_extraction_batches_resource ON public.extraction_batches` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:35`
- `idx_background_jobs_user_status ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:45`
- `idx_background_jobs_entity ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:46`
- `idx_dojo_sessions_user_id ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:53`
- `idx_dojo_sessions_status ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:54`
- `idx_dojo_session_turns_session ON public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:55`
- `idx_learning_modules_course_id ON public.learning_modules` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:42`
- `idx_learning_lessons_module_id ON public.learning_lessons` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:72`
- `idx_learning_progress_user_id ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:103`
- `idx_learning_progress_lesson_id ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:104`
- `idx_learning_quiz_answers_user_id ON public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:132`
- `idx_learning_quiz_answers_lesson_id ON public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:133`
- `idx_daily_assignments_user_date ON public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:116`
- `idx_training_blocks_user_active ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:117`
- `idx_block_snapshots_block ON public.block_snapshots` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:118`
- `idx_dojo_sessions_assignment ON public.dojo_sessions` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:119`
- `idx_closed_loop_sessions_user_status ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:39`
- `idx_closed_loop_sessions_user_skill ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:40`
- `idx_strategy_threads_user ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:26`
- `idx_strategy_threads_account ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:27`
- `idx_strategy_threads_opp ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:28`
- `idx_strategy_messages_thread ON public.strategy_messages` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:43`
- `idx_acct_strat_mem_account ON public.account_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:75`
- `idx_opp_strat_mem_opp ON public.opportunity_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:93`
- `idx_strategy_rollups_object ON public.strategy_rollups` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:125`
- `idx_strategy_outputs_thread ON public.strategy_outputs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:146`
- `idx_strategy_artifacts_user_id ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:42`
- `idx_strategy_artifacts_thread_id ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:43`
- `idx_strategy_artifacts_source_output_id ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:44`
- `idx_artifact_feedback_artifact ON public.strategy_artifact_feedback` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:38`
- `idx_memory_last_used_account ON public.account_strategy_memory` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:39`
- `idx_memory_last_used_opportunity ON public.opportunity_strategy_memory` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:40`
- `idx_memory_last_used_territory ON public.territory_strategy_memory` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:41`
- `idx_smoke_test_results_user_created ON public.smoke_test_results` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:29`
- `idx_task_runs_user_status ON public.task_runs` — `supabase/migrations/20260417104251_3b0928df-bf21-440f-bdf7-409817e98dd3.sql:6`
- `idx_task_runs_id_user ON public.task_runs` — `supabase/migrations/20260417104251_3b0928df-bf21-440f-bdf7-409817e98dd3.sql:9`
- `UNIQUE strategy_promotion_proposals_dedupe_uq ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:65`
- `strategy_promotion_proposals_user_status_idx ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:69`
- `strategy_promotion_proposals_thread_idx ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:72`
- `strategy_promotion_proposals_account_idx ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:75`
- `strategy_promotion_proposals_opp_idx ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:78`
- `idx_contacts_source_proposal ON public.contacts` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:13`
- `UNIQUE uq_contacts_email_per_user ON public.contacts` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:14`
- `idx_call_transcripts_source_proposal ON public.call_transcripts` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:25`
- `idx_resources_source_proposal ON public.resources` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:37`
- `idx_resources_source_artifact ON public.resources` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:38`
- `idx_strategy_proposals_class ON public.strategy_promotion_proposals` — `supabase/migrations/20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql:56`
- `idx_account_contacts_source_proposal ON public.account_contacts` — `supabase/migrations/20260418211313_43305570-fd47-43fb-a47b-6d726d710446.sql:9`
- `idx_account_contacts_source_thread ON public.account_contacts` — `supabase/migrations/20260418211313_43305570-fd47-43fb-a47b-6d726d710446.sql:12`
- `strategy_thread_conflicts_thread_idx ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:35`
- `strategy_thread_conflicts_user_idx ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:37`
- `idx_resources_quarantined_at ON public.resources` — `supabase/migrations/20260419002409_da4e7e06-a550-4a2e-944b-5a5cb43944c8.sql:5`
- `idx_stress_runs_user_started ON public.strategy_stress_runs` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:25`
- `idx_stress_turns_run ON public.strategy_stress_turns` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:69`
- `idx_stress_turns_user ON public.strategy_stress_turns` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:70`
- `idx_sbr_replayed_from ON public.strategy_benchmark_runs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:8`
- `idx_sbal_run_id ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:27`
- `idx_sbal_created_at ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:28`
- `idx_sbal_run_ask ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:29`
- `idx_ki_role ON public.knowledge_items` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:17`
- `idx_pb_role ON public.playbooks` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:21`
- `idx_cards_user_role ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:56`
- `idx_cards_contexts ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:59`
- `idx_cards_source_ids ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:62`
- `idx_routing_user_time ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:90`
- `canary_reviews_user_created_idx ON public.canary_reviews` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:24`
- `UNIQUE task_runs_one_active_per_thread_task ON public.task_runs` — `supabase/migrations/20260422123454_5926f74a-551a-43a4-a76e-55fe45dc97ca.sql:1`
- `idx_lifecycle_audit_user_created ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:21`
- `idx_lifecycle_audit_resource ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:22`
- `idx_lifecycle_audit_violation ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:23`
- `idx_task_run_sections_run ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:38`
- `idx_task_run_sections_status ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:39`
- `task_run_sections_model_used_idx ON public.task_run_sections` — `supabase/migrations/20260423184558_cbbc3870-5867-4cbd-915a-1455ae33c282.sql:2`
- `idx_strategy_messages_manifest_id ON public.strategy_messages` — `supabase/migrations/20260505223434_138829e6-b7ce-4303-a6e0-7baa369f86c9.sql:6`
- `idx_strategy_outputs_manifest_id ON public.strategy_outputs` — `supabase/migrations/20260505223434_138829e6-b7ce-4303-a6e0-7baa369f86c9.sql:14`
- `idx_srt_run ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:24`
- `idx_srt_task_type ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:25`
- `idx_srt_stage ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:26`
- `idx_srt_created ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:27`
- `idx_srt_user_task ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:28`
- `idx_srt_provider ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:29`
- `idx_synthesis_cache_lookup ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:23`
- `idx_synthesis_cache_expires ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:24`
- `course_lessons_course_idx ON public.course_lessons` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:54`
- `ki_mastery_user_dimension ON public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:69`
- `ki_mastery_decay ON public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:70`
- `call_logs_user_account_idx ON public.call_logs` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:32`
- `account_signals_user_idx ON public.account_signals` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:19`
- `account_signals_account_idx ON public.account_signals` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:20`
- `knowledge_items_intelligence_type_idx ON public.knowledge_items` — `supabase/migrations/20260623200100_c55c2dc0-b42e-4bc0-96a4-aa46c37c5a57.sql:13`
- `idx_custom_pills_user_surface ON public.strategy_custom_pills` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:32`
- `idx_aps_user_family ON public.account_project_settings` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:26`
- `idx_accounts_family_user ON public.accounts` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:29`
- `flashcards_deck_idx ON public.flashcards` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:33`
- `flashcard_state_due_idx ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:49`
- `task_runs_pending_updated_at_id_idx ON public.task_runs` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:101`
- `idx_integration_runs_user_source_ran ON public.integration_runs` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:19`
- `idx_strategy_messages_linked_account ON public.strategy_messages` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:31`
- `idx_strategy_messages_linked_opp ON public.strategy_messages` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:33`
- `apo_account_idx ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:44`
- `apo_product_idx ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:45`
- `apo_user_idx ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:46`
- `nav_events_user_at_idx ON public.nav_events` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:17`
- `idx_opportunities_archived_at ON public.opportunities` — `supabase/migrations/20260708200707_a0266e87-16b8-4311-914d-bd2a2640d2dc.sql:5`
- `idx_call_transcripts_archived_at ON public.call_transcripts` — `supabase/migrations/20260708200707_a0266e87-16b8-4311-914d-bd2a2640d2dc.sql:6`

## Functions

- `public.update_updated_at_column(); default invoker; no explicit search_path` — `supabase/migrations/20260206213330_982a1ea2-7260-431d-9903-74d12714e6d9.sql:2`
- `public.is_approved_user(_user_id uuid); DEFINER; search_path=public` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:33`
- `public.claim_podcast_queue_items(p_max_items INT DEFAULT 3, p_max_processing INT DEFAULT 3); DEFINER; search_path=public` — `supabase/migrations/20260403131709_31756bfa-c098-48f0-a394-2b8b7cf8ce52.sql:2`
- `public.claim_podcast_queue_items(p_max_items integer DEFAULT 3, p_max_processing integer DEFAULT 3); DEFINER; no explicit search_path` — `supabase/migrations/20260410203637_d90ed380-ec79-432f-beca-4ecb49a90abb.sql:10`
- `public.claim_podcast_queue_items(p_max_items integer DEFAULT 3, p_max_processing integer DEFAULT 3); DEFINER; no explicit search_path` — `supabase/migrations/20260410203919_0dcd8379-a009-4e51-8194-28b2f4a86461.sql:1`
- `public.get_resource_content_prefixes(p_user_id uuid); DEFINER; search_path=public` — `supabase/migrations/20260413150219_e94d5516-d89e-4d77-800a-58508b8ea650.sql:1`
- `public.compute_thread_trust_state(p_thread_id UUID); DEFINER; search_path=public` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:66`
- `public.get_resource_lifecycle_summary(p_user_id uuid); DEFINER; search_path=public` — `supabase/migrations/20260421171359_00445f9f-32fd-4b4c-a527-a675aeb86ada.sql:4`
- `public.get_resource_lifecycle_summary(p_user_id uuid); DEFINER; no explicit search_path` — `supabase/migrations/20260515193348_af253f6b-68a9-4206-91be-751f6c18d890.sql:2`
- `public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_exclude_ki_id uuid DEFAULT NULL); DEFINER; search_path=public` — `supabase/migrations/20260617201120_d54f87ad-9446-4605-ba7c-d6006f3781c1.sql:1`
- `public.signal_dimension_weakness(p_user_id uuid, p_spider_dimension text, p_signal_score numeric); DEFINER; search_path=public` — `supabase/migrations/20260618203341_862ff68a-fdfc-4184-a963-0b585a193385.sql:1`
- `public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_limit integer DEFAULT 1); DEFINER; search_path=public` — `supabase/migrations/20260619014224_116c05ae-d558-457f-9163-4ea824cf2361.sql:4`
- `public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_limit integer DEFAULT 1); DEFINER; no explicit search_path` — `supabase/migrations/20260619111649_a1883a9a-521b-4a69-b492-b3740979a78f.sql:3`
- `public.signal_dimension_weakness(p_user_id uuid, p_spider_dimension text, p_signal_score numeric); DEFINER; no explicit search_path` — `supabase/migrations/20260619111906_dc0a68ab-41e0-401f-a661-e96763085aff.sql:1`
- `public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_limit integer DEFAULT 1); DEFINER; search_path=public` — `supabase/migrations/20260619115649_9b20be45-2309-4a96-89e3-804eaf82f95b.sql:1`
- `public.get_next_ki_for_dimension(p_user_id uuid, p_spider_dimension text, p_limit integer DEFAULT 1); DEFINER; search_path=public` — `supabase/migrations/20260619115818_9ccab14b-de04-4f9d-8088-f95436bc5a74.sql:3`
- `public.calib_drills_export(); DEFINER; search_path=public` — `supabase/migrations/20260702215327_df2b95eb-a09b-4128-98c1-cd721c7dda9e.sql:1`
- `public.execute_strategy_task_reaper_attempt(uuid, integer, text, text, text); DEFINER; empty search_path` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:105`
- `public.read_strategy_task_reaper_receipt(uuid, integer, text, text, text); DEFINER; empty search_path` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:364`

## Triggers

- `update_work_schedule_config_updated_at ON public.work_schedule_config` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:85`
- `update_streak_events_updated_at ON public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:90`
- `update_streak_summary_updated_at ON public.streak_summary` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:95`
- `update_daily_journal_entries_updated_at ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:92`
- `update_accounts_updated_at ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:165`
- `update_contacts_updated_at ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:166`
- `update_opportunities_updated_at ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:167`
- `update_renewals_updated_at ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:168`
- `update_sales_age_snapshots_updated_at ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:125`
- `update_quota_targets_updated_at ON public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:130`
- `update_import_header_mappings_updated_at ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:94`
- `update_import_value_mappings_updated_at ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:99`
- `update_call_transcripts_updated_at ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:36`
- `set_tasks_updated_at ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:36`
- `update_daily_plan_preferences_updated_at ON public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:31`
- `update_resource_folders_updated_at ON public.resource_folders` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:59`
- `update_resources_updated_at ON public.resources` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:60`
- `update_weekly_research_queue_updated_at ON public.weekly_research_queue` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:43`
- `update_pipeline_diagnoses_updated_at ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:39`
- `update_pipeline_runs_updated_at ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:37`
- `update_podcast_import_queue_updated_at ON public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:37`
- `update_course_lesson_imports_updated_at ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:51`
- `update_resource_collections_updated_at ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:32`
- `update_library_reconciliation_runs_updated_at ON public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:27`
- `update_library_reconciliation_items_updated_at ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:58`
- `update_background_jobs_updated_at ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:49`
- `update_lesson_assets_updated_at ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:39`
- `update_dojo_sessions_updated_at ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:58`
- `update_training_blocks_updated_at ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:38`
- `update_skill_builder_sessions_updated_at ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:37`
- `update_closed_loop_sessions_updated_at ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:43`
- `update_strategy_threads_updated_at ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:187`
- `update_account_strategy_memory_updated_at ON public.account_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:188`
- `update_opportunity_strategy_memory_updated_at ON public.opportunity_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:189`
- `update_territory_strategy_memory_updated_at ON public.territory_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:190`
- `update_strategy_outputs_updated_at ON public.strategy_outputs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:191`
- `update_strategy_workflow_runs_updated_at ON public.strategy_workflow_runs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:192`
- `update_strategy_artifacts_updated_at ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:37`
- `update_command_shortcuts_updated_at ON public.command_shortcuts` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:54`
- `set_strategy_promotion_proposals_updated_at ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:107`
- `strategy_thread_conflicts_updated_at ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:60`
- `trg_task_run_sections_updated_at ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:41`
- `update_synthesis_cache_updated_at ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:50`
- `update_circle_credentials_updated_at ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:30`
- `course_imports_updated_at ON public.course_imports` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:27`
- `course_lessons_updated_at ON public.course_lessons` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:64`
- `update_ki_mastery_updated_at ON public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:72`
- `update_user_settings_updated_at ON public.user_settings` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:17`
- `update_user_lesson_progress_updated_at ON public.user_lesson_progress` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:33`
- `update_territory_profile_updated_at ON public.territory_profile` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:34`
- `update_call_logs_updated_at ON public.call_logs` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:28`
- `update_branch_footprint_updated_at ON public.branch_footprint` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:48`
- `strategy_custom_pills_updated_at ON public.strategy_custom_pills` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:35`
- `trg_aps_updated_at ON public.account_project_settings` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:33`
- `user_train_prefs_updated_at ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:27`
- `products_updated_at ON public.products` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:20`
- `apo_updated_at ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:41`

## Extensions

- `pg_cron WITH SCHEMA pg_catalog` — `supabase/migrations/20260205170426_8a014c2f-1eda-40d4-abab-f3fb49b8c5fc.sql:2`
- `pg_net WITH SCHEMA extensions` — `supabase/migrations/20260205170426_8a014c2f-1eda-40d4-abab-f3fb49b8c5fc.sql:3`
- `pg_cron WITH SCHEMA pg_catalog` — `supabase/migrations/20260311053345_0e6b6807-73e1-47a1-8764-b9646aa1d938.sql:2`
- `pg_net WITH SCHEMA extensions` — `supabase/migrations/20260311053345_0e6b6807-73e1-47a1-8764-b9646aa1d938.sql:3`
- `pg_cron WITH SCHEMA pg_catalog` — `supabase/migrations/20260317225106_ec53f795-9ce9-4e89-814a-460fa8b29eb4.sql:1`
- `pg_net WITH SCHEMA extensions` — `supabase/migrations/20260317225106_ec53f795-9ce9-4e89-814a-460fa8b29eb4.sql:2`
- `pg_cron WITH SCHEMA pg_catalog` — `supabase/migrations/20260323110853_07cd44b1-2c4a-40a3-be46-b714a2d35ebc.sql:1`
- `pg_net WITH SCHEMA extensions` — `supabase/migrations/20260323110853_07cd44b1-2c4a-40a3-be46-b714a2d35ebc.sql:2`

## RLS state statements

- `ENABLE RLS ON cron_receipt_private.cron_attempt_receipts` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:94`
- `ENABLE RLS ON public.work_schedule_config` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:101`
- `ENABLE RLS ON public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:102`
- `ENABLE RLS ON public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:103`
- `ENABLE RLS ON public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:104`
- `ENABLE RLS ON public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:105`
- `ENABLE RLS ON public.badges_earned` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:106`
- `ENABLE RLS ON public.streak_summary` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:107`
- `ENABLE RLS ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:68`
- `ENABLE RLS ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:128`
- `ENABLE RLS ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:129`
- `ENABLE RLS ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:130`
- `ENABLE RLS ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:131`
- `ENABLE RLS ON public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:132`
- `ENABLE RLS ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:48`
- `ENABLE RLS ON public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:106`
- `ENABLE RLS ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:38`
- `ENABLE RLS ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:39`
- `ENABLE RLS ON public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:40`
- `ENABLE RLS ON public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:20`
- `ENABLE RLS ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:21`
- `ENABLE RLS ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:35`
- `ENABLE RLS ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:36`
- `ENABLE RLS ON public.weekly_reviews` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:36`
- `ENABLE RLS ON public.dismissed_action_items` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:53`
- `ENABLE RLS ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:22`
- `ENABLE RLS ON public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:16`
- `ENABLE RLS ON public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:19`
- `ENABLE RLS ON public.ai_feedback` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:38`
- `ENABLE RLS ON public.conversion_benchmarks` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:21`
- `ENABLE RLS ON public.pipeline_hygiene_scans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:45`
- `ENABLE RLS ON public.weekly_battle_plans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:70`
- `ENABLE RLS ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:27`
- `ENABLE RLS ON public.icp_sourced_accounts` — `supabase/migrations/20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql:33`
- `ENABLE RLS ON public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:20`
- `ENABLE RLS ON public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:25`
- `ENABLE RLS ON public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:24`
- `ENABLE RLS ON public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:40`
- `ENABLE RLS ON public.resource_folders` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:49`
- `ENABLE RLS ON public.resources` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:50`
- `ENABLE RLS ON public.resource_versions` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:51`
- `ENABLE RLS ON public.template_suggestions` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:15`
- `ENABLE RLS ON public.voice_reminders` — `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:10`
- `ENABLE RLS ON public.dave_transcripts` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:9`
- `ENABLE RLS ON public.resource_digests` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:16`
- `ENABLE RLS ON public.custom_prompts` — `supabase/migrations/20260320221358_e78ea58a-5cd7-4a4f-beea-07c2d9b3c505.sql:12`
- `ENABLE RLS ON public.deal_patterns` — `supabase/migrations/20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql:10`
- `ENABLE RLS ON public.coaching_plans` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:11`
- `ENABLE RLS ON public.resource_usage_events` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:22`
- `ENABLE RLS ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:23`
- `ENABLE RLS ON public.resource_jobs` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:20`
- `ENABLE RLS ON public.resource_job_steps` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:45`
- `ENABLE RLS ON public.resource_chunks` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:72`
- `ENABLE RLS ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:24`
- `ENABLE RLS ON public.knowledge_signals` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:49`
- `ENABLE RLS ON public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:19`
- `ENABLE RLS ON public.weekly_research_queue` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:13`
- `ENABLE RLS ON public.research_queue_events` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:34`
- `ENABLE RLS ON public.playbooks` — `supabase/migrations/20260326091059_d43a38b2-ffe9-4a22-bb09-63413aa6c7bf.sql:22`
- `ENABLE RLS ON public.playbook_usage_events` — `supabase/migrations/20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql:20`
- `ENABLE RLS ON public.source_registry` — `supabase/migrations/20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql:21`
- `ENABLE RLS ON public.audio_jobs` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:30`
- `ENABLE RLS ON public.verification_runs` — `supabase/migrations/20260328034915_8e6d0931-bdcf-42c4-bc9e-46d177043a02.sql:21`
- `ENABLE RLS ON public.approved_users` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:16`
- `ENABLE RLS ON public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:29`
- `ENABLE RLS ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:28`
- `ENABLE RLS ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:18`
- `ENABLE RLS ON public.execution_templates` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:35`
- `ENABLE RLS ON public.execution_outputs` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:68`
- `ENABLE RLS ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:21`
- `ENABLE RLS ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:23`
- `ENABLE RLS ON public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:19`
- `ENABLE RLS ON public.cluster_resolutions` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:36`
- `ENABLE RLS ON public.extraction_pipeline_jobs` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:25`
- `ENABLE RLS ON public.batch_runs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:35`
- `ENABLE RLS ON public.batch_run_jobs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:36`
- `ENABLE RLS ON public.stage_resources` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:13`
- `ENABLE RLS ON public.stage_playbooks` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:16`
- `ENABLE RLS ON public.playbook_feedback` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:16`
- `ENABLE RLS ON public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:23`
- `ENABLE RLS ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:27`
- `ENABLE RLS ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:37`
- `ENABLE RLS ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:14`
- `ENABLE RLS ON public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:47`
- `ENABLE RLS ON public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:21`
- `ENABLE RLS ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:48`
- `ENABLE RLS ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:31`
- `ENABLE RLS ON public.extraction_batches` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:25`
- `ENABLE RLS ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:25`
- `ENABLE RLS ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:21`
- `ENABLE RLS ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:23`
- `ENABLE RLS ON public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:46`
- `ENABLE RLS ON public.learning_courses` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:18`
- `ENABLE RLS ON public.learning_modules` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:35`
- `ENABLE RLS ON public.learning_lessons` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:65`
- `ENABLE RLS ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:86`
- `ENABLE RLS ON public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:120`
- `ENABLE RLS ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:24`
- `ENABLE RLS ON public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:71`
- `ENABLE RLS ON public.block_snapshots` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:99`
- `ENABLE RLS ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:19`
- `ENABLE RLS ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:23`
- `ENABLE RLS ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:24`
- `ENABLE RLS ON public.strategy_messages` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:41`
- `ENABLE RLS ON public.strategy_thread_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:56`
- `ENABLE RLS ON public.account_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:73`
- `ENABLE RLS ON public.opportunity_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:91`
- `ENABLE RLS ON public.territory_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:109`
- `ENABLE RLS ON public.strategy_rollups` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:123`
- `ENABLE RLS ON public.strategy_outputs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:144`
- `ENABLE RLS ON public.strategy_uploaded_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:162`
- `ENABLE RLS ON public.strategy_workflow_runs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:178`
- `ENABLE RLS ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:19`
- `ENABLE RLS ON public.strategy_artifact_feedback` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:30`
- `ENABLE RLS ON public.smoke_test_results` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:17`
- `ENABLE RLS ON public.command_shortcuts` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:22`
- `ENABLE RLS ON public.command_feedback` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:44`
- `ENABLE RLS ON public.task_templates` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:15`
- `ENABLE RLS ON public.task_runs` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:49`
- `ENABLE RLS ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:82`
- `ENABLE RLS ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:40`
- `ENABLE RLS ON public.strategy_stress_runs` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:17`
- `ENABLE RLS ON public.strategy_stress_turns` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:61`
- `ENABLE RLS ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:31`
- `ENABLE RLS ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:43`
- `ENABLE RLS ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:78`
- `ENABLE RLS ON public.canary_reviews` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:14`
- `ENABLE RLS ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:25`
- `ENABLE RLS ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:21`
- `ENABLE RLS ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:32`
- `ENABLE RLS ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:27`
- `ENABLE RLS ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:12`
- `ENABLE RLS ON public.course_imports` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:20`
- `ENABLE RLS ON public.course_lessons` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:57`
- `ENABLE RLS ON public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:67`
- `ENABLE RLS ON public.user_settings` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:12`
- `ENABLE RLS ON public.user_lesson_progress` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:25`
- `ENABLE RLS ON public.skill_benchmarks` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:12`
- `ENABLE RLS ON public.territory_profile` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:29`
- `ENABLE RLS ON public.call_logs` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:23`
- `ENABLE RLS ON public.account_signals` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:16`
- `ENABLE RLS ON public.branch_footprint` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:43`
- `ENABLE RLS ON public.strategy_custom_pills` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:24`
- `ENABLE RLS ON public.account_project_settings` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:17`
- `ENABLE RLS ON public.flashcard_decks` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:16`
- `ENABLE RLS ON public.flashcards` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:36`
- `ENABLE RLS ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:52`
- `ENABLE RLS ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:11`
- `ENABLE RLS ON public.integration_runs` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:14`
- `ENABLE RLS ON public.products` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:16`
- `ENABLE RLS ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:37`
- `ENABLE RLS ON public.nav_events` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:12`
- `DISABLE RLS ON public._agent_staging` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:13`
- `ENABLE RLS ON public.circle_credentials` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:17`
- `ENABLE RLS ON public.function_configs` — `supabase/migrations/20260709184115_78ccebfc-3280-4533-bb7a-a8cb2a7b88c6.sql:8`
- `ENABLE RLS ON public.agent_cron_map` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:12`

## Policies

- `"Anyone can view work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:110`
- `"Anyone can update work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:111`
- `"Anyone can view holidays" ON public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:113`
- `"Anyone can insert holidays" ON public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:114`
- `"Anyone can update holidays" ON public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:115`
- `"Anyone can delete holidays" ON public.holidays` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:116`
- `"Anyone can view pto_days" ON public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:118`
- `"Anyone can insert pto_days" ON public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:119`
- `"Anyone can update pto_days" ON public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:120`
- `"Anyone can delete pto_days" ON public.pto_days` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:121`
- `"Anyone can view workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:123`
- `"Anyone can insert workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:124`
- `"Anyone can update workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:125`
- `"Anyone can delete workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:126`
- `"Anyone can view streak_events" ON public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:128`
- `"Anyone can insert streak_events" ON public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:129`
- `"Anyone can update streak_events" ON public.streak_events` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:130`
- `"Anyone can view badges_earned" ON public.badges_earned` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:132`
- `"Anyone can insert badges_earned" ON public.badges_earned` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:133`
- `"Anyone can view streak_summary" ON public.streak_summary` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:135`
- `"Anyone can update streak_summary" ON public.streak_summary` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:136`
- `"Users can view own badges" ON public.badges_earned` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:75`
- `"Users can insert own badges" ON public.badges_earned` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:80`
- `"Users can view own calendar events" ON public.calendar_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:86`
- `"Users can view own holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:92`
- `"Users can insert own holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:97`
- `"Users can update own holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:102`
- `"Users can delete own holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:107`
- `"Users can view own pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:113`
- `"Users can insert own pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:118`
- `"Users can update own pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:123`
- `"Users can delete own pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:128`
- `"Users can view own streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:134`
- `"Users can insert own streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:139`
- `"Users can update own streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:144`
- `"Users can view own streak_summary" ON public.streak_summary` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:150`
- `"Users can insert own streak_summary" ON public.streak_summary` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:155`
- `"Users can update own streak_summary" ON public.streak_summary` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:160`
- `"Users can view own work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:166`
- `"Users can insert own work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:171`
- `"Users can update own work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:176`
- `"Users can view own workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:182`
- `"Users can insert own workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:187`
- `"Users can update own workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:192`
- `"Users can delete own workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:197`
- `"Users can view own journal entries" ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:71`
- `"Users can insert own journal entries" ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:76`
- `"Users can update own journal entries" ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:81`
- `"Users can delete own journal entries" ON public.daily_journal_entries` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:86`
- `"Users can update own calendar events" ON public.calendar_events` — `supabase/migrations/20260206222237_6e028526-6632-4806-9af9-1ef25589c008.sql:2`
- `"Users can delete own calendar events" ON public.calendar_events` — `supabase/migrations/20260206222237_6e028526-6632-4806-9af9-1ef25589c008.sql:8`
- `"Users can insert own calendar events" ON public.calendar_events` — `supabase/migrations/20260206225833_dbe32e24-b268-4301-b9cd-920f347a2123.sql:2`
- `"Users can view own accounts" ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:135`
- `"Users can insert own accounts" ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:136`
- `"Users can update own accounts" ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:137`
- `"Users can delete own accounts" ON public.accounts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:138`
- `"Users can view own contacts" ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:141`
- `"Users can insert own contacts" ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:142`
- `"Users can update own contacts" ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:143`
- `"Users can delete own contacts" ON public.contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:144`
- `"Users can view own opportunities" ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:147`
- `"Users can insert own opportunities" ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:148`
- `"Users can update own opportunities" ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:149`
- `"Users can delete own opportunities" ON public.opportunities` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:150`
- `"Users can view own renewals" ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:153`
- `"Users can insert own renewals" ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:154`
- `"Users can update own renewals" ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:155`
- `"Users can delete own renewals" ON public.renewals` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:156`
- `"Users can view own account_contacts" ON public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:159`
- `"Users can insert own account_contacts" ON public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:160`
- `"Users can update own account_contacts" ON public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:161`
- `"Users can delete own account_contacts" ON public.account_contacts` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:162`
- `"Users can view own sales_age_snapshots" ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:51`
- `"Users can insert own sales_age_snapshots" ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:56`
- `"Users can update own sales_age_snapshots" ON public.sales_age_snapshots` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:61`
- `"Users can view own quota_targets" ON public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:109`
- `"Users can insert own quota_targets" ON public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:114`
- `"Users can update own quota_targets" ON public.quota_targets` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:119`
- `"Users can view their own header mappings" ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:43`
- `"Users can create their own header mappings" ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:47`
- `"Users can update their own header mappings" ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:51`
- `"Users can delete their own header mappings" ON public.import_header_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:55`
- `"Users can view their own value mappings" ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:60`
- `"Users can create their own value mappings" ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:64`
- `"Users can update their own value mappings" ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:68`
- `"Users can delete their own value mappings" ON public.import_value_mappings` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:72`
- `"Users can view their own account aliases" ON public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:77`
- `"Users can create their own account aliases" ON public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:81`
- `"Users can update their own account aliases" ON public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:85`
- `"Users can delete their own account aliases" ON public.import_account_aliases` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:89`
- `"Users can view own power_hour_sessions" ON public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:22`
- `"Users can insert own power_hour_sessions" ON public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:26`
- `"Users can update own power_hour_sessions" ON public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:30`
- `"Users can delete own power_hour_sessions" ON public.power_hour_sessions` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:34`
- `"Users can view own digest items" ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:23`
- `"Users can update own digest items" ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:24`
- `"Users can insert own digest items" ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:25`
- `"Users can delete own digest items" ON public.daily_digest_items` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:26`
- `"Users can upload enrichment screenshots" ON storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:5`
- `"Users can read own enrichment screenshots" ON storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:10`
- `"Users can delete own enrichment screenshots" ON storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:15`
- `"Users can view own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:39`
- `"Users can insert own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:40`
- `"Users can update own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:41`
- `"Users can delete own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:42`
- `"Users can view own whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:45`
- `"Users can insert own whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:46`
- `"Users can update own whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:47`
- `"Users can delete own whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:48`
- `"Service role can manage whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:51`
- `"Service role can manage whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:52`
- `"Users can view own weekly_reviews" ON public.weekly_reviews` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:38`
- `"Users can insert own weekly_reviews" ON public.weekly_reviews` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:39`
- `"Users can update own weekly_reviews" ON public.weekly_reviews` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:40`
- `"Users can view own dismissed items" ON public.dismissed_action_items` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:55`
- `"Users can insert own dismissed items" ON public.dismissed_action_items` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:56`
- `"Users can delete own dismissed items" ON public.dismissed_action_items` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:57`
- `"Users can view own transcripts" ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:24`
- `"Users can insert own transcripts" ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:27`
- `"Users can update own transcripts" ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:30`
- `"Users can delete own transcripts" ON public.call_transcripts` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:33`
- `"Users can view own resource_links" ON public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:18`
- `"Users can insert own resource_links" ON public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:19`
- `"Users can update own resource_links" ON public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:20`
- `"Users can delete own resource_links" ON public.resource_links` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:21`
- `"Users can view own time blocks" ON public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:21`
- `"Users can insert own time blocks" ON public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:22`
- `"Users can update own time blocks" ON public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:23`
- `"Users can delete own time blocks" ON public.daily_time_blocks` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:24`
- `"Users can view own feedback" ON public.ai_feedback` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:40`
- `"Users can insert own feedback" ON public.ai_feedback` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:41`
- `"Users can view own benchmarks" ON public.conversion_benchmarks` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:23`
- `"Users can insert own benchmarks" ON public.conversion_benchmarks` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:25`
- `"Users can update own benchmarks" ON public.conversion_benchmarks` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:27`
- `"Users can view own scans" ON public.pipeline_hygiene_scans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:47`
- `"Users can insert own scans" ON public.pipeline_hygiene_scans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:49`
- `"Users can update own scans" ON public.pipeline_hygiene_scans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:51`
- `"Users can view own battle plans" ON public.weekly_battle_plans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:72`
- `"Users can insert own battle plans" ON public.weekly_battle_plans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:74`
- `"Users can update own battle plans" ON public.weekly_battle_plans` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:76`
- `"Users can view own tasks" ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:30`
- `"Users can insert own tasks" ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:31`
- `"Users can update own tasks" ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:32`
- `"Users can delete own tasks" ON public.tasks` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:33`
- `"Users can manage own sourced accounts" ON public.icp_sourced_accounts` — `supabase/migrations/20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql:35`
- `"Users can view own preferences" ON public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:22`
- `"Users can insert own preferences" ON public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:25`
- `"Users can update own preferences" ON public.daily_plan_preferences` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:28`
- `"Users can view own transcript grades" ON public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:27`
- `"Users can insert own transcript grades" ON public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:30`
- `"Users can update own transcript grades" ON public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:33`
- `"Users can delete own transcript grades" ON public.transcript_grades` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:36`
- `"Users can view own mock sessions" ON public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:26`
- `"Users can insert own mock sessions" ON public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:27`
- `"Users can update own mock sessions" ON public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:28`
- `"Users can delete own mock sessions" ON public.mock_call_sessions` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:29`
- `"Users can view own methodology" ON public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:42`
- `"Users can insert own methodology" ON public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:43`
- `"Users can update own methodology" ON public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:44`
- `"Users can delete own methodology" ON public.opportunity_methodology` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:45`
- `"Users manage own folders" ON public.resource_folders` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:54`
- `"Users manage own resources" ON public.resources` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:55`
- `"Users manage own versions" ON public.resource_versions` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:56`
- `"Users manage own resource files" ON storage.objects` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:66`
- `"Users manage own suggestions" ON public.template_suggestions` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:16`
- `"Users own their reminders" ON public.voice_reminders` — `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:12`
- `"Users can insert own dave_transcripts" ON public.dave_transcripts` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:11`
- `"Users can view own dave_transcripts" ON public.dave_transcripts` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:15`
- `"Users can delete own dave_transcripts" ON public.dave_transcripts` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:19`
- `"Users manage own resource_digests" ON public.resource_digests` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:18`
- `"Users manage own prompts" ON public.custom_prompts` — `supabase/migrations/20260320221358_e78ea58a-5cd7-4a4f-beea-07c2d9b3c505.sql:14`
- `"Users manage own patterns" ON public.deal_patterns` — `supabase/migrations/20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql:11`
- `"Users manage own plans" ON public.coaching_plans` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:12`
- `"Users manage own events" ON public.resource_usage_events` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:23`
- `"Users can insert their own error logs" ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:25`
- `"Users can read their own error logs" ON public.error_logs` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:29`
- `"Users manage own resource_jobs" ON public.resource_jobs` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:22`
- `"Users manage own resource_job_steps" ON public.resource_job_steps` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:47`
- `"Users manage own resource_chunks" ON public.resource_chunks` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:74`
- `"Users manage own intelligence_units" ON public.intelligence_units` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:26`
- `"Users manage own knowledge_signals" ON public.knowledge_signals` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:51`
- `"Users manage own strategy_outcomes" ON public.strategy_outcomes` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:21`
- `"Users manage own research queue" ON public.weekly_research_queue` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:15`
- `"Users manage own research events" ON public.research_queue_events` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:36`
- `"Users can delete own scans" ON public.pipeline_hygiene_scans` — `supabase/migrations/20260323193351_b2fece95-d450-4009-a86c-f69d8fd664d9.sql:1`
- `"Users manage own playbooks" ON public.playbooks` — `supabase/migrations/20260326091059_d43a38b2-ffe9-4a22-bb09-63413aa6c7bf.sql:24`
- `"Users manage own playbook_usage_events" ON public.playbook_usage_events` — `supabase/migrations/20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql:22`
- `"Users manage own source_registry" ON public.source_registry` — `supabase/migrations/20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql:23`
- `"Users manage own audio_jobs" ON public.audio_jobs` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:32`
- `"Users manage own verification_runs" ON public.verification_runs` — `supabase/migrations/20260328034915_8e6d0931-bdcf-42c4-bc9e-46d177043a02.sql:23`
- `"Users can check own approval" ON public.approved_users` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:19`
- `"Users can view own enrichment attempts" ON public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:31`
- `"Users can insert own enrichment attempts" ON public.enrichment_attempts` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:36`
- `"Users manage own knowledge_items" ON public.knowledge_items` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:30`
- `"Users can insert own usage logs" ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:20`
- `"Users can view own usage logs" ON public.knowledge_usage_log` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:25`
- `"Users manage own execution_templates" ON public.execution_templates` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:37`
- `"Users manage own execution_outputs" ON public.execution_outputs` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:70`
- `"Users can view own diagnoses" ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:23`
- `"Users can insert own diagnoses" ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:26`
- `"Users can update own diagnoses" ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:29`
- `"Users can delete own diagnoses" ON public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:32`
- `"Users can read own pipeline runs" ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:25`
- `"Users can insert own pipeline runs" ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:29`
- `"Users can update own pipeline runs" ON public.pipeline_runs` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:33`
- `"Users see own provenance" ON public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:20`
- `"Users insert own provenance" ON public.asset_provenance` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:21`
- `"Users see own resolutions" ON public.cluster_resolutions` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:37`
- `"Users insert own resolutions" ON public.cluster_resolutions` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:38`
- `"Users manage own pipeline jobs" ON public.extraction_pipeline_jobs` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:28`
- `"Users can manage own batch runs" ON public.batch_runs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:38`
- `"Users can view own batch run jobs" ON public.batch_run_jobs` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:43`
- `"Users can manage their own stage resources" ON public.stage_resources` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:15`
- `"Users manage own stage playbooks" ON public.stage_playbooks` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:18`
- `"Users can insert own feedback" ON public.playbook_feedback` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:18`
- `"Users can read own feedback" ON public.playbook_feedback` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:22`
- `"Users delete own provenance" ON public.asset_provenance` — `supabase/migrations/20260401022820_060a5542-167e-47ac-b4fa-890b425e94fb.sql:2`
- `"Users can delete own enrichment attempts" ON public.enrichment_attempts` — `supabase/migrations/20260401022820_060a5542-167e-47ac-b4fa-890b425e94fb.sql:5`
- `"Users can delete own usage logs" ON public.knowledge_usage_log` — `supabase/migrations/20260401022820_060a5542-167e-47ac-b4fa-890b425e94fb.sql:8`
- `"Users manage own queue items" ON public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:25`
- `"Users can view their own course lesson imports" ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:30`
- `"Users can create their own course lesson imports" ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:34`
- `"Users can update their own course lesson imports" ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:38`
- `"Users can delete their own course lesson imports" ON public.course_lesson_imports` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:42`
- `"Users can view their own extraction attempts" ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:40`
- `"Service role can manage extraction attempts" ON public.resource_extraction_attempts` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:47`
- `"Users can view their own collections" ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:16`
- `"Users can create their own collections" ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:20`
- `"Users can update their own collections" ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:24`
- `"Users can delete their own collections" ON public.resource_collections` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:28`
- `"Users can view their own collection members" ON public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:49`
- `"Users can add to their own collections" ON public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:53`
- `"Users can update their own collection members" ON public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:57`
- `"Users can remove from their own collections" ON public.resource_collection_members` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:61`
- `"Users can view own runs" ON public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:23`
- `"Users can create own runs" ON public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:24`
- `"Users can update own runs" ON public.library_reconciliation_runs` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:25`
- `"Users can view own items" ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:50`
- `"Users can create own items" ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:51`
- `"Users can update own items" ON public.library_reconciliation_items` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:52`
- `"Users can view their own extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:33`
- `"Users can insert their own extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:37`
- `"Service role can manage extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:41`
- `"Users can update their own extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042249_22ff221d-136f-46d4-9cf4-13545bacc360.sql:3`
- `"Users can delete their own extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042249_22ff221d-136f-46d4-9cf4-13545bacc360.sql:7`
- `"Users can view their own batch records" ON public.extraction_batches` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:27`
- `"Users can insert their own batch records" ON public.extraction_batches` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:31`
- `"Users can view their own jobs" ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:28`
- `"Users can create their own jobs" ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:32`
- `"Users can update their own jobs" ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:36`
- `"Users can delete their own jobs" ON public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:40`
- `"Users can view their own lesson assets" ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:23`
- `"Users can create their own lesson assets" ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:27`
- `"Users can update their own lesson assets" ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:31`
- `"Users can delete their own lesson assets" ON public.lesson_assets` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:35`
- `"Users can view own dojo sessions" ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:25`
- `"Users can create own dojo sessions" ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:26`
- `"Users can update own dojo sessions" ON public.dojo_sessions` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:27`
- `"Users can view own dojo turns" ON public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:48`
- `"Users can create own dojo turns" ON public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:49`
- `"Users can update own dojo turns" ON public.dojo_session_turns` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:50`
- `"Authenticated users can read courses" ON public.learning_courses` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:20`
- `"Authenticated users can read modules" ON public.learning_modules` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:37`
- `"Authenticated users can read lessons" ON public.learning_lessons` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:67`
- `"Users can read own progress" ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:88`
- `"Users can insert own progress" ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:93`
- `"Users can update own progress" ON public.learning_progress` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:98`
- `"Users can read own quiz answers" ON public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:122`
- `"Users can insert own quiz answers" ON public.learning_quiz_answers` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:127`
- `"Users can view their own blocks" ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:26`
- `"Users can create their own blocks" ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:30`
- `"Users can update their own blocks" ON public.training_blocks` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:34`
- `"Users can view their own assignments" ON public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:73`
- `"Users can create their own assignments" ON public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:77`
- `"Users can update their own assignments" ON public.daily_assignments` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:81`
- `"Users can view their own snapshots" ON public.block_snapshots` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:101`
- `"Users can create their own snapshots" ON public.block_snapshots` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:105`
- `"Users can view their own skill builder sessions" ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:21`
- `"Users can create their own skill builder sessions" ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:25`
- `"Users can update their own skill builder sessions" ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:29`
- `"Users can delete their own skill builder sessions" ON public.skill_builder_sessions` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:33`
- `"Users can view their own closed loop sessions" ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:26`
- `"Users can create their own closed loop sessions" ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:30`
- `"Users can update their own closed loop sessions" ON public.closed_loop_sessions` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:34`
- `"Users manage own threads" ON public.strategy_threads` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:25`
- `"Users manage own messages" ON public.strategy_messages` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:42`
- `"Users manage own thread resources" ON public.strategy_thread_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:57`
- `"Users manage own account memory" ON public.account_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:74`
- `"Users manage own opp memory" ON public.opportunity_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:92`
- `"Users manage own territory memory" ON public.territory_strategy_memory` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:110`
- `"Users manage own rollups" ON public.strategy_rollups` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:124`
- `"Users manage own outputs" ON public.strategy_outputs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:145`
- `"Users manage own uploads" ON public.strategy_uploaded_resources` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:163`
- `"Users manage own workflow runs" ON public.strategy_workflow_runs` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:179`
- `"Users upload own strategy files" ON storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:6`
- `"Users view own strategy files" ON storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:11`
- `"Users delete own strategy files" ON storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:16`
- `"Users can view their own artifacts" ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:21`
- `"Users can create their own artifacts" ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:25`
- `"Users can update their own artifacts" ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:29`
- `"Users can delete their own artifacts" ON public.strategy_artifacts` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:33`
- `"Users manage own artifact feedback" ON public.strategy_artifact_feedback` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:32`
- `"Users can read own smoke test results" ON public.smoke_test_results` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:19`
- `"Users can insert own smoke test results" ON public.smoke_test_results` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:24`
- `"Users manage own shortcuts" ON public.command_shortcuts` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:24`
- `"Users manage own feedback" ON public.command_feedback` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:46`
- `"Users can view own templates" ON public.task_templates` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:17`
- `"Users can insert own templates" ON public.task_templates` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:22`
- `"Users can update own templates" ON public.task_templates` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:27`
- `"Users can view own runs" ON public.task_runs` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:51`
- `"Users can insert own runs" ON public.task_runs` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:56`
- `"Users can update own runs" ON public.task_runs` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:61`
- `"Users view own proposals" ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:84`
- `"Users insert own proposals" ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:88`
- `"Users update own proposals" ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:92`
- `"Users delete own proposals" ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:96`
- `"Service role full access" ON public.strategy_promotion_proposals` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:101`
- `"Owners select their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:47`
- `"Owners insert their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:50`
- `"Owners update their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:53`
- `"Owners delete their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:56`
- `"Users manage own stress runs" ON public.strategy_stress_runs` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:19`
- `"Users manage own stress turns" ON public.strategy_stress_turns` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:63`
- `"Users can view audit logs for their own runs" ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:34`
- `"Service role and authenticated can insert audit logs" ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421193959_a1a09c8f-6363-4224-9482-0d52e81bfd64.sql:4`
- `"Service role can insert audit logs" ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421194016_b5aebdcd-e66a-4f96-a60e-66b272472e83.sql:3`
- `"users read own cards" ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:46`
- `"users write own cards" ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:51`
- `"users read own decisions" ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:81`
- `"users insert own decisions" ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:86`
- `"Users can view their own canary reviews" ON public.canary_reviews` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:16`
- `"Users can insert their own canary reviews" ON public.canary_reviews` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:20`
- `"Users can view their own lifecycle audit events" ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:27`
- `"Users can insert their own lifecycle audit events" ON public.lifecycle_audit_events` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:32`
- `"Users can view own task_run_sections" ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:23`
- `"Users can insert own task_run_sections" ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:28`
- `"Users can update own task_run_sections" ON public.task_run_sections` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:33`
- `"Users can view their own telemetry" ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:34`
- `"Users can insert their own telemetry" ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:38`
- `"Service role full access" ON public.strategy_run_telemetry` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:43`
- `"Users can read own cache" ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:29`
- `"Users can insert own cache" ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:34`
- `"Users can delete own cache" ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:39`
- `"Users can update own cache" ON public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:44`
- `"Users view own circle creds" ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:14`
- `"Users insert own circle creds" ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:18`
- `"Users update own circle creds" ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:22`
- `"Users delete own circle creds" ON public.circle_credentials` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:26`
- `"Users manage own course_imports" ON public.course_imports` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:22`
- `"Users manage own course_lessons" ON public.course_lessons` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:59`
- `"Users manage own ki_mastery" ON public.ki_mastery` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:68`
- `"Users manage own settings" ON public.user_settings` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:14`
- `"Users manage own progress" ON public.user_lesson_progress` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:27`
- `"Users manage own benchmarks" ON public.skill_benchmarks` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:13`
- `"Users can manage their own profile" ON public.territory_profile` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:31`
- `"Users manage their own call logs" ON public.call_logs` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:25`
- `"Users manage their own signals" ON public.account_signals` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:17`
- `"Users manage their own footprint" ON public.branch_footprint` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:45`
- `"Users manage own custom pills" ON public.strategy_custom_pills` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:26`
- `"users manage their own project settings" ON public.account_project_settings` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:19`
- `"decks readable by authenticated" ON public.flashcard_decks` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:17`
- `"decks writable by service role" ON public.flashcard_decks` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:18`
- `"cards readable by authenticated" ON public.flashcards` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:37`
- `"cards writable by service role" ON public.flashcards` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:38`
- `"state select own" ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:53`
- `"state insert own" ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:54`
- `"state update own" ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:55`
- `"state delete own" ON public.flashcard_state` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:56`
- `"own train prefs select" ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:13`
- `"own train prefs insert" ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:16`
- `"own train prefs update" ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:19`
- `"own train prefs delete" ON public.user_train_prefs` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:23`
- `"own integration runs read" ON public.integration_runs` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:15`
- `"own integration runs insert" ON public.integration_runs` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:17`
- `"Users can check own approval" ON public.approved_users` — `supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:2`
- `"products owner all" ON public.products` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:17`
- `"apo owner all" ON public.account_product_ownership` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:38`
- `"Users manage own nav_events" ON public.nav_events` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:13`
- `"Users can read own active approval row" ON public.approved_users` — `supabase/migrations/20260707002001_ea8b0bf0-b33e-4d31-906f-1b04ff6db3b8.sql:11`
- `function_configs_service_only ON public.function_configs` — `supabase/migrations/20260709184115_78ccebfc-3280-4533-bb7a-a8cb2a7b88c6.sql:9`
- `"agent_cron_map_owner_read" ON public.agent_cron_map` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:16`

## Policy removals

- `"Anyone can insert badges_earned" ON public.badges_earned` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:35`
- `"Anyone can view badges_earned" ON public.badges_earned` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:36`
- `"Anyone can view calendar events" ON public.calendar_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:39`
- `"Anyone can delete holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:42`
- `"Anyone can insert holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:43`
- `"Anyone can update holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:44`
- `"Anyone can view holidays" ON public.holidays` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:45`
- `"Anyone can delete pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:48`
- `"Anyone can insert pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:49`
- `"Anyone can update pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:50`
- `"Anyone can view pto_days" ON public.pto_days` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:51`
- `"Anyone can insert streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:54`
- `"Anyone can update streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:55`
- `"Anyone can view streak_events" ON public.streak_events` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:56`
- `"Anyone can update streak_summary" ON public.streak_summary` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:59`
- `"Anyone can view streak_summary" ON public.streak_summary` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:60`
- `"Anyone can update work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:63`
- `"Anyone can view work_schedule_config" ON public.work_schedule_config` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:64`
- `"Anyone can delete workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:67`
- `"Anyone can insert workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:68`
- `"Anyone can update workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:69`
- `"Anyone can view workday_overrides" ON public.workday_overrides` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:70`
- `"Service role can manage whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260313152210_5032d4fc-4f72-4799-ba42-ec17ddaf7929.sql:3`
- `"Service role can manage whoop_daily_metrics" ON public.whoop_daily_metrics` — `supabase/migrations/20260313152210_5032d4fc-4f72-4799-ba42-ec17ddaf7929.sql:4`
- `"Users can insert own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260326182804_5487b117-3964-4e43-b32a-dda993132f1b.sql:6`
- `"Users can update own whoop_connections" ON public.whoop_connections` — `supabase/migrations/20260326182804_5487b117-3964-4e43-b32a-dda993132f1b.sql:7`
- `"Service role can manage extraction runs" ON public.extraction_runs` — `supabase/migrations/20260405042249_22ff221d-136f-46d4-9cf4-13545bacc360.sql:1`
- `"Owners select their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:42`
- `"Owners insert their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:43`
- `"Owners update their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:44`
- `"Owners delete their conflicts" ON public.strategy_thread_conflicts` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:45`
- `"Service role and authenticated can insert audit logs" ON public.strategy_benchmark_audit_logs` — `supabase/migrations/20260421194016_b5aebdcd-e66a-4f96-a60e-66b272472e83.sql:1`
- `"users read own cards" ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:45`
- `"users write own cards" ON public.library_cards` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:50`
- `"users read own decisions" ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:80`
- `"users insert own decisions" ON public.routing_decisions` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:85`
- `"Service role full access" ON public.strategy_run_telemetry` — `supabase/migrations/20260506195306_2fcc89ff-58f2-4442-9329-4e9f47861063.sql:3`
- `"Users can check own approval" ON public.approved_users` — `supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:1`
- `"Users can check own approval" ON public.approved_users` — `supabase/migrations/20260707002001_ea8b0bf0-b33e-4d31-906f-1b04ff6db3b8.sql:9`
- `"Users view own circle creds" ON public.circle_credentials` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:11`
- `"Users insert own circle creds" ON public.circle_credentials` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:12`
- `"Users update own circle creds" ON public.circle_credentials` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:13`
- `"Users delete own circle creds" ON public.circle_credentials` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:14`

## View security/property alterations

- `ALTER VIEW public.active_accounts SET (security_invoker = on)` — `supabase/migrations/20260407212131_03f71716-6fad-4ded-a575-47b01f6cf9e7.sql:2`
- `ALTER VIEW public.dimension_scores SET (security_invoker = true)` — `supabase/migrations/20260618203144_0d5f5ce5-aa70-443f-9026-b8f1e1622c1c.sql:1`
- `ALTER VIEW public.branch_readiness SET (security_invoker = true)` — `supabase/migrations/20260618210020_46c652c9-a0e4-4c94-9ba0-6ac81c66ccc8.sql:21`
- `ALTER VIEW public.ki_mastery_weekly SET (security_invoker = true)` — `supabase/migrations/20260619013605_19b9e666-b9ee-4b92-b812-816bd60b3fcc.sql:14`
- `ALTER VIEW public.active_accounts SET (security_invoker = true)` — `supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:8`
- `ALTER VIEW public.dimension_scores SET (security_invoker = true)` — `supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:9`
- `ALTER VIEW public.ki_curriculum_full SET (security_invoker = true)` — `supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:10`

## Drops and superseded object definitions

- `DROP TABLE IF EXISTS public.strategy_synthesis_cache` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:5`
- `DROP TABLE IF EXISTS public.whoop_daily_metrics CASCADE` — `supabase/migrations/20260703235457_166361bf-4c11-4685-a363-14c6caf7b5c2.sql:1`
- `DROP TABLE IF EXISTS public.whoop_connections CASCADE` — `supabase/migrations/20260703235457_166361bf-4c11-4685-a363-14c6caf7b5c2.sql:2`
- `DROP FUNCTION IF EXISTS public.get_next_ki_for_dimension(uuid, text, uuid)` — `supabase/migrations/20260619014224_116c05ae-d558-457f-9163-4ea824cf2361.sql:1`
- `DROP FUNCTION IF EXISTS public.get_next_ki_for_dimension(uuid, text, integer)` — `supabase/migrations/20260619014224_116c05ae-d558-457f-9163-4ea824cf2361.sql:2`
- `DROP FUNCTION IF EXISTS public.get_next_ki_for_dimension(uuid, text, integer) CASCADE` — `supabase/migrations/20260619115818_9ccab14b-de04-4f9d-8088-f95436bc5a74.sql:1`
- `DROP FUNCTION IF EXISTS public.calib_drills_export()` — `supabase/migrations/20260702221122_c4cb6e64-ee25-4ca6-bf3b-ca28dc83024e.sql:1`
- `DROP INDEX IF EXISTS idx_synthesis_cache_lookup` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:3`
- `DROP INDEX IF EXISTS idx_synthesis_cache_expires` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:4`
- `get_next_ki_for_dimension` is repeatedly replaced/dropped as signatures evolve; `calib_drills_export` is dropped and then recreated. Restore planning must use final chronological state, not union every historical signature.
- In final chronological repository definitions, `claim_podcast_queue_items`, `get_resource_lifecycle_summary`, and `signal_dimension_weakness` are SECURITY DEFINER without an explicit search_path in their latest CREATE OR REPLACE statement. Later migrations revoke PUBLIC/anon execution and grant reviewed roles, but owner, effective search path, and ACLs still require target verification.

## Byte-identical migration files

- `e2b6f4c0e09ba9913bc03d8627db33d511decab628bda9f3f1aa189efd325524` — `20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql`, `20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql`
- `c9c3101a102e03be70151ad9939d0d86b096481986266ded049519f64d50ffa2` — `20260317225106_ec53f795-9ce9-4e89-814a-460fa8b29eb4.sql`, `20260323110853_07cd44b1-2c4a-40a3-be46-b714a2d35ebc.sql`
- `4e507b3fcb615f5479d056ad1b0596dabe08dcce01c7dbed71f12b7cfbc9678b` — `20260702121921_8051d975-f858-475c-a196-5f5f635b2cb1.sql`, `20260702123531_76fe7c39-9315-47d5-b3a7-f8d29f028efb.sql`
- Identical bytes at different migration timestamps are repository history, but they strengthen the requirement to inspect the export TOC and migration table before choosing schema replay versus selective dump restore.

## Constraints

Every explicit PK/FK/reference/unique/check clause found inside a CREATE TABLE declaration is listed, followed by ALTER TABLE constraint operations. Unique indexes remain separately inventoried as indexes.

- `public.work_schedule_config` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:2`
- `public.holidays` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:18`
- `public.holidays` — `date DATE NOT NULL UNIQUE` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:19`
- `public.pto_days` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:26`
- `public.pto_days` — `date DATE NOT NULL UNIQUE` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:27`
- `public.workday_overrides` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:34`
- `public.workday_overrides` — `date DATE NOT NULL UNIQUE` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:35`
- `public.streak_events` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:43`
- `public.streak_events` — `date DATE NOT NULL UNIQUE` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:44`
- `public.badges_earned` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:58`
- `public.streak_summary` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206162934_ecf524fe-f434-495a-a740-6ca0bc125e5e.sql:67`
- `public.daily_journal_entries` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:2`
- `public.daily_journal_entries` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:3`
- `public.daily_journal_entries` — `energy INTEGER DEFAULT NULL CHECK (energy >= 1 AND energy <= 5)` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:34`
- `public.daily_journal_entries` — `focus_quality INTEGER DEFAULT NULL CHECK (focus_quality >= 1 AND focus_quality <= 5)` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:35`
- `public.daily_journal_entries` — `stress INTEGER DEFAULT NULL CHECK (stress >= 1 AND stress <= 5)` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:36`
- `public.daily_journal_entries` — `clarity INTEGER DEFAULT NULL CHECK (clarity >= 1 AND clarity <= 5)` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:37`
- `public.daily_journal_entries` — `-- Unique constraint: one entry per user per day UNIQUE(user_id, date)` — `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:61`
- `public.accounts` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:2`
- `public.accounts` — `priority TEXT DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:7`
- `public.accounts` — `tier TEXT DEFAULT 'B' CHECK (tier IN ('A', 'B', 'C'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:8`
- `public.accounts` — `account_status TEXT DEFAULT 'inactive' CHECK (account_status IN ('inactive', 'researched', 'active', 'meeting-booked', 'disqualified'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:9`
- `public.accounts` — `motion TEXT DEFAULT 'new-logo' CHECK (motion IN ('new-logo', 'renewal', 'general', 'both'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:10`
- `public.accounts` — `tech_fit_flag TEXT DEFAULT 'good' CHECK (tech_fit_flag IN ('good', 'watch', 'disqualify'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:17`
- `public.accounts` — `outreach_status TEXT DEFAULT 'not-started' CHECK (outreach_status IN ('not-started', 'in-progress', 'working', 'nurture', 'meeting-set', 'opp-open', 'closed-won', 'closed-lost'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:18`
- `public.contacts` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:35`
- `public.contacts` — `account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:37`
- `public.contacts` — `status TEXT DEFAULT 'target' CHECK (status IN ('target', 'engaged', 'unresponsive', 'not-fit'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:46`
- `public.opportunities` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:56`
- `public.opportunities` — `account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:58`
- `public.opportunities` — `status TEXT DEFAULT 'active' CHECK (status IN ('active', 'stalled', 'closed-lost', 'closed-won'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:62`
- `public.opportunities` — `churn_risk TEXT CHECK (churn_risk IN ('certain', 'high', 'medium', 'low'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:65`
- `public.opportunities` — `deal_type TEXT CHECK (deal_type IN ('new-logo', 'expansion', 'renewal', 'one-time'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:71`
- `public.opportunities` — `payment_terms TEXT CHECK (payment_terms IN ('annual', 'prepaid', 'other'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:72`
- `public.renewals` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:86`
- `public.renewals` — `account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:88`
- `public.renewals` — `health_status TEXT DEFAULT 'green' CHECK (health_status IN ('green', 'yellow', 'red'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:103`
- `public.renewals` — `churn_risk TEXT DEFAULT 'low' CHECK (churn_risk IN ('certain', 'high', 'medium', 'low'))` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:104`
- `public.renewals` — `linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:105`
- `public.account_contacts` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:116`
- `public.account_contacts` — `account_id UUID REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:118`
- `public.account_contacts` — `renewal_id UUID REFERENCES public.renewals(id) ON DELETE CASCADE` — `supabase/migrations/20260208035859_eaf5cc9b-5b50-4ea7-be6b-ca224e375d8a.sql:119`
- `public.sales_age_snapshots` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:2`
- `public.sales_age_snapshots` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:3`
- `public.sales_age_snapshots` — `UNIQUE(user_id, week_ending)` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:42`
- `public.quota_targets` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:70`
- `public.quota_targets` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:71`
- `public.quota_targets` — `UNIQUE(user_id)` — `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:100`
- `public.import_header_mappings` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:2`
- `public.import_header_mappings` — `UNIQUE(user_id, csv_header)` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:10`
- `public.import_value_mappings` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:15`
- `public.import_value_mappings` — `UNIQUE(user_id, field_name, csv_value)` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:22`
- `public.import_account_aliases` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:27`
- `public.import_account_aliases` — `account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:31`
- `public.import_account_aliases` — `UNIQUE(user_id, alias_type, alias_value)` — `supabase/migrations/20260209034615_038e5408-8aed-4610-9d42-7b31561305b6.sql:33`
- `public.power_hour_sessions` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260311034007_3c9dea4c-eded-4313-9787-0b02db97b0f4.sql:2`
- `public.daily_digest_items` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:2`
- `public.daily_digest_items` — `account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260311053151_b2898f8a-ca53-4cb1-9372-03f1cf13393e.sql:4`
- `public.whoop_connections` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:3`
- `public.whoop_daily_metrics` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:19`
- `public.weekly_reviews` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:2`
- `public.weekly_reviews` — `UNIQUE(user_id, week_start)` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:32`
- `public.dismissed_action_items` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:43`
- `public.dismissed_action_items` — `UNIQUE(user_id, record_id)` — `supabase/migrations/20260313184614_bbfee0f7-7db7-4745-96eb-f0554357eb0c.sql:49`
- `public.call_transcripts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:2`
- `public.call_transcripts` — `opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:4`
- `public.call_transcripts` — `renewal_id uuid REFERENCES public.renewals(id) ON DELETE SET NULL` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:5`
- `public.call_transcripts` — `account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260313191429_9e0869a0-866e-49cc-80e8-303ac5836747.sql:6`
- `public.resource_links` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:2`
- `public.resource_links` — `account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:4`
- `public.resource_links` — `opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:5`
- `public.resource_links` — `renewal_id UUID REFERENCES public.renewals(id) ON DELETE SET NULL` — `supabase/migrations/20260313195930_4edabfc1-37dd-44ba-b668-260439c621ec.sql:6`
- `public.daily_time_blocks` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:3`
- `public.daily_time_blocks` — `UNIQUE(user_id, plan_date)` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:15`
- `public.ai_feedback` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260314020413_56417632-5b8c-4d06-950b-2a3aa88a828d.sql:27`
- `public.conversion_benchmarks` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:3`
- `public.conversion_benchmarks` — `UNIQUE(user_id)` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:17`
- `public.pipeline_hygiene_scans` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:31`
- `public.pipeline_hygiene_scans` — `UNIQUE(user_id, scan_date)` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:41`
- `public.weekly_battle_plans` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:55`
- `public.weekly_battle_plans` — `UNIQUE(user_id, week_start)` — `supabase/migrations/20260314163750_2cde78cc-4f68-4f29-9383-5eb5d495da63.sql:66`
- `public.tasks` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:3`
- `public.tasks` — `linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:10`
- `public.tasks` — `linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260314174001_857b1280-54cb-47ba-9db2-a0b4a98d3c9e.sql:11`
- `public.icp_sourced_accounts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql:10`
- `public.icp_sourced_accounts` — `promoted_account_id uuid REFERENCES public.accounts(id)` — `supabase/migrations/20260315163148_b28acc25-919f-43d0-9f9c-5d0108b4e57c.sql:26`
- `public.daily_plan_preferences` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:2`
- `public.daily_plan_preferences` — `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:3`
- `public.daily_plan_preferences` — `UNIQUE(user_id)` — `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:16`
- `public.transcript_grades` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:2`
- `public.transcript_grades` — `transcript_id UUID NOT NULL REFERENCES public.call_transcripts(id) ON DELETE CASCADE` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:4`
- `public.transcript_grades` — `UNIQUE(transcript_id)` — `supabase/migrations/20260317064409_ee21c03b-560a-4494-b076-1379b809a91d.sql:21`
- `public.mock_call_sessions` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:2`
- `public.mock_call_sessions` — `parent_session_id uuid REFERENCES public.mock_call_sessions(id)` — `supabase/migrations/20260317084651_545aaeb8-a35c-4f7f-8016-5aaae47fbb9a.sql:16`
- `public.opportunity_methodology` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:2`
- `public.opportunity_methodology` — `UNIQUE(user_id, opportunity_id)` — `supabase/migrations/20260317200136_c7549647-3676-4941-bf9c-798037da6402.sql:35`
- `public.resource_folders` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:3`
- `public.resource_folders` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:4`
- `public.resource_folders` — `parent_id UUID REFERENCES public.resource_folders(id) ON DELETE CASCADE` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:6`
- `public.resources` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:16`
- `public.resources` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:17`
- `public.resources` — `folder_id UUID REFERENCES public.resource_folders(id) ON DELETE SET NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:18`
- `public.resources` — `account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:25`
- `public.resources` — `opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:26`
- `public.resource_versions` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:36`
- `public.resource_versions` — `resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:37`
- `public.resource_versions` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:38`
- `public.template_suggestions` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:3`
- `public.template_suggestions` — `source_resource_id uuid REFERENCES public.resources(id) ON DELETE CASCADE` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:5`
- `public.voice_reminders` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:1`
- `public.voice_reminders` — `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:2`
- `public.dave_transcripts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260319140133_722438e6-636e-4a97-bbae-21c84766ff0d.sql:1`
- `public.resource_digests` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:3`
- `public.resource_digests` — `resource_id uuid NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:4`
- `public.resource_digests` — `UNIQUE(resource_id)` — `supabase/migrations/20260319192008_ec4ad340-8821-4a13-a8c0-7540c0071777.sql:12`
- `public.custom_prompts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260320221358_e78ea58a-5cd7-4a4f-beea-07c2d9b3c505.sql:1`
- `public.deal_patterns` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql:1`
- `public.deal_patterns` — `opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260320222336_1a395309-55b1-49a4-966a-ab1b8f212cee.sql:3`
- `public.coaching_plans` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:1`
- `public.resource_usage_events` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260321175220_ab87c378-b920-4b07-b440-1ccc42aa2c67.sql:15`
- `public.error_logs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:2`
- `public.error_logs` — `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:3`
- `public.resource_jobs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:3`
- `public.resource_jobs` — `resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:4`
- `public.resource_job_steps` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:28`
- `public.resource_job_steps` — `job_id UUID REFERENCES public.resource_jobs(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:29`
- `public.resource_chunks` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:57`
- `public.resource_chunks` — `resource_id UUID REFERENCES public.resources(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:58`
- `public.resource_chunks` — `job_id UUID REFERENCES public.resource_jobs(id) ON DELETE SET NULL` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:59`
- `public.intelligence_units` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:3`
- `public.knowledge_signals` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260323020137_9f74a5d9-2129-4b7f-9f8d-b87532e7e2cd.sql:37`
- `public.strategy_outcomes` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260323021440_d26d0829-caf0-4d70-abb2-903c93cadfbc.sql:2`
- `public.weekly_research_queue` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:3`
- `public.weekly_research_queue` — `UNIQUE (user_id, week_start)` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:9`
- `public.research_queue_events` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:22`
- `public.research_queue_events` — `UNIQUE (user_id, account_id, week_start, event_type)` — `supabase/migrations/20260323145932_eae4422f-56df-496f-9b1b-620dec68fe0c.sql:30`
- `public.playbooks` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260326091059_d43a38b2-ffe9-4a22-bb09-63413aa6c7bf.sql:2`
- `public.playbook_usage_events` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260326111352_a40c36f6-47bd-48c6-adaf-b68d5d77b551.sql:1`
- `public.source_registry` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql:3`
- `public.audio_jobs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260327205143_386fd5d3-bed4-40fd-918a-36e3bcd0aeb6.sql:2`
- `public.verification_runs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260328034915_8e6d0931-bdcf-42c4-bc9e-46d177043a02.sql:2`
- `public.approved_users` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:3`
- `public.approved_users` — `email text NOT NULL UNIQUE` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:4`
- `public.approved_users` — `user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL` — `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:5`
- `public.enrichment_attempts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260329133300_2d084441-8982-4178-a46e-20bdae0ad16d.sql:2`
- `public.knowledge_items` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260330034033_7b700539-2058-40be-a861-c451e390356f.sql:2`
- `public.knowledge_usage_log` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260330132601_a574dbea-6587-422d-92b4-11ad02614ce2.sql:2`
- `public.execution_templates` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:3`
- `public.execution_outputs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:44`
- `public.execution_outputs` — `template_id_used UUID REFERENCES public.execution_templates(id)` — `supabase/migrations/20260330152818_b87a7a69-7c83-43ee-9ac0-a1ccbbe92452.sql:56`
- `public.pipeline_diagnoses` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:2`
- `public.pipeline_runs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:3`
- `public.asset_provenance` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:3`
- `public.asset_provenance` — `asset_type text NOT NULL CHECK (asset_type IN ('template', 'example', 'tactic'))` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:5`
- `public.cluster_resolutions` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260331032436_ab0410c1-b23e-4a8a-9e9e-3a79bb1c16b3.sql:24`
- `public.extraction_pipeline_jobs` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260331061756_62f861de-d64c-4bda-bdbe-45a3a8551f34.sql:3`
- `public.batch_runs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:3`
- `public.batch_runs` — `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:4`
- `public.batch_run_jobs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:20`
- `public.batch_run_jobs` — `batch_run_id UUID NOT NULL REFERENCES public.batch_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:21`
- `public.stage_resources` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:2`
- `public.stage_resources` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:3`
- `public.stage_resources` — `UNIQUE (user_id, stage_id, resource_id)` — `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:9`
- `public.stage_playbooks` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:2`
- `public.stage_playbooks` — `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:3`
- `public.stage_playbooks` — `UNIQUE(user_id, stage_id)` — `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:12`
- `public.playbook_feedback` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:2`
- `public.playbook_feedback` — `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:3`
- `public.playbook_feedback` — `feedback_type TEXT NOT NULL CHECK (feedback_type IN ('section_useful', 'section_not_useful', 'wrong_section', 'too_generic'))` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:5`
- `public.playbook_feedback` — `target_type TEXT NOT NULL CHECK (target_type IN ('section', 'ki_placement', 'playbook_item'))` — `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:6`
- `public.podcast_import_queue` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:3`
- `public.podcast_import_queue` — `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:4`
- `public.podcast_import_queue` — `source_registry_id uuid REFERENCES public.source_registry(id)` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:5`
- `public.course_lesson_imports` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:3`
- `public.course_lesson_imports` — `resource_id UUID REFERENCES public.resources(id) ON DELETE SET NULL` — `supabase/migrations/20260401232215_b86a2acc-e0b0-4a72-ae7d-95c0022cdf35.sql:5`
- `public.resource_extraction_attempts` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260404003058_f717d4a6-3384-499e-8084-aaf7102c84d3.sql:2`
- `public.resource_collections` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:2`
- `public.resource_collections` — `parent_resource_id UUID REFERENCES public.resources(id) ON DELETE SET NULL` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:7`
- `public.resource_collection_members` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:37`
- `public.resource_collection_members` — `collection_id UUID NOT NULL REFERENCES public.resource_collections(id) ON DELETE CASCADE` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:38`
- `public.resource_collection_members` — `resource_id UUID NOT NULL REFERENCES public.resources(id) ON DELETE CASCADE` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:39`
- `public.resource_collection_members` — `UNIQUE(collection_id, resource_id)` — `supabase/migrations/20260404040125_8d632e9c-03cb-437d-9245-6b402075e5a0.sql:43`
- `public.library_reconciliation_runs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:3`
- `public.library_reconciliation_items` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:32`
- `public.library_reconciliation_items` — `run_id UUID NOT NULL REFERENCES public.library_reconciliation_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260404043351_62a55f06-4b60-489b-82ae-b39d0f2c3e4d.sql:33`
- `public.extraction_runs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260405042236_e6709c5d-a5a6-4701-b970-76edcf58964f.sql:2`
- `public.extraction_batches` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:1`
- `public.extraction_batches` — `UNIQUE(resource_id, batch_index)` — `supabase/migrations/20260406021618_6bd2e418-98d9-4066-bcb5-46fec5cb9f0d.sql:21`
- `public.background_jobs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:3`
- `public.lesson_assets` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:1`
- `public.lesson_assets` — `lesson_import_id UUID REFERENCES public.course_lesson_imports(id) ON DELETE CASCADE` — `supabase/migrations/20260409120435_95bc8b7c-a61d-4baf-9d7f-9b457884369a.sql:3`
- `public.dojo_sessions` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:3`
- `public.dojo_sessions` — `mode TEXT NOT NULL DEFAULT 'autopilot' CHECK (mode IN ('autopilot', 'custom'))` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:5`
- `public.dojo_sessions` — `session_type TEXT NOT NULL DEFAULT 'drill' CHECK (session_type IN ('drill', 'quiz', 'spar', 'review'))` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:6`
- `public.dojo_sessions` — `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned'))` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:9`
- `public.dojo_session_turns` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:30`
- `public.dojo_session_turns` — `session_id UUID NOT NULL REFERENCES public.dojo_sessions(id) ON DELETE CASCADE` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:31`
- `public.dojo_session_turns` — `retry_of_turn_id UUID REFERENCES public.dojo_session_turns(id)` — `supabase/migrations/20260410034645_038daaf4-8a7a-43eb-b582-1342ca83fe73.sql:41`
- `public.learning_courses` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:7`
- `public.learning_courses` — `slug TEXT NOT NULL UNIQUE` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:10`
- `public.learning_modules` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:26`
- `public.learning_modules` — `course_id UUID NOT NULL REFERENCES public.learning_courses(id) ON DELETE CASCADE` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:27`
- `public.learning_lessons` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:45`
- `public.learning_lessons` — `module_id UUID NOT NULL REFERENCES public.learning_modules(id) ON DELETE CASCADE` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:46`
- `public.learning_progress` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:75`
- `public.learning_progress` — `lesson_id UUID NOT NULL REFERENCES public.learning_lessons(id) ON DELETE CASCADE` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:77`
- `public.learning_progress` — `UNIQUE (user_id, lesson_id)` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:82`
- `public.learning_quiz_answers` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:107`
- `public.learning_quiz_answers` — `lesson_id UUID NOT NULL REFERENCES public.learning_lessons(id) ON DELETE CASCADE` — `supabase/migrations/20260411221816_7dd1e55d-0b61-435e-8279-0d6fb9eb6e87.sql:109`
- `public.training_blocks` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:7`
- `public.training_blocks` — `current_week INT NOT NULL DEFAULT 1 CHECK (current_week BETWEEN 1 AND 8)` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:11`
- `public.training_blocks` — `phase TEXT NOT NULL DEFAULT 'benchmark' CHECK (phase IN ('benchmark', 'foundation', 'build', 'peak', 'retest'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:12`
- `public.training_blocks` — `stage TEXT NOT NULL DEFAULT 'foundation' CHECK (stage IN ('foundation', 'integration', 'enterprise'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:13`
- `public.training_blocks` — `status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:14`
- `public.training_blocks` — `UNIQUE (user_id, block_number)` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:20`
- `public.daily_assignments` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:43`
- `public.daily_assignments` — `block_id UUID NOT NULL REFERENCES public.training_blocks(id) ON DELETE CASCADE` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:46`
- `public.daily_assignments` — `day_anchor TEXT NOT NULL CHECK (day_anchor IN ( 'opening_cold_call', 'discovery_qualification', 'objection_pricing', 'deal_control_negotiation', 'executive_roi_mixed' ))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:49`
- `public.daily_assignments` — `difficulty TEXT NOT NULL DEFAULT 'intermediate' CHECK (difficulty IN ('foundational', 'intermediate', 'advanced'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:57`
- `public.daily_assignments` — `retry_strategy TEXT NOT NULL DEFAULT 'weakest' CHECK (retry_strategy IN ('weakest', 'variation', 'skip'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:58`
- `public.daily_assignments` — `source TEXT NOT NULL DEFAULT 'weakness' CHECK (source IN ('weakness', 'coverage', 'transcript', 'progression', 'benchmark'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:63`
- `public.daily_assignments` — `UNIQUE (user_id, assignment_date)` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:67`
- `public.block_snapshots` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:86`
- `public.block_snapshots` — `block_id UUID NOT NULL REFERENCES public.training_blocks(id) ON DELETE CASCADE` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:88`
- `public.block_snapshots` — `snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('benchmark', 'retest', 'weekly'))` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:89`
- `public.skill_builder_sessions` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260413002642_47347a30-b804-45a4-87ec-5e6d6f351e35.sql:1`
- `public.closed_loop_sessions` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260413142229_d97ff87f-0b02-44ef-819c-d47e8b69b084.sql:3`
- `public.strategy_threads` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:7`
- `public.strategy_threads` — `linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:12`
- `public.strategy_threads` — `linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:13`
- `public.strategy_messages` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:31`
- `public.strategy_messages` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:32`
- `public.strategy_thread_resources` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:46`
- `public.strategy_thread_resources` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:47`
- `public.account_strategy_memory` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:60`
- `public.account_strategy_memory` — `account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:62`
- `public.account_strategy_memory` — `source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:66`
- `public.account_strategy_memory` — `source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:67`
- `public.opportunity_strategy_memory` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:78`
- `public.opportunity_strategy_memory` — `opportunity_id UUID NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:80`
- `public.opportunity_strategy_memory` — `source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:84`
- `public.opportunity_strategy_memory` — `source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:85`
- `public.territory_strategy_memory` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:96`
- `public.territory_strategy_memory` — `source_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:102`
- `public.territory_strategy_memory` — `source_message_id UUID REFERENCES public.strategy_messages(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:103`
- `public.strategy_rollups` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:113`
- `public.strategy_outputs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:128`
- `public.strategy_outputs` — `thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:130`
- `public.strategy_outputs` — `linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:136`
- `public.strategy_outputs` — `linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:137`
- `public.strategy_uploaded_resources` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:149`
- `public.strategy_uploaded_resources` — `thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:151`
- `public.strategy_workflow_runs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:166`
- `public.strategy_workflow_runs` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:168`
- `public.strategy_artifacts` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:2`
- `public.strategy_artifacts` — `thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:4`
- `public.strategy_artifacts` — `source_output_id UUID REFERENCES public.strategy_outputs(id) ON DELETE SET NULL` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:5`
- `public.strategy_artifacts` — `parent_artifact_id UUID REFERENCES public.strategy_artifacts(id) ON DELETE SET NULL` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:11`
- `public.strategy_artifacts` — `linked_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:12`
- `public.strategy_artifacts` — `linked_opportunity_id UUID REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260415055225_67a03f17-2849-4294-9310-511b34f803f1.sql:13`
- `public.strategy_artifact_feedback` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:21`
- `public.strategy_artifact_feedback` — `artifact_id uuid NOT NULL REFERENCES public.strategy_artifacts(id) ON DELETE CASCADE` — `supabase/migrations/20260415065448_53d9048d-ac96-4b7b-aaaa-8d5aaa40353b.sql:22`
- `public.smoke_test_results` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:2`
- `public.smoke_test_results` — `user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:3`
- `public.command_shortcuts` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:3`
- `public.command_shortcuts` — `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:4`
- `public.command_feedback` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:32`
- `public.command_feedback` — `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:33`
- `public.task_templates` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:3`
- `public.task_templates` — `user_id UUID REFERENCES auth.users NOT NULL` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:4`
- `public.task_runs` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:33`
- `public.task_runs` — `user_id UUID REFERENCES auth.users NOT NULL` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:34`
- `public.task_runs` — `template_id UUID REFERENCES public.task_templates(id)` — `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:36`
- `public.strategy_promotion_proposals` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:4`
- `public.strategy_promotion_proposals` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:6`
- `public.strategy_promotion_proposals` — `-- Provenance: at least one of these should be set source_message_id UUID NULL REFERENCES public.strategy_messages(id) ON DELETE SET NULL` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:7`
- `public.strategy_promotion_proposals` — `-- What was detected proposal_type TEXT NOT NULL CHECK (proposal_type IN ( 'contact', 'account_note', 'account_intelligence', 'opportunity_note', 'opportunity_intelligence', 'transcript', 'resource_promotion', 'artifact_promotion', 'stakeholder', 'risk', 'blocker', 'champion' ))` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:11`
- `public.strategy_promotion_proposals` — `target_scope TEXT NOT NULL CHECK (target_scope IN ('account', 'opportunity', 'both'))` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:30`
- `public.strategy_promotion_proposals` — `target_account_id UUID NULL REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:31`
- `public.strategy_promotion_proposals` — `target_opportunity_id UUID NULL REFERENCES public.opportunities(id) ON DELETE SET NULL` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:32`
- `public.strategy_promotion_proposals` — `-- Review state status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ( 'pending', 'confirmed', 'rejected', 'promoted', 'failed', 'superseded' ))` — `supabase/migrations/20260418185848_945dbdd1-7b96-403a-8573-b948863077b6.sql:41`
- `public.strategy_thread_conflicts` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:16`
- `public.strategy_thread_conflicts` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:17`
- `public.strategy_thread_conflicts` — `CONSTRAINT strategy_thread_conflicts_severity_check CHECK (severity IN ('warning','blocking'))` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:31`
- `public.strategy_stress_runs` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:2`
- `public.strategy_stress_runs` — `thread_id UUID NOT NULL REFERENCES public.strategy_threads(id) ON DELETE CASCADE` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:4`
- `public.strategy_stress_turns` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:29`
- `public.strategy_stress_turns` — `run_id UUID NOT NULL REFERENCES public.strategy_stress_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260420130037_3c51e193-b3f0-4626-a522-95c5e300bb74.sql:30`
- `public.strategy_benchmark_audit_logs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:11`
- `public.strategy_benchmark_audit_logs` — `run_id uuid NOT NULL REFERENCES public.strategy_benchmark_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:12`
- `public.strategy_benchmark_audit_logs` — `CONSTRAINT strategy_benchmark_audit_logs_event_level_check CHECK (event_level IN ('info','warn','error'))` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:22`
- `public.library_cards` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:25`
- `public.library_cards` — `source_type text NOT NULL CHECK (source_type IN ('knowledge_item','playbook','transcript'))` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:27`
- `public.library_cards` — `library_role text NOT NULL CHECK (library_role IN ('standard','tactic','pattern','exemplar'))` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:29`
- `public.routing_decisions` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:66`
- `public.routing_decisions` — `lane text NOT NULL CHECK (lane IN ('direct','assisted','deep_work'))` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:69`
- `public.routing_decisions` — `override_used text CHECK (override_used IN ('quick','deep','auto'))` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:71`
- `public.canary_reviews` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:1`
- `public.canary_reviews` — `recommendation text NOT NULL CHECK (recommendation IN ('continue','fix','rollback'))` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:6`
- `public.canary_reviews` — `decision text NOT NULL CHECK (decision IN ('continue','fix','rollback'))` — `supabase/migrations/20260422112337_6036a74c-de50-4a7a-91fd-adf17e1c9241.sql:7`
- `public.lifecycle_audit_events` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260422150004_d41a34be-a821-4feb-990e-3b580e564128.sql:2`
- `public.task_run_sections` — `id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:2`
- `public.task_run_sections` — `run_id uuid NOT NULL REFERENCES public.task_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:3`
- `public.task_run_sections` — `UNIQUE (run_id, batch_index)` — `supabase/migrations/20260423145107_d4011554-1b8f-41ad-8cdf-f5954ee3fc3b.sql:17`
- `public.strategy_run_telemetry` — `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:3`
- `public.strategy_run_telemetry` — `run_id UUID NOT NULL REFERENCES public.task_runs(id) ON DELETE CASCADE` — `supabase/migrations/20260506195248_da9b0e58-2e5e-41b4-9433-2d804966bc39.sql:4`
- `public.strategy_synthesis_cache` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:8`
- `public.strategy_synthesis_cache` — `UNIQUE(user_id, cache_key)` — `supabase/migrations/20260506224454_8a91332e-9cc6-4a78-9008-9f0c91ec80a4.sql:18`
- `public.circle_credentials` — `id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:1`
- `public.circle_credentials` — `user_id UUID NOT NULL UNIQUE` — `supabase/migrations/20260513210721_43cb4e06-db78-446c-b67a-28650a2d6620.sql:2`
- `public.course_imports` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:2`
- `public.course_imports` — `source_registry_id uuid REFERENCES public.source_registry(id) ON DELETE SET NULL` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:12`
- `public.course_lessons` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:31`
- `public.course_lessons` — `course_import_id uuid NOT NULL REFERENCES public.course_imports(id) ON DELETE CASCADE` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:33`
- `public.course_lessons` — `resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL` — `supabase/migrations/20260514114437_b365067f-fe61-45ab-a867-7de41d16e167.sql:47`
- `public.ki_mastery` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:44`
- `public.ki_mastery` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:45`
- `public.ki_mastery` — `ki_id uuid REFERENCES public.knowledge_items(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:46`
- `public.ki_mastery` — `UNIQUE(user_id, ki_id)` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:60`
- `public.user_settings` — `user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:1`
- `public.user_lesson_progress` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:7`
- `public.user_lesson_progress` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:8`
- `public.user_lesson_progress` — `lesson_id uuid REFERENCES public.learning_lessons(id) NOT NULL` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:9`
- `public.user_lesson_progress` — `UNIQUE(user_id, lesson_id)` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:18`
- `public.skill_benchmarks` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:1`
- `public.skill_benchmarks` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:2`
- `public.territory_profile` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:1`
- `public.territory_profile` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:2`
- `public.territory_profile` — `UNIQUE(user_id)` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:22`
- `public.call_logs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:1`
- `public.call_logs` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:2`
- `public.call_logs` — `account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:3`
- `public.account_signals` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:1`
- `public.account_signals` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:2`
- `public.account_signals` — `signal_type text NOT NULL CHECK (signal_type IN ('account','competitive','product','market','strategic'))` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:4`
- `public.account_signals` — `intelligence_head text NOT NULL CHECK (intelligence_head IN ('sales','product','competitive','market'))` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:5`
- `public.account_signals` — `linked_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:6`
- `public.branch_footprint` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:1`
- `public.branch_footprint` — `user_id uuid REFERENCES auth.users NOT NULL` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:2`
- `public.branch_footprint` — `account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:3`
- `public.branch_footprint` — `UNIQUE(account_id, user_id)` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:36`
- `public.strategy_custom_pills` — `id uuid primary key default gen_random_uuid()` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:2`
- `public.strategy_custom_pills` — `user_id uuid not null references auth.users(id) on delete cascade` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:3`
- `public.account_project_settings` — `id uuid primary key default gen_random_uuid()` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:2`
- `public.account_project_settings` — `user_id uuid not null references auth.users(id) on delete cascade` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:3`
- `public.account_project_settings` — `unique (user_id, account_family)` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:10`
- `public.flashcard_decks` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:2`
- `public.flashcard_decks` — `source_type text NOT NULL CHECK (source_type IN ('curriculum_topic','resource','chapter'))` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:3`
- `public.flashcard_decks` — `generation_status text NOT NULL DEFAULT 'empty' CHECK (generation_status IN ('empty','generating','complete','failed'))` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:8`
- `public.flashcard_decks` — `UNIQUE (source_type, source_ref)` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:11`
- `public.flashcards` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:20`
- `public.flashcards` — `deck_id uuid NOT NULL REFERENCES public.flashcard_decks(id) ON DELETE CASCADE` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:21`
- `public.flashcards` — `card_type text NOT NULL CHECK (card_type IN ('trigger','definition','talk_track'))` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:24`
- `public.flashcards` — `UNIQUE (deck_id, ki_id, card_type)` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:30`
- `public.flashcard_state` — `card_id uuid NOT NULL REFERENCES public.flashcards(id) ON DELETE CASCADE` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:41`
- `public.flashcard_state` — `confidence smallint CHECK (confidence BETWEEN 1 AND 5)` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:42`
- `public.flashcard_state` — `PRIMARY KEY (user_id, card_id)` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:46`
- `public.user_train_prefs` — `user_id uuid PRIMARY KEY` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:2`
- `public.integration_runs` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:3`
- `public.integration_runs` — `user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:4`
- `public.products` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:3`
- `public.products` — `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:4`
- `public.products` — `UNIQUE (user_id, name)` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:11`
- `public.account_product_ownership` — `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:24`
- `public.account_product_ownership` — `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:25`
- `public.account_product_ownership` — `account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:26`
- `public.account_product_ownership` — `product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:27`
- `public.account_product_ownership` — `UNIQUE (account_id, product_id)` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:32`
- `public.nav_events` — `id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:2`
- `public.nav_events` — `user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:3`
- `public._agent_staging` — `PRIMARY KEY (job, row_id)` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:5`
- `public.function_configs` — `function_name text PRIMARY KEY` — `supabase/migrations/20260709184115_78ccebfc-3280-4533-bb7a-a8cb2a7b88c6.sql:1`
- `public.agent_cron_map` — `agent text PRIMARY KEY` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:3`

### ALTER TABLE constraint history

- `public.badges_earned` — `ALTER TABLE public.badges_earned ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:9`
- `public.calendar_events` — `ALTER TABLE public.calendar_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:12`
- `public.holidays` — `ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:15`
- `public.pto_days` — `ALTER TABLE public.pto_days ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:18`
- `public.streak_events` — `ALTER TABLE public.streak_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:21`
- `public.streak_summary` — `ALTER TABLE public.streak_summary ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:24`
- `public.work_schedule_config` — `ALTER TABLE public.work_schedule_config ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:27`
- `public.workday_overrides` — `ALTER TABLE public.workday_overrides ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;` — `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:30`
- `public.daily_journal_entries` — `ALTER TABLE public.daily_journal_entries ADD CONSTRAINT daily_journal_entries_user_date_unique UNIQUE (user_id, date);` — `supabase/migrations/20260206222905_7d0feae7-32a6-47bc-a900-4c37f11b25a7.sql:2`
- `public.streak_events` — `ALTER TABLE public.streak_events ADD CONSTRAINT streak_events_user_date_unique UNIQUE (user_id, date);` — `supabase/migrations/20260206222905_7d0feae7-32a6-47bc-a900-4c37f11b25a7.sql:6`
- `public.whoop_connections` — `ALTER TABLE public.whoop_connections ADD CONSTRAINT whoop_connections_user_id_key UNIQUE (user_id);` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:16`
- `public.whoop_daily_metrics` — `ALTER TABLE public.whoop_daily_metrics ADD CONSTRAINT whoop_daily_metrics_user_date_key UNIQUE (user_id, date);` — `supabase/migrations/20260313152201_c91f253a-a46a-4915-b78a-7092d6eb66a7.sql:32`
- `public.tasks` — `ALTER TABLE public.tasks DROP CONSTRAINT tasks_linked_opportunity_id_fkey;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:2`
- `public.tasks` — `ALTER TABLE public.tasks ADD CONSTRAINT tasks_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:3`
- `public.renewals` — `ALTER TABLE public.renewals DROP CONSTRAINT renewals_linked_opportunity_id_fkey;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:6`
- `public.renewals` — `ALTER TABLE public.renewals ADD CONSTRAINT renewals_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:7`
- `public.call_transcripts` — `ALTER TABLE public.call_transcripts DROP CONSTRAINT call_transcripts_opportunity_id_fkey;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:10`
- `public.call_transcripts` — `ALTER TABLE public.call_transcripts ADD CONSTRAINT call_transcripts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:11`
- `public.resource_links` — `ALTER TABLE public.resource_links DROP CONSTRAINT resource_links_opportunity_id_fkey;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:14`
- `public.resource_links` — `ALTER TABLE public.resource_links ADD CONSTRAINT resource_links_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133610_d4f1bd2a-fac7-42a7-919b-e4d69ea2f290.sql:15`
- `public.tasks` — `ALTER TABLE public.tasks DROP CONSTRAINT tasks_linked_opportunity_id_fkey;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:2`
- `public.tasks` — `ALTER TABLE public.tasks ADD CONSTRAINT tasks_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:3`
- `public.renewals` — `ALTER TABLE public.renewals DROP CONSTRAINT renewals_linked_opportunity_id_fkey;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:6`
- `public.renewals` — `ALTER TABLE public.renewals ADD CONSTRAINT renewals_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:7`
- `public.call_transcripts` — `ALTER TABLE public.call_transcripts DROP CONSTRAINT call_transcripts_opportunity_id_fkey;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:10`
- `public.call_transcripts` — `ALTER TABLE public.call_transcripts ADD CONSTRAINT call_transcripts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:11`
- `public.resource_links` — `ALTER TABLE public.resource_links DROP CONSTRAINT resource_links_opportunity_id_fkey;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:14`
- `public.resource_links` — `ALTER TABLE public.resource_links ADD CONSTRAINT resource_links_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260317133854_4092fecd-98fa-4854-91ba-94b7a2d23a24.sql:15`
- `public.resources` — `ALTER TABLE public.resources ADD COLUMN source_resource_id uuid REFERENCES public.resources(id) ON DELETE SET NULL;` — `supabase/migrations/20260319044715_57e0099a-f070-4575-9b90-f6b77477cd96.sql:1`
- `public.dismissed_duplicates` — `ALTER TABLE public.dismissed_duplicates ADD CONSTRAINT dismissed_duplicates_user_type_key_unique UNIQUE (user_id, record_type, duplicate_key);` — `supabase/migrations/20260323205117_3cccc081-427a-4bde-ac27-a711f5d80143.sql:1`
- `public.resources` — `ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS source_registry_id uuid REFERENCES public.source_registry(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS external_id text, ADD COLUMN IF NOT EXISTS brain_status text NOT NULL DEFAULT 'pending', ADD COLUMN IF NOT EXISTS dedupe_hash text, ADD COLUMN IF NOT EXISTS discovered_at timestamptz DEFAULT now();` — `supabase/migrations/20260327182103_e56f2755-6069-44cc-9601-1952497c0f13.sql:30`
- `public.pipeline_diagnoses` — `ALTER TABLE public.pipeline_diagnoses ADD CONSTRAINT pipeline_diagnoses_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.pipeline_runs(id) ON DELETE CASCADE;` — `supabase/migrations/20260331014904_d32feaa9-6ed7-403b-a1ac-a12555bef3d4.sql:49`
- `public.asset_provenance` — `ALTER TABLE public.asset_provenance DROP CONSTRAINT IF EXISTS asset_provenance_asset_type_check;` — `supabase/migrations/20260331033027_3d484f8a-a704-40f2-a238-c2b6edd949b7.sql:16`
- `public.asset_provenance` — `ALTER TABLE public.asset_provenance ADD CONSTRAINT asset_provenance_asset_type_check CHECK (asset_type IN ('template', 'example', 'tactic', 'knowledge'));` — `supabase/migrations/20260331033027_3d484f8a-a704-40f2-a238-c2b6edd949b7.sql:17`
- `public.course_lesson_imports` — `ALTER TABLE public.course_lesson_imports ADD CONSTRAINT course_lesson_imports_user_lesson_course_unique UNIQUE (user_id, lesson_url, original_course_url);` — `supabase/migrations/20260401232841_09e3164e-b2b0-4f91-a55c-a78222dab065.sql:1`
- `public.podcast_import_queue` — `ALTER TABLE podcast_import_queue ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES batch_runs(id), ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'queued';` — `supabase/migrations/20260403130218_cb68e44c-c55e-471b-8109-4f58e17d95e8.sql:2`
- `public.dojo_sessions` — `ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS assignment_id UUID DEFAULT NULL REFERENCES public.daily_assignments(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS benchmark_tag BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS scenario_family_id TEXT DEFAULT NULL;` — `supabase/migrations/20260412145108_e2c22df7-2680-443e-93c0-56b19a1d2c5e.sql:110`
- `public.strategy_outputs` — `ALTER TABLE public.strategy_outputs ADD CONSTRAINT strategy_outputs_workflow_run_fk FOREIGN KEY (workflow_run_id) REFERENCES public.strategy_workflow_runs(id) ON DELETE SET NULL;` — `supabase/migrations/20260415045353_913520a3-89fb-4fda-b5bd-287d8cc3a190.sql:182`
- `public.contacts` — `ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS source text, ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS promoted_at timestamptz, ADD COLUMN IF NOT EXISTS promoted_by uuid;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:6`
- `public.call_transcripts` — `ALTER TABLE public.call_transcripts ADD COLUMN IF NOT EXISTS source text, ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS promoted_at timestamptz, ADD COLUMN IF NOT EXISTS promoted_by uuid;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:18`
- `public.resources` — `ALTER TABLE public.resources ADD COLUMN IF NOT EXISTS source text, ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS source_strategy_artifact_id uuid REFERENCES public.strategy_artifacts(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS promoted_at timestamptz, ADD COLUMN IF NOT EXISTS promoted_by uuid, ADD COLUMN IF NOT EXISTS promotion_scope text;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:28`
- `public.account_contacts` — `ALTER TABLE public.account_contacts ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:41`
- `public.account_strategy_memory` — `ALTER TABLE public.account_strategy_memory ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:45`
- `public.opportunity_strategy_memory` — `ALTER TABLE public.opportunity_strategy_memory ADD COLUMN IF NOT EXISTS source_proposal_id uuid REFERENCES public.strategy_promotion_proposals(id) ON DELETE SET NULL;` — `supabase/migrations/20260418192147_3d35d9fe-d92a-411b-b80f-2b8faa90299c.sql:48`
- `public.strategy_promotion_proposals` — `ALTER TABLE public.strategy_promotion_proposals DROP CONSTRAINT IF EXISTS strategy_promotion_proposals_confirmed_class_check;` — `supabase/migrations/20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql:6`
- `public.strategy_promotion_proposals` — `ALTER TABLE public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_confirmed_class_check CHECK ( confirmed_class IS NULL OR confirmed_class IN ( 'research_only', 'shared_intelligence', 'crm_contact' ) );` — `supabase/migrations/20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql:8`
- `public.strategy_promotion_proposals` — `ALTER TABLE public.strategy_promotion_proposals DROP CONSTRAINT IF EXISTS strategy_promotion_proposals_status_check;` — `supabase/migrations/20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql:18`
- `public.strategy_promotion_proposals` — `ALTER TABLE public.strategy_promotion_proposals ADD CONSTRAINT strategy_promotion_proposals_status_check CHECK (status IN ( 'pending', 'confirmed', 'confirmed_research_only', 'confirmed_shared_intelligence', 'confirmed_crm_contact', 'promoted', 'rejected', 'failed', 'superseded' ));` — `supabase/migrations/20260418201159_e6084a80-fc32-4e31-bea2-53247369f927.sql:20`
- `public.account_contacts` — `ALTER TABLE public.account_contacts ADD COLUMN IF NOT EXISTS source text, ADD COLUMN IF NOT EXISTS source_strategy_thread_id uuid REFERENCES public.strategy_threads(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS promoted_by uuid, ADD COLUMN IF NOT EXISTS promoted_at timestamp with time zone;` — `supabase/migrations/20260418211313_43305570-fd47-43fb-a47b-6d726d710446.sql:3`
- `public.strategy_threads` — `ALTER TABLE public.strategy_threads ADD COLUMN IF NOT EXISTS trust_state TEXT NOT NULL DEFAULT 'safe', ADD COLUMN IF NOT EXISTS trust_state_reason TEXT, ADD COLUMN IF NOT EXISTS entity_signals JSONB, ADD COLUMN IF NOT EXISTS trust_checked_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS cloned_from_thread_id UUID REFERENCES public.strategy_threads(id) ON DELETE SET NULL;` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:2`
- `public.strategy_threads` — `ALTER TABLE public.strategy_threads DROP CONSTRAINT IF EXISTS strategy_threads_trust_state_check;` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:9`
- `public.strategy_threads` — `ALTER TABLE public.strategy_threads ADD CONSTRAINT strategy_threads_trust_state_check CHECK (trust_state IN ('safe','warning','blocked'));` — `supabase/migrations/20260418234123_6f4e9437-8a1c-46b7-8da4-045bd2c23c88.sql:11`
- `public.strategy_benchmark_runs` — `ALTER TABLE public.strategy_benchmark_runs ADD COLUMN IF NOT EXISTS replayed_from_run_id uuid REFERENCES public.strategy_benchmark_runs(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS replay_reason text, ADD COLUMN IF NOT EXISTS config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;` — `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:3`
- `public.knowledge_items` — `ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS library_role text CHECK (library_role IN ('standard','tactic','pattern','exemplar'));` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:9`
- `public.playbooks` — `ALTER TABLE public.playbooks ADD COLUMN IF NOT EXISTS library_role text CHECK (library_role IN ('standard','tactic','pattern','exemplar'));` — `supabase/migrations/20260422020625_98feeee4-fd2b-4ed7-b2e4-ef6085ddf7ac.sql:13`
- `public.opportunities` — `ALTER TABLE public.opportunities ADD COLUMN IF NOT EXISTS role_title text, ADD COLUMN IF NOT EXISTS process_stage text, ADD COLUMN IF NOT EXISTS verdict text, ADD COLUMN IF NOT EXISTS work_model text, ADD COLUMN IF NOT EXISTS comp_json jsonb DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS next_interview_json jsonb DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS jd_url text, ADD COLUMN IF NOT EXISTS company_url text, ADD COLUMN IF NOT EXISTS recruiter_name text, ADD COLUMN IF NOT EXISTS hiring_manager_name text, ADD COLUMN IF NOT EXISTS open_questions text[] DEFAULT '{}', ADD COLUMN IF NOT EXISTS intelligence_notes text, ADD COLUMN IF NOT EXISTS logistics_notes text, ADD COLUMN IF NOT EXISTS office_location text, ADD COLUMN IF NOT EXISTS primary_strategy_thread_id uuid REFERENCES public.strategy_threads(id);` — `supabase/migrations/20260508020735_3cddde55-6b8d-4597-8fe5-621f39c662c5.sql:2`
- `public.dojo_sessions` — `ALTER TABLE public.dojo_sessions ADD COLUMN IF NOT EXISTS ki_source_id uuid REFERENCES public.knowledge_items(id);` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:76`
- `public.accounts` — `ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS parent_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL;` — `supabase/migrations/20260623194810_2a42a74b-57b7-4747-b613-1c426327c416.sql:1`
- `public.knowledge_items` — `ALTER TABLE public.knowledge_items ADD COLUMN IF NOT EXISTS intelligence_type text CHECK (intelligence_type IN ('sales', 'product', 'competitive', 'market'));` — `supabase/migrations/20260623200100_c55c2dc0-b42e-4bc0-96a4-aa46c37c5a57.sql:1`
- `public.strategy_messages` — `ALTER TABLE public.strategy_messages ADD COLUMN IF NOT EXISTS linked_account_id uuid REFERENCES public.accounts(id) ON DELETE SET NULL, ADD COLUMN IF NOT EXISTS linked_opportunity_id uuid REFERENCES public.opportunities(id) ON DELETE SET NULL;` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:28`

## Grants and revocations

- `REVOKE ALL ON SCHEMA cron_receipt_private FROM PUBLIC, anon, authenticated, service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:11`
- `REVOKE ALL ON TABLE cron_receipt_private.cron_attempt_receipts FROM PUBLIC, anon, authenticated, service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:96`
- `REVOKE ALL ON FUNCTION public.execute_strategy_task_reaper_attempt(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated, service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:486`
- `REVOKE ALL ON FUNCTION public.read_strategy_task_reaper_receipt(uuid, integer, text, text, text) FROM PUBLIC, anon, authenticated, service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:489`
- `GRANT EXECUTE ON FUNCTION public.execute_strategy_task_reaper_attempt(uuid, integer, text, text, text) TO service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:493`
- `GRANT EXECUTE ON FUNCTION public.read_strategy_task_reaper_receipt(uuid, integer, text, text, text) TO service_role;` — `supabase/migrations/20260716160050_add_cron_attempt_receipts.sql:496`
- `REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM authenticated;` — `supabase/migrations/20260323192251_81c8e8ce-cdda-4d8c-a365-74a9f93e0780.sql:1`
- `REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM anon;` — `supabase/migrations/20260323192251_81c8e8ce-cdda-4d8c-a365-74a9f93e0780.sql:2`
- `REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM authenticated;` — `supabase/migrations/20260326175413_23f399b3-1e5c-42a4-8eaf-5edf1591786f.sql:6`
- `REVOKE SELECT (access_token, refresh_token) ON public.whoop_connections FROM anon;` — `supabase/migrations/20260326175413_23f399b3-1e5c-42a4-8eaf-5edf1591786f.sql:7`
- `GRANT SELECT ON public.active_accounts TO authenticated;` — `supabase/migrations/20260407212117_965fa332-b761-4612-8e4d-e578ea450b72.sql:6`
- `GRANT SELECT ON public.active_accounts TO anon;` — `supabase/migrations/20260407212117_965fa332-b761-4612-8e4d-e578ea450b72.sql:7`
- `GRANT EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) TO authenticated;` — `supabase/migrations/20260421171359_00445f9f-32fd-4b4c-a527-a675aeb86ada.sql:53`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.ki_mastery TO authenticated;` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:64`
- `GRANT ALL ON public.ki_mastery TO service_role;` — `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:65`
- `GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, uuid) TO authenticated;` — `supabase/migrations/20260617201120_d54f87ad-9446-4605-ba7c-d6006f3781c1.sql:76`
- `GRANT SELECT ON public.dimension_scores TO authenticated;` — `supabase/migrations/20260618203132_a907bc8e-7fe7-49f7-87fe-e1708d21bfab.sql:47`
- `GRANT SELECT ON public.dimension_scores TO service_role;` — `supabase/migrations/20260618203132_a907bc8e-7fe7-49f7-87fe-e1708d21bfab.sql:48`
- `REVOKE EXECUTE ON FUNCTION public.signal_dimension_weakness(uuid, text, numeric) FROM PUBLIC, anon;` — `supabase/migrations/20260618203341_862ff68a-fdfc-4184-a963-0b585a193385.sql:48`
- `GRANT EXECUTE ON FUNCTION public.signal_dimension_weakness(uuid, text, numeric) TO authenticated, service_role;` — `supabase/migrations/20260618203341_862ff68a-fdfc-4184-a963-0b585a193385.sql:49`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:9`
- `GRANT ALL ON public.user_settings TO service_role;` — `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:10`
- `GRANT SELECT, INSERT, UPDATE ON public.user_lesson_progress TO authenticated;` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:22`
- `GRANT ALL ON public.user_lesson_progress TO service_role;` — `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:23`
- `GRANT SELECT ON public.branch_readiness TO authenticated;` — `supabase/migrations/20260618210020_46c652c9-a0e4-4c94-9ba0-6ac81c66ccc8.sql:22`
- `GRANT SELECT, INSERT ON public.skill_benchmarks TO authenticated;` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:10`
- `GRANT ALL ON public.skill_benchmarks TO service_role;` — `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:11`
- `GRANT SELECT ON public.ki_mastery_weekly TO authenticated;` — `supabase/migrations/20260619013605_19b9e666-b9ee-4b92-b812-816bd60b3fcc.sql:13`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.territory_profile TO authenticated;` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:26`
- `GRANT ALL ON public.territory_profile TO service_role;` — `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:27`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_logs TO authenticated;` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:20`
- `GRANT ALL ON public.call_logs TO service_role;` — `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:21`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_signals TO authenticated;` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:14`
- `GRANT ALL ON public.account_signals TO service_role;` — `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:15`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.branch_footprint TO authenticated;` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:40`
- `GRANT ALL ON public.branch_footprint TO service_role;` — `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:41`
- `grant select, insert, update, delete on public.strategy_custom_pills to authenticated;` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:21`
- `grant all on public.strategy_custom_pills to service_role;` — `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:22`
- `grant select, insert, update, delete on public.account_project_settings to authenticated;` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:14`
- `grant all on public.account_project_settings to service_role;` — `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:15`
- `GRANT SELECT ON public.flashcard_decks TO authenticated;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:14`
- `GRANT ALL ON public.flashcard_decks TO service_role;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:15`
- `GRANT SELECT ON public.flashcards TO authenticated;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:34`
- `GRANT ALL ON public.flashcards TO service_role;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:35`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.flashcard_state TO authenticated;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:50`
- `GRANT ALL ON public.flashcard_state TO service_role;` — `supabase/migrations/20260702004039_98f14143-ec6a-46f8-8b6f-7481458f9f74.sql:51`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_train_prefs TO authenticated;` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:8`
- `GRANT ALL ON public.user_train_prefs TO service_role;` — `supabase/migrations/20260702034506_0072efcd-fd79-433a-9490-24e0af415220.sql:9`
- `GRANT SELECT ON public.training_field_efficacy TO authenticated, service_role;` — `supabase/migrations/20260702203829_34e5ef77-335c-4286-ae54-ae96a2e6f1da.sql:55`
- `GRANT EXECUTE ON FUNCTION public.calib_drills_export() TO anon, authenticated;` — `supabase/migrations/20260702215327_df2b95eb-a09b-4128-98c1-cd721c7dda9e.sql:10`
- `REVOKE EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) FROM anon;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:6`
- `REVOKE EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) FROM anon;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:7`
- `REVOKE EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) FROM anon;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:8`
- `REVOKE EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) FROM anon;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:9`
- `REVOKE EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) FROM anon;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:10`
- `GRANT EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:13`
- `GRANT EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:14`
- `GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) TO authenticated, service_role;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:15`
- `GRANT EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:16`
- `GRANT EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) TO service_role;` — `supabase/migrations/20260703174003_1cb3a733-5577-43c8-ae91-f070d9c2a9e1.sql:17`
- `REVOKE EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) FROM PUBLIC, anon;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:5`
- `REVOKE EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) FROM PUBLIC, anon;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:6`
- `REVOKE EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) FROM PUBLIC, anon;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:7`
- `REVOKE EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) FROM PUBLIC, anon;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:8`
- `REVOKE EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) FROM PUBLIC, anon;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:9`
- `GRANT EXECUTE ON FUNCTION public.get_resource_content_prefixes(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:11`
- `GRANT EXECUTE ON FUNCTION public.get_resource_lifecycle_summary(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:12`
- `GRANT EXECUTE ON FUNCTION public.get_next_ki_for_dimension(uuid, text, integer) TO authenticated, service_role;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:13`
- `GRANT EXECUTE ON FUNCTION public.compute_thread_trust_state(uuid) TO authenticated, service_role;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:14`
- `GRANT EXECUTE ON FUNCTION public.claim_podcast_queue_items(integer, integer) TO service_role;` — `supabase/migrations/20260703174041_8a33d23b-73f6-4c87-be3c-b3e17062c648.sql:15`
- `GRANT SELECT, INSERT ON public.integration_runs TO authenticated;` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:12`
- `GRANT ALL ON public.integration_runs TO service_role;` — `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:13`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:14`
- `GRANT ALL ON public.products TO service_role;` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:15`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_product_ownership TO authenticated;` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:35`
- `GRANT ALL ON public.account_product_ownership TO service_role;` — `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:36`
- `GRANT SELECT, INSERT ON public.nav_events TO authenticated;` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:10`
- `GRANT ALL ON public.nav_events TO service_role;` — `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:11`
- `GRANT SELECT, INSERT ON public._agent_staging TO authenticated;` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:9`
- `GRANT SELECT, INSERT ON public._agent_staging TO service_role;` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:10`
- `GRANT SELECT, INSERT ON public._agent_staging TO anon;` — `supabase/migrations/20260704202956_96a956a3-0314-4bfa-b6eb-6a1867671c48.sql:11`
- `REVOKE ALL ON public.circle_credentials FROM anon;` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:7`
- `REVOKE ALL ON public.circle_credentials FROM authenticated;` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:8`
- `GRANT ALL ON public.circle_credentials TO service_role;` — `supabase/migrations/20260708220725_f9a13aa9-ef39-4060-b67c-75422f6b48c0.sql:9`
- `GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_cron_map TO authenticated;` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:9`
- `GRANT ALL ON public.agent_cron_map TO service_role;` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:10`

## Realtime publications

- `ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_jobs` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:80`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.resource_job_steps` — `supabase/migrations/20260322170324_a55c6bc2-c1e5-4775-9cd0-693d68f14254.sql:81`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.resources` — `supabase/migrations/20260328190948_62be992d-b045-4f54-b1c2-31fb777f48b2.sql:1`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.pipeline_diagnoses` — `supabase/migrations/20260331013034_43794b89-a2bb-4b8f-aca1-42b4f2bcd847.sql:43`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.podcast_import_queue` — `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:43`
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.background_jobs` — `supabase/migrations/20260407122956_882ee3aa-30dc-410b-8d95-8c2151b922c9.sql:55`

## Cron and scheduled SQL

- `unschedule ops_sentinel_v1` schedule `n/a` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:39`
- `ops_sentinel_v1` schedule `0 3 * * *` — `supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:42`
- Only the `ops_sentinel_v1` job is actually scheduled by tracked migrations. `agent_cron_map` seeds names for 12 additional jobs but does not create them; their definitions/schedules are runtime-only unless found elsewhere.
- Registry-only job names seeded by that migration: `lease_reaper_v1`, `decay_evaporator_v1`, `freshness_warden_v1`, `sync-calendar-events-every-hour`, `process-podcast-queue-every-minute`, `generate-daily-digest-6am-et`, `run-strategy-task-reaper-every-minute`, `generate-daily-plan-5am-et`, `cadence_sentinel_v1`, `backlog_burner_v1`, `gap_ranker_v1`, and `governor_v1` (`supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:21`).

## Storage and Auth

- Storage bucket `enrichment-screenshots` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:2`
- Storage bucket `resource-files` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:63`
- Storage bucket `strategy-uploads` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:3`
- Storage policy "Users can upload enrichment screenshots" on `storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:5`
- Storage policy "Users can read own enrichment screenshots" on `storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:10`
- Storage policy "Users can delete own enrichment screenshots" on `storage.objects` — `supabase/migrations/20260312173207_e5f33564-9543-411b-915b-95dd9e14cb09.sql:15`
- Storage policy "Users manage own resource files" on `storage.objects` — `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:66`
- Storage policy "Users upload own strategy files" on `storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:6`
- Storage policy "Users view own strategy files" on `storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:11`
- Storage policy "Users delete own strategy files" on `storage.objects` — `supabase/migrations/20260415045912_25cd0423-a514-4fcc-8c89-b51ff885cc78.sql:16`
- `auth.users` is referenced at 44 migration locations (foreign keys plus one view); representative/full evidence locations: `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:9`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:12`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:15`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:18`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:21`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:24`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:27`, `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:30`, `supabase/migrations/20260206214905_e617db41-cb9d-4cb4-a649-6fc27b727b7a.sql:4`, `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:4`, `supabase/migrations/20260209013312_71b056d0-08cb-4f2f-9896-31333c5ab45f.sql:72`, `supabase/migrations/20260317052005_df0e7a6f-cf27-4520-b37b-3c544ecdc0cd.sql:4`, `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:5`, `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:18`, `supabase/migrations/20260318153529_34be1617-ace4-4181-b92e-8f56f146ced7.sql:39`, `supabase/migrations/20260319111425_ac4466d5-7cbd-4b67-ad84-7d592ea85ff5.sql:3`, `supabase/migrations/20260322165710_2fd77c46-dd4e-4a04-a427-53ae492d39f0.sql:4`, `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:6`, `supabase/migrations/20260329031208_7ba0f577-a022-4533-b28a-3f34e4997354.sql:42`, `supabase/migrations/20260331161739_1b922aab-5427-4423-a45f-3366b11e0093.sql:5`, `supabase/migrations/20260331225620_e18d5e60-3ed7-48b0-9b75-299452c0f9db.sql:4`, `supabase/migrations/20260331230654_92c4f86d-9a0f-4474-9b2b-5e13ed69b35c.sql:4`, `supabase/migrations/20260401015007_ff5285b6-48ec-4f6a-bd01-9f11d7fc0ee1.sql:4`, `supabase/migrations/20260401033608_6484f0b5-de1e-4efd-a34c-f512dd658132.sql:5`, `supabase/migrations/20260415123207_302196f8-d56e-42b9-8856-26e670e9c109.sql:4`, `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:5`, `supabase/migrations/20260415165519_984650cc-dbe6-49f5-b7aa-aea254da2fd3.sql:34`, `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:5`, `supabase/migrations/20260416143953_ac959767-235e-46ec-951d-fea1ce123192.sql:35`, `supabase/migrations/20260617184606_863a887a-d92e-4cda-8eee-82b16969aa29.sql:46`, `supabase/migrations/20260618204720_7147078f-2904-48b0-9137-42d929848bc8.sql:2`, `supabase/migrations/20260618205532_26a4f161-b132-4841-8b6d-d1c07937fc8c.sql:9`, `supabase/migrations/20260618210020_46c652c9-a0e4-4c94-9ba0-6ac81c66ccc8.sql:16`, `supabase/migrations/20260618211644_65ef45e2-9bd4-4fdc-b965-0521f13df7e2.sql:3`, `supabase/migrations/20260623185454_d182c60a-12d5-4b36-b5cb-9c1032343aeb.sql:3`, `supabase/migrations/20260623193651_757c4386-dacd-43e4-a53d-895cccf38c53.sql:3`, `supabase/migrations/20260623194405_6eae97b7-bed9-4b5c-b68d-6b0cabdc174c.sql:3`, `supabase/migrations/20260623195008_9e409819-12d3-4b6d-b8c1-2de6baebe48f.sql:3`, `supabase/migrations/20260624203203_60fa9d23-60dd-4ccd-b25d-8b830e19c8f4.sql:4`, `supabase/migrations/20260624203925_b81be102-e37c-465f-8656-19b344f261e4.sql:4`, `supabase/migrations/20260704023604_1eb3fe2a-28c1-4aa3-9367-550d884d098b.sql:5`, `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:5`, `supabase/migrations/20260704141918_722ffafd-df88-4030-8988-042dbd737224.sql:26`, `supabase/migrations/20260704170523_2607f27f-8c85-460f-af2b-c1e786d2b821.sql:4`.
- RLS predominantly uses `auth.uid()`; there are no tracked migrations that configure Auth providers, redirect URLs, SMTP, OAuth credentials, identities, password hashes, or Auth hooks. Those remain runtime-only.
- `public.approved_users` is repository-defined with email, optional `auth.users` linkage, role, and active-state fields; it seeds one owner email (value deliberately omitted here). The final tracked SELECT policy permits an authenticated user to read only their own linked active row (`supabase/migrations/20260707002001_ea8b0bf0-b33e-4d31-906f-1b04ff6db3b8.sql:9`). `public.is_approved_user(uuid)` is SECURITY DEFINER and reads `auth.users`; actual EXECUTE privileges/default privileges must be verified empirically.

## Repository assumptions not established by migrations

- `public.calendar_events` is altered/indexed/policy-targeted but never created by a tracked migration: alter_table at `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:12`; policy at `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:86`; policy at `supabase/migrations/20260206222237_6e028526-6632-4806-9af9-1ef25589c008.sql:2`; policy at `supabase/migrations/20260206222237_6e028526-6632-4806-9af9-1ef25589c008.sql:8`; policy at `supabase/migrations/20260206225833_dbe32e24-b268-4301-b9cd-920f347a2123.sql:2`; drop_policy at `supabase/migrations/20260206212920_bd0812c8-4616-4add-ab7e-347c3d70e7ce.sql:39`.
- `public.dismissed_duplicates` is altered/indexed/policy-targeted but never created by a tracked migration: alter_table at `supabase/migrations/20260323205117_3cccc081-427a-4bde-ac27-a711f5d80143.sql:1`.
- `public.strategy_benchmark_runs` is altered/indexed/policy-targeted but never created by a tracked migration: alter_table at `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:3`; index at `supabase/migrations/20260421165449_d417ce23-4723-43f3-8b67-a52e745e4d18.sql:8`.
- `public.ki_curriculum` is altered/indexed/policy-targeted but never created by a tracked migration: alter_table at `supabase/migrations/20260702183204_340b2639-fb8b-4d40-bed0-cb3e467ca4eb.sql:2`.
- `public.curriculum_gates` is altered/indexed/policy-targeted but never created by a tracked migration: alter_table at `supabase/migrations/20260702195959_8855e7f1-ee1e-4206-8db9-a31c25aebb5e.sql:2`; alter_table at `supabase/migrations/20260702221315_dbf4d9ee-0742-4447-9422-e14f183d22ae.sql:1`.
- `public.curriculum_concepts` is read by `public.training_field_efficacy` and `public.calib_drills_export` but is never created by a tracked migration (`supabase/migrations/20260702203829_34e5ef77-335c-4286-ae54-ae96a2e6f1da.sql:18`; `supabase/migrations/20260702215327_df2b95eb-a09b-4128-98c1-cd721c7dda9e.sql:6`).
- `public.ki_curriculum_full` is altered to security-invoker but never created by a tracked migration (`supabase/migrations/20260704034559_3ef69f9a-3d3c-4c49-8ff5-046f71355f3d.sql:10`).
- `branch_pov`, `agent_events`, and `public.agent_configs` are dependencies of the only tracked cron definition but have no tracked CREATE TABLE (`supabase/migrations/20260711134232_44bcd1c9-fc73-4dbc-b6a0-c28705a3a756.sql:47-62,159`).
- These gaps mean replaying only the tracked migrations cannot be assumed to reconstruct Cloud schema. The actual export TOC and an isolated rehearsal must decide whether dump schema entries or reviewed reconstruction supplies each prerequisite.

## Code/type inventory present but absent from migration creation history

- Generated repository types declare **170 public tables**. The following **18** have no tracked CREATE TABLE:
  - `account_dossiers` — `src/integrations/supabase/types.ts:122`
  - `account_risks` — `src/integrations/supabase/types.ts:273`
  - `agent_configs` — `src/integrations/supabase/types.ts:707`
  - `agent_events` — `src/integrations/supabase/types.ts:764`
  - `agent_trust` — `src/integrations/supabase/types.ts:830`
  - `branch_pov` — `src/integrations/supabase/types.ts:1465`
  - `calendar_events` — `src/integrations/supabase/types.ts:1531`
  - `competitive_intel` — `src/integrations/supabase/types.ts:2103`
  - `curriculum_concepts` — `src/integrations/supabase/types.ts:2567`
  - `curriculum_gates` — `src/integrations/supabase/types.ts:2644`
  - `dismissed_duplicates` — `src/integrations/supabase/types.ts:3288`
  - `ki_annotations` — `src/integrations/supabase/types.ts:4473`
  - `ki_curriculum` — `src/integrations/supabase/types.ts:4515`
  - `strategy_benchmark_runs` — `src/integrations/supabase/types.ts:8418`
  - `user_band_gate` — `src/integrations/supabase/types.ts:10328`
  - `user_competency` — `src/integrations/supabase/types.ts:10381`
  - `vertical_briefs` — `src/integrations/supabase/types.ts:10601`
  - `verticals` — `src/integrations/supabase/types.ts:10645`
- Generated repository types declare **7 public views**; `ki_curriculum_full` lacks tracked CREATE VIEW. `ki_curriculum_full` is only altered in migrations.
- Generated repository types declare **9 RPC functions**; `monitor_counts`, `morning_line_signals` lack tracked CREATE FUNCTION. Conversely, migration-defined `calib_drills_export`, `update_updated_at_column` are absent from generated RPC types. This may reflect exposure rules or stale types and must not be resolved by assumption.
- Literal client calls additionally reference relations absent from both migrations and generated types: `canonical_resource_status` (`src/lib/extractionPipeline.ts:486`).
- Literal client calls reference RPCs absent from both migrations and generated types: `increment_template_selection` (`src/hooks/useExecutionTemplates.ts:64`).
- `types.ts` is repository evidence of a generated schema snapshot, not proof of current Cloud state or dump contents. The 18 type-only tables, one type-only view, two type-only functions, and code-only names are mandatory export/rehearsal reconciliation items.

## Explicitly absent object classes

- No explicit PostgreSQL enum/type declarations. Status-like domains are implemented with text plus CHECK constraints.
- No explicit sequences, identity columns, or `serial` columns. UUID defaults (`gen_random_uuid()`) dominate primary keys.
- No materialized views, CREATE PUBLICATION, subscriptions, or event triggers. Realtime uses ALTER PUBLICATION against the platform-managed `supabase_realtime` publication.

## Runtime-only / empirical unknowns

- Actual Lovable migration-history rows and whether all 281 files ran in this order.
- Cloud-only objects and drift, including the prerequisite objects named above, current owners/ACLs/default privileges, role memberships, RLS enablement/policies, function owners/search paths, trigger enabled state, extension versions, and complete publication membership.
- `cron.job` rows beyond `ops_sentinel_v1`, whether background writers can be paused, and every job's current active state/body.
- Auth users, identities, sessions, MFA, provider/OAuth settings, redirect allowlist, SMTP/templates, password-hash portability, and reset requirements.
- Storage bucket settings, object inventory/bytes/checksums, and runtime-only bucket/policy drift beyond the three repository buckets.
- Table contents/counts/deterministic per-table digests, sequence values (if runtime objects introduce sequences), and data whose tables are absent from migration creation history. Primary-key values and min/max ranges are deliberately excluded from the default collector as sensitive row-derived evidence; any table-specific use requires separate authorization and review.
- Managed Supabase schemas/roles/extensions/ACLs present in a future export and conflicts with a fresh owned project. No full restore command should be authored until the actual TOC is inspected.
