// Competitive intelligence reference page — static data, no DB.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Competitor {
  id: string;
  name: string;
  tagline: string;
  primaryStrength: string;
  where_branch_wins: string[];
  where_they_win: string[];
  trap_questions: string[];
  objection_reframes: Array<{ objection: string; reframe: string }>;
  who_uses_them: string;
  deal_signals: string[];
}

const COMPETITORS: Competitor[] = [
  {
    id: 'adjust',
    name: 'Adjust',
    tagline: 'AppLovin-owned MMP, strong in performance marketing',
    primaryStrength: 'Deep integration with AppLovin ad network; strong SKAdNetwork/SKAN implementation; often perceived as cheaper',
    where_branch_wins: [
      'Deep linking and universal links — Branch is purpose-built; Adjust barely covers this',
      'Web-to-app journeys — Branch owns the full funnel from web click to app open',
      'Email-to-app, SMS-to-app channels — Adjust has no equivalent',
      'QR code campaigns — Branch tracks offline-to-app natively',
      'Attribution continuity across iOS/Android/web — Branch\'s cross-platform identity is stronger',
      'Enterprise support and SLA — Branch has dedicated CSM; Adjust is self-serve at most tiers',
      'AIO (All-In-One) — Branch\'s unified measurement and linking product has no Adjust equivalent',
    ],
    where_they_win: [
      'Price — Adjust often undercuts on pure attribution pricing',
      'AppLovin ecosystem — if the customer is heavy AppLovin, Adjust integration is tighter',
      'Simpler setup for attribution-only use cases with small teams',
    ],
    trap_questions: [
      '"Does Adjust give you deep links inside your email campaigns — not just attribution, but the actual link that opens the right page in the app?"',
      '"When a user clicks a paid ad and doesn\'t have the app, does Adjust route them through the install to the exact product page, on both iOS and Android?"',
      '"What happens to your attribution when a user switches devices? Does Adjust maintain identity across that?"',
      '"How does Adjust handle web-to-app journeys where the user is already on desktop?"',
    ],
    objection_reframes: [
      {
        objection: '"Adjust does everything Branch does and they\'re 20% cheaper."',
        reframe: 'Adjust is an MMP — they measure clicks and installs. Branch is an MMP plus a deep linking infrastructure plus a channel orchestration layer. The question isn\'t whether Adjust is cheaper for attribution — it\'s whether attribution alone is worth the trade-off on deep linking, email-to-app, web-to-app, and QR. What percentage of your mobile traffic comes from channels outside paid UA?',
      },
      {
        objection: '"We already use AppLovin and Adjust is integrated."',
        reframe: 'The integration is great for paid UA within AppLovin. But what drives your organic installs, your CRM re-engagement, your web traffic? Branch handles the full funnel; Adjust handles one edge of it.',
      },
    ],
    who_uses_them: 'Performance-heavy apps with large paid UA budgets, gaming companies, AppLovin ecosystem customers',
    deal_signals: [
      'Customer mentions AppLovin or META UA as primary channel',
      'Customer says "we just need attribution" and hasn\'t asked about deep linking',
      'Procurement comparison process — Adjust often leads with low pricing',
    ],
  },
  {
    id: 'appsflyer',
    name: 'AppsFlyer',
    tagline: 'Largest independent MMP, strong brand, extensive integrations',
    primaryStrength: 'Market leader position, 10,000+ integrations, strong in enterprise sales, privacy-first positioning with SKAN and Privacy Cloud',
    where_branch_wins: [
      'Deep linking is substantially stronger — AppsFlyer\'s OneLink is basic vs Branch\'s full deep link infrastructure',
      'Deferred deep linking accuracy — Branch routes users from install to exact content more reliably',
      'Email-to-app and SMS-to-app — AppsFlyer has limited coverage; Branch owns this',
      'Web-to-app journeys — Branch handles complex cross-device flows better',
      'QR codes and offline-to-digital campaigns',
      'AIO — Branch\'s combined measurement + linking product',
      'Pricing — AppsFlyer is expensive at enterprise tier',
    ],
    where_they_win: [
      'Brand recognition and market share — perceived as "safe" choice',
      'Breadth of integrations (10K+)',
      'Privacy Cloud for cookieless measurement at scale',
      'Strong with large retail/e-commerce brands who started with them',
    ],
    trap_questions: [
      '"When someone clicks your push notification, does OneLink actually route them to the right screen inside the app, or just the home screen?"',
      '"How do you handle deep linking on the web-to-app journey when the user is in Safari on iOS?"',
      '"Does AppsFlyer track which Branch products drove the conversion, or just last-touch attribution?"',
      '"What does your QR code campaign measurement look like today — are you tracking the full offline-to-install-to-purchase path?"',
    ],
    objection_reframes: [
      {
        objection: '"We\'ve been with AppsFlyer for 5 years and they\'re deeply embedded."',
        reframe: 'Switching MMPs is a real project — we\'re not asking you to. What I\'d ask is: what percentage of your growth last year came from channels outside paid UA? Email, SMS, QR, web? If that number is growing, those are the gaps AppsFlyer isn\'t built for. Branch runs alongside AppsFlyer during migration — it\'s not binary.',
      },
      {
        objection: '"AppsFlyer has 10,000 integrations."',
        reframe: 'Integration breadth matters for media buying. Deep linking and channel orchestration are different layers. Branch integrates with all the same downstream platforms — the question is what you\'re connecting them to. Attribution data or actual user journeys?',
      },
    ],
    who_uses_them: 'Enterprise retail, e-commerce, fintech, large marketing teams with complex attribution needs',
    deal_signals: [
      'Customer is doing heavy re-engagement and mentions push or email campaigns',
      'Customer has international presence (AppsFlyer is strong in EMEA)',
      'Customer mentions OneLink and is dissatisfied with deep link accuracy',
    ],
  },
  {
    id: 'kochava',
    name: 'Kochava',
    tagline: 'Independent MMP with data marketplace, privacy-first positioning',
    primaryStrength: 'Data marketplace (Kochava Collective), strong privacy and fraud prevention, often wins on data ownership narrative',
    where_branch_wins: [
      'Deep linking — Kochava\'s deep linking is minimal compared to Branch',
      'Web-to-app — Kochava focuses on attribution, not journey orchestration',
      'Email/SMS/QR channels — not covered by Kochava',
      'AIO product — no equivalent',
      'Ease of implementation and developer experience',
      'Customer support quality',
    ],
    where_they_win: [
      'Data marketplace and audience segments for retargeting',
      'Customers who prioritize raw data ownership and direct DB access',
      'Privacy compliance framing (especially in sensitive categories)',
      'Fraud prevention and invalid traffic detection',
    ],
    trap_questions: [
      '"When you say Kochava handles attribution, does that include the actual deep link that takes the user to the right screen after install?"',
      '"How does Kochava handle your web-to-app traffic — users who start on your website and then download the app?"',
      '"What does your CRM team use for email deep links — do you have a way to route email clicks directly into specific app screens?"',
    ],
    objection_reframes: [
      {
        objection: '"We own our data with Kochava — we don\'t want another vendor having it."',
        reframe: 'Branch is also privacy-first — we\'re CCPA/GDPR compliant and act as a service provider, not a data buyer. More importantly, data ownership doesn\'t help you if you can\'t use it to drive users into the app from every channel. What channels is Kochava not covering for you today?',
      },
    ],
    who_uses_them: 'Gaming, fintech, privacy-sensitive industries; companies that prioritize data portability',
    deal_signals: [
      'Customer mentions data ownership or wanting raw event data',
      'Gaming or sensitive category vertical',
      'Customer is running a fraud investigation or has invalid traffic concerns',
    ],
  },
  {
    id: 'singular',
    name: 'Singular',
    tagline: 'Marketing analytics and attribution with ROI focus',
    primaryStrength: 'Marketing analytics layer on top of attribution — cost aggregation, ROI reporting across channels in one dashboard; often cheaper',
    where_branch_wins: [
      'Deep linking — Singular has basic deep links, Branch is infrastructure-level',
      'Deferred deep linking accuracy across iOS/Android',
      'Web-to-app, email-to-app, SMS-to-app, QR — all gaps in Singular',
      'Developer experience and SDK quality',
      'AIO and multi-touch attribution for non-paid channels',
    ],
    where_they_win: [
      'Cost aggregation and marketing analytics dashboard — they pull spend data from 2,000+ networks',
      'ROI reporting across paid channels',
      'Often priced lower than AppsFlyer/Branch for analytics-first customers',
      'Simpler setup for performance marketing teams',
    ],
    trap_questions: [
      '"Does Singular handle the deep link from your email campaigns — routing the user to the right screen in the app, not just measuring the click?"',
      '"What happens when a user installs from web versus the app store — does Singular maintain attribution across that journey?"',
      '"Do you use Singular for anything beyond paid UA measurement today — CRM, email, QR codes?"',
    ],
    objection_reframes: [
      {
        objection: '"Singular does attribution AND analytics in one dashboard, Branch only does attribution."',
        reframe: 'Branch does attribution plus deep linking plus channel orchestration — that\'s actually three layers Singular doesn\'t cover. For analytics, Branch exports to every BI tool you already use. The comparison isn\'t attribution vs attribution+analytics, it\'s: what happens between the click and the user landing in the right screen of your app? Singular measures the click. Branch handles the journey.',
      },
    ],
    who_uses_them: 'Performance marketing teams, companies that want cost aggregation with attribution; gaming and e-commerce',
    deal_signals: [
      'Customer mentions "marketing analytics" or "cross-channel ROI" as primary need',
      'Customer has many paid channels and wants a single cost dashboard',
      'Customer doesn\'t mention deep linking, email, or CRM re-engagement',
    ],
  },
];

