# DYNAMIC — TRAIN: DEEP LINKING TEACH BEATS
Version: 2026-06-25 | Stage B — ALL 8 TEACH BEATS DRAFTED
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

---

## C4 — getShortUrl Call Flow (Level 1.2)
### Situation
A developer needs to generate Branch short links inside the app — for share sheets, referral programs, or dynamic content linking. They find the Android example, copy the pattern, apply it to iOS. It compiles. But on iOS, `getShortUrl` is async — there is no synchronous return value. The link is nil. The share sheet shows nothing. The pattern is not portable across platforms.

### Elite Exemplar
A social app generates a per-content Branch short link whenever a user taps "Share." The developer knows the call flow differs by SDK:

**Android (Kotlin):**
```kotlin
val buo = BranchUniversalObject()
    .setCanonicalIdentifier("content/12345")
    .setTitle("Check this out")
val lp = LinkProperties()
    .setChannel("social").setFeature("sharing")
    .addControlParameter("$desktop_url", "https://example.com/content/12345")
val url = buo.getShortUrl(applicationContext, lp) // synchronous
shareContent(url)
```

**iOS (Swift) — async required:**
```swift
let buo = BranchUniversalObject(canonicalIdentifier: "content/12345")
let lp = BranchLinkProperties()
lp.channel = "social"; lp.feature = "sharing"
lp.addControlParam("$desktop_url", withValue: "https://example.com/content/12345")
buo.getShortUrl(with: lp) { url, error in
    guard error == nil, let url = url else { return }
    self.shareContent(url) // Must be called inside callback
}
```

**Web SDK — entirely different pattern (no BUO/LinkProperties):**
```javascript
branch.link({
    channel: 'social', feature: 'sharing',
    data: { '$desktop_url': 'https://example.com/content/12345', 'content_id': '12345' }
}, function(err, link) { console.log(link); });
```

### Why Elite
Three patterns look similar enough to invite copy-paste failures that fail silently. iOS returning `nil` without error when called synchronously is a common integration bug. Web SDK using a plain data dictionary instead of BUO is often missed entirely by mobile-first developers.

### Anatomy
1. Build a `BranchUniversalObject` — canonical identifier (required), title, description, image URL.
2. Build `LinkProperties` — channel, feature, campaign, control params (`$desktop_url`, `$fallback_url`), custom params.
3. Call `getShortUrl`:
   - Android: synchronous return OR async `BranchLinkCreateListener` callback.
   - iOS: **always async** — callback required; do not attempt synchronous use.
   - Web SDK: `branch.link(data, callback)` — no BUO, plain data dictionary.
4. Use the URL **inside the callback** on iOS/Web. Share sheet or clipboard must happen inside callback scope.
5. Custom data passes through — readable via `getLatestReferringParams()` on the receiving end.

> **Source:** docs.branch.io/viral/content-sharing, iOS/Android Full Reference guides

---

## C6 — Platform Primitives Unified Matrix (Level 2.1)
### Situation
A developer asks: "Do I need to set up Universal Links, or does Branch handle that?" An AE is asked: "We already have Universal Links — why do we need Branch?" Without understanding what each mechanism does and how Branch layers on top, both give wrong or incomplete answers.

### Elite Exemplar
A Branch SE does technical discovery with a prospect's mobile team that already has iOS Universal Links and Android App Links configured on their own domain. SE: "You've done the platform work. Branch wraps all four mechanisms — Universal Links, App Links, URI scheme, and NativeLink — into a single link that auto-selects the highest-confidence method for each user. Your existing UL/AL config still works; Branch co-registers on the domain and adds deferred deep linking, probabilistic matching, and the NativeLink DDL guarantee on top."

### Why Elite
The four mechanisms are not interchangeable — they solve different problems, apply on different platforms, and have different reliability profiles. Universal Links and App Links are the highest-confidence direct-open methods. URI schemes are fallback. NativeLink solves a specific iOS 15+ problem Universal Links don't address. Treating them as alternatives rather than a layered stack leads to misconfigurations and gaps.

### Anatomy

