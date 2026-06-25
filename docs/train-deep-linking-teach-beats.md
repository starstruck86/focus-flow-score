# DYNAMIC — TRAIN: DEEP LINKING TEACH BEATS
Version: 2026-06-25 | Stage B — verified, ratified
Verification: docs.branch.io live run 2026-06-25

These are the 5 verified teach beats for the Deep Linking spoke (Stage B).
Format: situation → elite exemplar → why-elite → anatomy.
Pending Corey voice layer post-Day-1 before final LMS integration.

---

## C1 — What a Deep Link Is (Level 1.1)
### Situation
A new user taps a promo link on mobile, hits the App Store (no app installed), installs, opens — and lands on the generic home screen. The promo context is gone. The conversion is lost. This is the default behavior of every link that isn't Branch-powered.

### Elite Exemplar
A Branch-integrated e-commerce app runs a refer-a-friend program. The referring user shares a Branch Quick Link with a custom discount code embedded in the link data. The new user taps the link, is routed to the App Store, installs, opens — and immediately lands on the product page with the discount pre-applied. `getFirstReferringParams()` delivers the referral data set at the moment of click, even though the app store was in between. The referral is tracked, the discount is applied, the experience is seamless.

### Why Elite
Standard deep links break at the app store. Context — where the user came from, what they were looking at, what offer they clicked — is dropped the moment the app store is involved. Branch's deferred deep linking architecture matches the original link click to the app open after install, preserving all link data.

### Anatomy
1. User clicks a Branch link on mobile (no app installed).
2. Branch routes user to App Store/Play Store, recording the link click + associated data.
3. User installs and opens the app. Branch SDK initializes and calls back to Branch servers.
4. Branch matches the app open to the original link click (`+match_guaranteed=true` = deterministic; false = probabilistic).
5. Link data delivered via init callback. App reads params and routes to correct in-app destination.
6. `getFirstReferringParams()` = first-install data, set once, never changes.

**Branch canonical framing:** "Deferred deep linking routes users who do not have the app installed to relevant content immediately after the first install."
**Stat:** Branch handles 6,000+ edge cases (branch.io/products, current June 2026).

---

## C5 — Link Data and Session Params (Level 1.2)
### Situation
Developer integrates Branch, gets the init callback firing, `params` dictionary comes back. Which keys matter, what do they mean, and how do custom params differ from Branch's own control params? Without knowing the reserved param conventions, developers write logic against keys that don't exist.

### Elite Exemplar
An enterprise app uses Branch for paid acquisition and referral. In the init callback, the developer checks `+clicked_branch_link` first — if false, organic open, no routing logic runs. If true, checks `+match_guaranteed` — for auto-login (data-sensitive), only proceeds if guaranteed; for standard content deep link, proceeds regardless. Reads custom key (`product_id`) to route to the right product page. Calls `getFirstReferringParams()` on the referral flow for the original referrer's ID — that first-install record never changes.

### Why Elite
Reading `product_id` without first checking `+clicked_branch_link` means routing may fire on an organic open with no deep link data. Ignoring `+match_guaranteed` on data-sensitive flows risks acting on a probabilistic match that could be wrong.

### Anatomy

**Reserved control params (`+` prefix):**
| Param | Meaning |
|---|---|
| `+clicked_branch_link` | `"true"` = app opened via Branch link click. `"false"` = organic/non-Branch. |
| `+match_guaranteed` | `"true"` = 100% deterministic match. Post-iOS 14 usually `"false"` on installs unless IDFA collected. NativeLink restores to true. |
| `+is_first_session` | `"true"` on the very first install open. |

**Reserved control params (`$` prefix — Branch behavior control):**
| Param | Meaning |
|---|---|
| `$3p` | Ad partner identifier (e.g. `a_criteo`, `a_facebook`). Auto-set on Branch Ad Links. |

**Custom params (no prefix):** Any key-value pair you embed in the link. Pass through unchanged. E.g. `product_id`, `coupon_code`, `referrer_id`.

**Analytics/tagging (`~` prefix):** `~channel`, `~campaign`, `~feature` — organizational labels, not routing data.

**Two retrieval methods:**
- `getLatestReferringParams()` — most recent session. Clears when session ends. Use for routing.
- `getFirstReferringParams()` — first-ever install referral. Set once, never updated. Use for referral programs.

---

## C11 — Post-Read Routing Policy (Level 4.1)
### Situation
Developer puts routing logic outside the callback, triggered by a flag set inside it. On Android, the Activity relaunches, the flag is stale, the user deep links to the wrong screen. Or routing fires before params are populated. These race conditions are eliminated by the correct pattern.

### Elite Exemplar
A travel app receives a Branch link to a specific flight search. In the `initSession` callback:
```swift
Branch.getInstance().initSession(launchOptions: launchOptions) { params, error in
    guard error == nil,
          let params = params,
          let clicked = params["+clicked_branch_link"] as? String,
          clicked == "true" else {
        self.routeToHome()  // No deep link — fallback
        return
    }
    if let flightId = params["flight_id"] as? String {
        self.routeToFlightDetail(flightId)
    } else {
        self.routeToHome()  // Missing param — fallback
    }
}
```
All routing lives inside the callback. Fallback is explicit and always present.