function CompetitorCard({ competitor }: { competitor: Competitor }) {
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState<'wins' | 'traps' | 'objections'>('wins');

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-center justify-between"
        onClick={() => setExpanded(e => !e)}
      >
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-bold">{competitor.name}</h3>
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">MMP</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{competitor.tagline}</p>
        </div>
        {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 space-y-4">
          <div className="mt-3 p-3 rounded-lg bg-muted/30 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Their strength: </span>{competitor.primaryStrength}
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Typical customer: </span>{competitor.who_uses_them}
          </p>

          <div className="flex gap-1 border-b border-border pb-0">
            {(['wins', 'traps', 'objections'] as const).map(s => (
              <button
                key={s}
                onClick={() => setActiveSection(s)}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-t-lg border-b-2 transition-all',
                  activeSection === s
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {s === 'wins' ? '✅ Where Branch Wins' : s === 'traps' ? '🪤 Trap Questions' : '💬 Objection Reframes'}
              </button>
            ))}
          </div>

          {activeSection === 'wins' && (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-green-600">Branch Wins</p>
                {competitor.where_branch_wins.map((w, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-green-500 shrink-0 mt-0.5">✓</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5 mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">Where They Win</p>
                {competitor.where_they_win.map((w, i) => (
                  <div key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="text-amber-400 shrink-0 mt-0.5">△</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'traps' && (
            <div className="space-y-3">
              {competitor.trap_questions.map((q, i) => (
                <div key={i} className="p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-sm italic text-foreground">{q}</p>
                </div>
              ))}
              <div className="pt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Deal Signals</p>
                {competitor.deal_signals.map((s, i) => (
                  <div key={i} className="flex gap-2 text-xs text-muted-foreground mb-1">
                    <span>⚡</span><span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'objections' && (
            <div className="space-y-4">
              {competitor.objection_reframes.map((o, i) => (
                <div key={i} className="space-y-2">
                  <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <p className="text-xs font-semibold text-red-500 mb-1">Objection</p>
                    <p className="text-sm italic">{o.objection}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                    <p className="text-xs font-semibold text-green-600 mb-1">Reframe</p>
                    <p className="text-sm">{o.reframe}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Competitive() {
  const navigate = useNavigate();

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-40">
      <div className="border-b border-border bg-card/50 px-4 py-3 flex items-center gap-3 shrink-0">
        <button
          onClick={() => navigate('/dojo')}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" /> Dojo
        </button>
        <h1 className="text-base font-bold ml-2">Competitive Intelligence</h1>
        <span className="text-[11px] text-muted-foreground ml-1">· Adjust · AppsFlyer · Kochava · Singular</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 max-w-2xl w-full mx-auto">
        <p className="text-xs text-muted-foreground">
          Tap a competitor to expand. Use Trap Questions in live calls to expose gaps. Update regularly as you gather signal.
        </p>
        {COMPETITORS.map(c => (
          <CompetitorCard key={c.id} competitor={c} />
        ))}
      </div>
    </div>
  );
}