| Mechanism | Platform | What it is | Reliability | When Branch applies it |
|---|---|---|---|---|
| **Universal Links** | iOS 9+ | Native HTTPS-based app open. iOS validates app against AASA file. Branch provisions/hosts AASA on app.link domain. No redirect — direct tap-to-app. | Highest on iOS. Deterministic when configured. | When app is installed + UL configured. Branch auto co-registers on app.link. |
| **Android App Links** | Android 6+ | Same concept as Universal Links on Android. SHA256 cert fingerprint required. Branch provisions `assetlinks.json`. | Highest on Android. Deterministic when configured. | When app is installed + App Links configured. |
| **URI Scheme** | iOS + Android | Custom scheme (`myapp://`). Fallback when UL/AL unavailable or fail. Three modes: Conservative / Intelligent (default) / Aggressive. | Lower. Can trigger error dialogs if app uninstalled. Intelligent mode mitigates with Branch data. | Fallback when UL/AL fail or not configured. |
| **NativeLink™** | iOS only | Branch's pasteboard-based DDL. Addresses iOS 15+ iCloud+ Private Relay degradation. User sees Deepview → tapping CTA guarantees `+match_guaranteed=true`. 100% DDL accuracy. | 100% when enabled. Requires user interaction. | Opt-in per app. Options: All iOS Traffic / iOS 15+ Only / Private Relay Only. |

**Branch's unification principle:** One Branch link → Branch detects device, OS, browser, install state and applies the right mechanism automatically. NativeLink is the opt-in layer for guaranteed DDL where iCloud+ Private Relay would otherwise degrade accuracy.

**AE frame:** "You configure the primitives once. Branch handles which one fires and when — including edge cases that would break a hand-rolled implementation."

> **Source:** docs.branch.io/links/default-link-behavior, docs.branch.io/resources/matching

---

## C16 — iMessage and Special Surfaces (Level 5.2)
### Situation
A developer builds an iMessage extension. Adds Branch to the extension project using the same Branch key as the main app. Tests. Opening a Branch link from a message opens the main app, not the messages extension. The architecture they assumed doesn't exist — Apple didn't build it.

### Elite Exemplar
A messaging-adjacent app builds two separate Branch integrations: Branch key A for the main iOS app; Branch key B for the iMessage extension. Links created with Key B point to the iMessage App Store (`?app=messages` appended to the iTunes URL). New user taps a Branch link → routed to iMessage App Store to install the extension. Branch tracks the install and first-open in the iMessage context. Key A handles all other deep linking. The two are entirely separate and do not share a Branch key.

### Why Elite
One Branch key for both produces a silent failure that's hard to diagnose. Apple has not built a mechanism for a link click to open an already-installed iMessage extension directly. Developers who assume Branch can bridge the core app and the messages app build something that routes incorrectly. Understanding the constraint upfront eliminates a category of architecture mistake.

### Anatomy
**What `?app=messages` does:**
- `itunes.apple.com/us/app/[name]/[id]` → main App Store
- `itunes.apple.com/us/app/[name]/[id]?app=messages` → iMessage App Store (extension listing)

**What Branch CAN do:**
- Track installs of the iMessage extension.
- Deferred deep link through install (DDL into the extension on first open).
- Personalize the first-time experience inside the extension.

**What Branch CANNOT do:**
- Open an already-installed iMessage extension from a link click. Apple does not support this.
- Share routing context between the core app and the messages extension.

**Required architecture:**
1. Create a **second Branch app** in the dashboard (separate from main app).
2. Configure that second app's iOS settings to point to the iMessage App Store (with `?app=messages`).
3. Integrate the Branch SDK into the iMessage extension using the **second Branch key**.
4. Do not share keys. Routing between core app and messages extension is not possible through Branch.

**Scope:** Keep narrow — iMessage install tracking + DDL only. App Clips, widgets, and stickers = separate surfaces, not covered by this verification run.

> **Source:** docs.branch.io/app-to-app/imessage-apps/

---

## DONE-WHEN STATUS

| Teach Beat | Verified | Drafted | Shippable |
|---|---|---|---|
| C4 getShortUrl (1.2) | ✅ | ✅ | ✅ pending Corey voice layer |
| C6 Platform primitives (2.1) | ✅ | ✅ | ✅ pending Corey voice layer |
| C16 iMessage surfaces (5.2) | ✅ | ✅ | ✅ pending Corey voice layer |
| C17 TikTok | ⬜ BLANK | — | Fill post-Day-1 |