### Why Elite
The callback is the only safe moment when params are guaranteed populated. Code outside runs before Branch resolves the session. Without explicit fallback, an organic open during an install flow hits an unhandled state. Branch guidance: "Don't leave your users hanging on an infinite spinner or frozen screen."

### Anatomy
1. Register routing logic **inside** `initSession`'s callback — never outside.
2. Check `+clicked_branch_link` first. `false` → home. Stop.
3. Read custom params inside the `true` branch. Route to destination.
4. Always implement explicit fallback to home. No dangling states.
5. Data-sensitive flows: check `+match_guaranteed == "true"` before acting.
6. Android: handle both `onStart` (cold start) and `onNewIntent` (warm start).

---

## C17 — SAN Support Matrix (Level 5.2)
### Situation
An AE tells a prospect their Google UAC and Meta app install campaigns will deep link via Branch links. The answer depends entirely on which SAN and which campaign type. A wrong answer creates a failed POC.

### Elite Exemplar
"For your Google App Install campaigns, Branch links aren't supported in the creative at all — Google UAC blocks MMP redirect links. We use Branch's SAN Deferred Deep Linking feature, which passes intent context through install via Google's API. For Meta, you add your Facebook App Secret in Branch and that enables deferred deep linking via their API. For Snap, Branch links work for click tracking, but Snap restricts redirect links in the ad itself — the deep link goes in as a URI scheme."

### Why Elite
Each SAN has a different technical contract with Branch. Google UAC blocks redirect links entirely. Snap blocks Universal/App Links in campaigns. Facebook requires App Secret pairing. Knowing the matrix cold separates a Branch AE from a generic SaaS rep.

### Anatomy — Verified SAN Matrix

| SAN | Deferred Deep Linking | Universal Links / App Links | URI Scheme | Branch Ad Links |
|---|---|---|---|---|
| **Google — App Install (UAC)** | ✅ SAN DDL only | ❌ | ❌ | ❌ Blocked |
| **Google — App Engagement** | — | ✅ Required | ✅ | ❌ |
| **Facebook/Meta — App Install** | ✅ Requires FB App Secret | ✅ Required | — | ✅ Via Create Facebook Link |
| **Snapchat** | ✅ SAN DDL (FALLBACK = "Web Site") | ❌ Snap restricts | ✅ URI scheme in Deeplink URI field | ⚠️ Click/impression only |
| **TikTok** | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED | UNCONFIRMED |

**Key gotchas:**
- Google App Install: SAN DDL is the ONLY DDL path. No Branch link in the creative.
- Facebook: Facebook SDK must NOT call deferred app link API before Branch — if it does, Branch loses the data.
- Snap: FALLBACK TYPE must = "Web Site" not "App Install" or DDL breaks.

---

## C23 — Journeys Redirect Controls (Level 3.2)
### Situation
Prospect's marketing team uses Braze for in-app messages. They ask: "We already have Braze — why do we need Journeys?" A weak answer conflates the two. A strong answer clarifies: Braze operates inside the app; Journeys operates on the mobile web.

### Elite Exemplar
A retail brand runs a Journeys smart banner on all mobile web product pages targeting iOS users who haven't previously clicked a Branch link. Banner shows on specific URLs, CTA deep links to the corresponding product in-app. Dismiss period configured. A/B test: 50% bottom banner vs 50% full interstitial. Branch dashboard shows view-to-click and view-to-open by variation. Braze handles nothing on this surface — it can't reach a user who isn't in the app yet.

### Why Elite
Journeys closes the web-to-app conversion gap in-app tools can't address. A user browsing mobile web isn't in the app. Braze/Iterable can't show them anything. Journeys reaches them on the web and hands them to the app with full deep link context. The tools are complementary, not competitive.

### Anatomy

**Targeting:**
- Platform: Mobile Web, AMP Web, Desktop (Desktop can't combine with mobile/AMP)
- URL targeting: starts with / exactly matches / contains — multiple URLs = OR; multiple non-URL conditions = AND
- Behavior filters: has/hasn't clicked Branch link, has/hasn't installed app, event-based rules
- ALL conditions must be true for Journey to show

**Dismissal:**
- Dismiss period configurable (how long before re-show)
- AMP exception: dismiss period NOT supported — banner re-shows each AMP session

**CTA / redirects:**
- WYSIWYG + CSS/HTML editor for full creative control
- CTA → App/Play Store (new users); deep links into app (existing users)
- Deep link data configurable per Journey
- A/B testing: multiple creatives with percentage splits

**Journeys vs Smart Banner:** Journeys = full targeting, A/B, analytics. Smart Banner = simple.

**Journeys vs Braze/Iterable:**
- Journeys = **mobile web** surface (users NOT yet in app)
- Braze/Iterable = **in-app** surface (users already in app)
- AE pitch: "Journeys handles the acquisition layer Braze can't touch."
