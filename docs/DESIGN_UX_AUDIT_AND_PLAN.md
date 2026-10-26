# Gokez Customer UX Audit and Design Plan

Status: audit complete; Phase 0 + Phase 1 implementation in progress.
Audit date: 2026-10-26.
Primary app: `mart-user`.
Branch target: `feature/customer-ux-refresh` cut from `origin/develop`.
Main backup: `backup/main-20261026` created from `origin/main`.

## 1. Purpose

Define every design, UX and visual gap found in the Gokez customer experience, compare Gokez with the Indian grocery/quick-commerce market, and set a low-risk implementation plan that improves the experience without changing business logic.

The implementation gate is explicit: no customer-facing code changes until the plan is confirmed.

## 2. Source of truth and constraints

- `mart-user` is the current production customer web app and the source of truth for customer behaviour.
- `mart-mobile` is behind `mart-user`; it must not be used to define customer-web parity.
- The backend plus `mart-user` are authoritative whenever behaviour differs.
- The first implementation phase must be design-led and low-logic-change.
- Do not change order lifecycle, payment model, subscription logic, merchant fulfilment, zone assignment or notification infrastructure without separate approval.
- Preserve existing working behaviour, PWA installation, safe-area handling, reduced-motion support and API contracts.
- Every recommendation must be deliverable inside the existing React/Vite/Tailwind architecture.
- New visual tokens and shared components should reduce future drift, not introduce a second styling system.
- No secrets, credentials or customer data may be added to documentation or commits.

## 3. Delivery-model instruction (hard constraint)

Gokez is not a 10-minute dark-store quick-commerce app.

- Do not invent new speed claims such as "8 minutes" or "arriving in X minutes", and do not show a live ETA. Keep only the existing customer-selected delivery labels.
- Gokez does not use continuous customer mobile-location tracking to calculate delivery time.
- Delivery is based on service zones. The customer chooses or confirms a zone/area.
- If the selected or entered area is outside a serviceable zone, show a clear, friendly popup.
- The customer may still place an order when the address is outside the immediate zone.
- After placement, if the delivery address is confirmed to be too far outside the zone, the order may be cancelled.
- Cancellation must be communicated through:
  - a warm, human push notification; and
  - a cancellation reason/message attached to the order detail screen in the app.
- Design implications:
  - Use the customer-selected delivery preference plus zone, store, slot and availability information.
  - Make serviceability honest before checkout.
  - Make post-order cancellation clear, apologetic and actionable.
  - Never imply live rider tracking or a countdown that Gokez cannot support.

## 4. Agent instruction log

These instructions must remain in force for the implementation:

1. Keep every finding and instruction in this document.
2. Create a backup of `main` before changing application code.
3. Cut the implementation branch from the latest `develop`.
4. Stop and request final confirmation after repository preparation and before code changes.
5. Focus on design, graphics, hierarchy, UX polish and conversion presentation.
6. Do not change much logic.
7. Treat `mart-user` as current; `mart-mobile` is behind.
8. Do not add new speed promises or live ETA. Keep the existing customer-selected 10–15 min / scheduled labels; do not claim store or hub confirmation.
9. Use zone-based delivery messaging.
10. Show an out-of-zone popup where appropriate.
11. Allow the customer to order later even if the address is not immediately confirmed as serviceable.
12. If a placed order is too far outside the zone, cancel it with a sweet push notification and attach the cancellation message to the order detail.
13. Do not commit, push or open a pull request until explicitly asked.
14. Do not redesign the Hub beyond secondary consistency work until the customer experience is resolved.

## 5. Current architecture relevant to design

- `mart-user/src/App.tsx` owns routing, the customer shell, checkout overlay, zone loading and global notices.
- `mart-user/src/components/AppShell.tsx` owns the mobile shell/scroll contract.
- `mart-user/src/components/Navbar.tsx` owns search, branding and the delivery-zone selector.
- `mart-user/src/components/BottomNav.tsx` owns mobile navigation.
- `mart-user/src/components/HomeSections.tsx` renders backend-configured home modules.
- `mart-user/src/components/HomeCarousel.tsx` renders promotional carousel slides.
- `mart-user/src/components/ProductCard.tsx` renders product tiles.
- `mart-user/src/pages/CheckoutPage.tsx` renders checkout, scheduling, delivery notes and order placement.
- `mart-user/src/pages/AccountPage.tsx` renders login, profile, addresses, zone controls and account actions.
- Styling is mostly ad-hoc Tailwind utilities with a small amount of shared CSS.

## 6. Market context

Public September 2026 order-volume reporting indicates approximately:

| Platform | Order-volume share |
| --- | --- |
| Blinkit | 40.2% |
| Zepto | 23.0% |
| Instamart | 13.6% |
| Flipkart Minutes | 11.0% |
| Amazon Now | 7.4% |
| BigBasket | 4.6% |

Implications:

- Gokez cannot win by copying dark-store speed, assortment or ad density.
- The market leaders are strong at top-of-screen clarity, personalization, visual merchandising, reorder and savings nudges.
- The leaders are also visibly cluttered. There is room for a calmer, more trustworthy neighbourhood-marketplace experience.
- Gokez's credible differentiation is local-store trust, freshness, transparent zone coverage, pay-on-delivery and subscription value.

## 7. Competitor UX lessons

| Competitor | Useful patterns | Do not copy |
| --- | --- | --- |
| Blinkit | Location and delivery promise at top; visual category shortcuts; order-again; sticky minimum-order/free-delivery nudge; strong product imagery | Banner overload, tiny promotional noise, ad-heavy home screen, fake urgency |
| Zepto | Buy Again; free-delivery progress; clear savings tiles; flexible address/location setup; strong offer hierarchy | Information overload, too many competing promos, no-confirmation checkout, dark-pattern intensity |
| Instamart | Coherent standalone brand system; blue and orange contrast; bento/cluster discovery cards; strong campaign art direction | Copying its identity instead of owning Gokez's; excessive promo density |
| BigBasket | Grocery depth; shopping lists; scheduled-slot clarity; dependable everyday utility | Weak visual distinctiveness; confusing overlap between express and scheduled delivery |
| Flipkart Minutes / JioMart | Inline category navigation; personalization; video/live-commerce experiments; broad marketplace flows | Complexity and feature breadth that Gokez does not need |

Competitor visual signatures:

- Blinkit: dark green/yellow, dense merchandising, speed and location at the top.
- Zepto: magenta/purple, playful and promotional, savings-led.
- Instamart: blue `#0050ff` plus orange `#ff5200`, bold bento layout, salt background.
- BigBasket: practical grocery layout with delivery-slot emphasis.
- Flipkart: navigation tabs, in-line categories, motion/haptics, personalization.

## 8. Detailed gap register

### 8.1 Brand coherence

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| BR-01 | Multiple primary greens are used instead of one brand green | `#218044`, `#2e8b57`, emerald classes and hardcoded checkout greens coexist | The app looks assembled from different products |
| BR-02 | The defined `gokez` palette is largely unused | `mart-user/tailwind.config.js:14` defines the scale, but screens use emerald and arbitrary hex values | No enforceable brand colour system |
| BR-03 | Checkout introduces violet as a second brand colour | Scheduled-delivery and delivery-instruction panels use violet in `CheckoutPage.tsx` | The highest-trust screen feels disconnected |
| BR-04 | Category tabs use a rainbow accent system | `CategoriesView.tsx:18` defines emerald, blue, violet, amber, rose, cyan, orange and pink accents | Visual noise and no category meaning |
| BR-05 | Account uses a separate custom grey language | Hardcoded `text-[#5A5A5A]`, `text-[#2D2D2D]`, `text-[#8A8A8A]` | Account feels like another app |
| BR-06 | Dark mode uses a Facebook-style slate override plus hundreds of local variants | `tailwind.config.js` overrides slate; 978 `dark:` occurrences | Inconsistent dark surfaces and high maintenance cost |
| BR-07 | Dark-mode CSS variables are defined but not consistently used | `mart-user/src/index.css` | Dead styling contract and misleading implementation |
| BR-08 | Gradient fallbacks, emoji and generic shapes carry too much brand weight | `HomeCarousel.tsx`, `ProductCard.tsx` emoji fallback | Looks like a prototype rather than a food brand |
| BR-09 | Radius, shadow and border treatments vary by screen | Many `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full` combinations | No visual rhythm or component consistency |
| BR-10 | Z-index values are locally invented | Header, sheets, overlays and sticky bars use arbitrary values | Overlap and stacking bugs become likely |

### 8.2 Typography and accessibility

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| TY-01 | Type scale is fragmented | Approximately 160 `text-xs` and 151 `text-sm` usages, plus many arbitrary sizes | Inconsistent hierarchy |
| TY-02 | Very small text is common | Over 100 labels at 8-12 px, including zone labels and checkout details | Poor readability on budget Android devices |
| TY-03 | Login headline uses viewport-clamped type and a `5lh` gap | `AccountPage.tsx` brand header and slogan | Layout feels improvised and fragile |
| TY-04 | Uppercase and letter-spacing styles are applied ad hoc | Checkout labels and section eyebrows | Inconsistent visual language |
| TY-05 | Focus-visible treatment is not systematically applied | Mixed use of `focus-visible` across buttons and inputs | Keyboard users lose orientation |
| TY-06 | Some text-heavy controls are below comfortable touch size | 10-11 px labels and compact rows | Hard to tap and read |
| TY-07 | Colour contrast is not governed by tokens | Muted greys, white-on-green and white-on-image overlays vary | Accessibility regressions |

### 8.3 Layout, shell and responsive behaviour

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| LY-01 | Every screen hand-builds its card and section shell | Repeated Tailwind recipes across pages | Drift and slow iteration |
| LY-02 | Desktop mostly inherits mobile patterns | Mobile bottom navigation and dense cards remain the primary mental model | Desktop feels stretched rather than designed |
| LY-03 | Header patterns vary by screen | Different page headers, gradients and back-button treatments | Customers relearn navigation |
| LY-04 | Safe-area and scroll handling exists but is not matched by visual polish | `AppShell.tsx` and bottom-nav rules | Good engineering obscured by inconsistent presentation |
| LY-05 | Loading states use a single generic pulse card grid | `App.tsx:1398` | Loading does not match final layout |
| LY-06 | Empty and error states are inconsistent | Different pages use different copy, spacing and imagery | Reduced trust when things go wrong |
| LY-07 | Motion is not governed by a shared timing/easing system | Mixed transitions and active states | Interface feels uneven |

### 8.4 Homepage and merchandising

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| HM-01 | There is no single dominant value proposition | Multiple competing carousels, rails and tiles | New users do not understand what Gokez is best for |
| HM-02 | Home is highly configurable, which produces layout drift | Backend-driven sections in `HomeSections.tsx` | Merchandising changes can break visual consistency |
| HM-03 | Carousel is the primary hero mechanism | `HomeCarousel.tsx` auto-rotating mobile slides | Important messaging is missed and the page feels generic |
| HM-04 | Promotional fallbacks rely on gradients and badges | `HomeCarousel.tsx:216` | Campaigns look templated rather than premium |
| HM-05 | Category tiles are plain bordered buttons | `HomeSections.tsx:192` | Groceries are not visually appetising |
| HM-06 | Category tiles always open the categories root | `HomeSections.tsx:192` ignores the requested slug | The customer's intent is lost |
| HM-07 | Promo category buttons dispatch an event with no listener | `HomeSections.tsx:155` sends `gokez:select-category`; no handler exists in `src` | Dead CTA behaviour |
| HM-08 | Titles are auto-capitalised at render time | Repeated `replace(/\b\w/g, ...)` in `HomeSections.tsx` | Copy quality and locale handling are unpredictable |
| HM-09 | No clear zone/serviceability strip on the home screen | Zone lives in Navbar | Delivery coverage is not explained at the moment of intent |
| HM-10 | No reorder/buy-again module | Current home relies on generic rails | Frequent customers do extra work |
| HM-11 | Subscription value is not explained in the shopping flow | Account/subscription logic exists elsewhere | Gokez's business model is invisible |
| HM-12 | Store/local-merchant story is underused | No prominent local-store trust module | Gokez's main differentiator is hidden |
| HM-13 | Too many small sections compete for attention | Multiple rails, tiles and banners | Cognitive load and scroll fatigue |
| HM-14 | No explicit "pay on delivery" reassurance near cart/checkout entry | Payment truth lives late in checkout | Trust is delayed |

### 8.5 Product discovery and cards

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| PD-01 | Product images use inconsistent framing | `object-cover` in `ProductCard.tsx` | Packshots get cropped and products look uneven |
| PD-02 | Cards use a fixed three-line name to force alignment | `ProductCard.tsx` | Dense, hard-to-scan names |
| PD-03 | Unit and approximate weight are tiny | 11 px metadata | Important buying information is easy to miss |
| PD-04 | No ratings, popularity or social proof on cards | `ProductCard.tsx` | New customers lack confidence |
| PD-05 | No visible variant information outside the detail sheet | Cards represent one unit at a time | Customers must open products to compare |
| PD-06 | Emoji fallback is the only image-failure language | `ProductCard.tsx` | Looks unpolished when a photo is missing |
| PD-07 | Card image, title and price compete with the add control | Add control overlays image corner | Small screens feel crowded |
| PD-08 | Product detail uses a sheet but the transition is not part of a shared motion system | `ProductDetailSheet.tsx` | Inconsistent interaction feel |

### 8.6 Navigation and information architecture

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| NV-01 | Desktop and mobile use different icons for the same destinations | `Navbar.tsx:21` uses Home/ClipboardList; `BottomNav.tsx` uses Store/Package | Learned navigation does not transfer |
| NV-02 | The centre vegetable image opens search | `BottomNav.tsx:36` has label "Vegetables" but calls `onOpenSearch` | The control's label and behaviour disagree |
| NV-03 | The nav image is oversized for its rendered size | `fresh_icon.webp` is 243 KB and renders at 48 px | Wasted bandwidth |
| NV-04 | The preload points at a different asset than the nav renders | `index.html` preloads `fresh-veg.webp`; BottomNav uses `fresh_icon.webp` | Double download and no preload benefit |
| NV-05 | Zone selector uses 8 px labels | `Navbar.tsx` | Critical delivery information is hard to read |
| NV-06 | Navigation labels are inconsistent in tone and specificity | Home/Categories/Orders/Account vs contextual "Back" headers | Uneven orientation |
| NV-07 | Active states are not standardised | Different colours and weights across navs | Weak "where am I" feedback |

### 8.7 Cart and checkout

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| CK-01 | Checkout uses violet for scheduling and instructions | `CheckoutPage.tsx:1353`, `:1390` | Brand break at the conversion step |
| CK-02 | Checkout CTA uses a hardcoded green | `CheckoutPage.tsx:1503` uses `#15803d` | Token drift |
| CK-03 | Guest login uses a rose treatment | `CheckoutPage.tsx:1246` | Another unrelated accent |
| CK-04 | Many checkout labels are 10-11 px | Delivery instruction, period toggles, footer copy | Hard to read during a high-attention task |
| CK-05 | Scheduled delivery is visually dense | Day, period and slot controls in a compact violet panel | Customers cannot quickly compare options |
| CK-06 | Delivery instructions are visually detached from delivery details | Separate violet note card | Feels like an add-on rather than part of fulfilment |
| CK-07 | Fee and payment transparency is not visually prioritised | Pay-on-delivery truth is in the footer | Trust arrives too late |
| CK-08 | Zone/serviceability context is not carried into checkout strongly enough | `zoneName` exists but is not a primary reassurance element | Customer may worry about coverage |
| CK-09 | Guest and logged-in states use different visual emphasis | Login badge vs form fields | Inconsistent identity state |
| CK-10 | Sticky pay bar is useful but visually heavy | Dark green, two-line CTA | Good concept, unresolved hierarchy |

### 8.8 Authentication and account

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| AC-01 | Login uses the large brand PNG at a small rendered size | `AccountPage.tsx:409` loads 1536x1024 `mart_brand_new.png` at 54 px height | 658 KB asset for a tiny logo |
| AC-02 | Login slogan is separated with a manual `5lh` margin | `AccountPage.tsx` | Fragile vertical rhythm |
| AC-03 | Account uses custom grey hex values | Account-specific palette | Visual inconsistency |
| AC-04 | Account surface is functionally dense but visually flat | Address, zone, subscription, support and legal actions compete | Hard to find the primary action |
| AC-05 | Location and zone controls mix permission, detection and manual selection | Account + Navbar duplicate concepts | Customers may not understand what is being detected |
| AC-06 | No cohesive logged-in vs logged-out hierarchy | Login, profile and guest states vary | Identity state is unclear |

### 8.9 Orders, cancellations and post-order UX

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| OR-01 | Cancellation visuals are basic | `OrderCards.tsx` outside-delivery-area copy exists but is not a designed state | Customers may feel blamed or confused |
| OR-02 | No dedicated design for "ordered outside zone, later cancelled" | Current flow is notification-led | The most sensitive failure lacks a warm explanation |
| OR-03 | No standard timeline treatment for cancellation reason | Order detail shows cancellation status, not a designed reason block | Customer cannot easily understand what happened |
| OR-04 | Push copy is not governed by tone guidelines | Notifications are implementation-level | Risk of sounding cold or transactional |
| OR-05 | Reorder is not prominent in the customer journey | Cards exist, but home has no Buy Again module | Repeat purchase is harder than it should be |
| OR-06 | Order status language is not part of a shared design system | Status chips vary by screen | Inconsistent confidence |

### 8.10 Assets, performance and perceived quality

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| AS-01 | Oversized brand assets are shipped | `mart_brand_new.png` 658 KB, `mart_logo_new.png` 663 KB | Slower first load |
| AS-02 | Hero/banner assets are large | `1.webp` 295 KB, `2.webp` 209 KB, `3.webp` 256 KB | Mobile data and LCP cost |
| AS-03 | Footer/decorative images are large | `f1.png`-`f4.png` are about 164 KB each | Heavy for decorative content |
| AS-04 | Nav icon is 243 KB for a 48 px slot | `fresh_icon.webp` | Avoidable bandwidth |
| AS-05 | Preload mismatch wastes a request | `fresh-veg.webp` preload vs `fresh_icon.webp` usage | No LCP gain and extra work |
| AS-06 | No consistent responsive image policy | Mixed PNG/WebP and no clear srcset strategy | Performance depends on asset luck |
| AS-07 | PWA icon/splash set is complete but visual consistency is not audited | `public/icons`, `public/splash` | Install experience may diverge from app |
| AS-08 | Product photography quality is inconsistent | Product cards and detail sheets | Groceries look less fresh than competitors |

### 8.11 Content and language

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| CT-01 | Auto-capitalisation is used as a content strategy | `HomeSections.tsx` | Unnatural copy and proper nouns may break |
| CT-02 | Error, empty and cancellation copy is inconsistent | Multiple screens | Tone shifts from warm to technical |
| CT-03 | No terminology guide for zone, area, slot, store and delivery | Navbar, checkout and account | Customers may confuse location with delivery coverage |
| CT-04 | No "why Gokez" story in the shopping flow | About/What-is pages are secondary | Differentiation is not communicated |
| CT-05 | Success and failure states lack consistent next actions | Checkout/orders | Customers are left to infer what happens next |

### 8.12 Hub design (secondary)

The Hub is an internal operations tool and is not the primary visual-design target. Keep it consistent, but do not spend customer-experience effort here until the `mart-user` plan is complete.

| ID | Finding | Evidence | Impact |
| --- | --- | --- | --- |
| HB-01 | Hub reads as a competent admin tool, not a premium SaaS product | Emerald/navy dashboard language | Acceptable internally, but inconsistent with customer brand |
| HB-02 | Orders cards are overloaded | `mart-hub/src/pages/OrdersPage.tsx` | Slower scanning for operators |
| HB-03 | More menu is a flat list of about 20 items | `mart-hub/src/pages/MorePage.tsx` | Poor discoverability |
| HB-04 | Login is the strongest screen | `mart-hub/src/pages/LoginPage.tsx` | Use its clarity as a reference |
| HB-05 | Delivery active card is strong | `mart-hub/src/pages/DeliveryPage.tsx` | Good operational pattern |
| HB-06 | Dashboard KPI row is strong | `mart-hub/src/pages/DashboardPage.tsx` | Good information hierarchy |
| HB-07 | Hub lacks a shared design-system layer | Page-local Tailwind recipes | Long-term inconsistency |

## 9. Existing strengths to preserve

- `AppShell` provides a stable scroll and safe-area contract.
- Bottom navigation is safe-area aware.
- Reduced-motion support exists.
- Search and zone selection are available from the main shell.
- Store status is surfaced.
- Product cards already support quantity control, stock state and discount badges.
- Checkout supports schedule and delivery instructions.
- PWA, offline and update flows are already implemented.
- The green brand chrome and savings messaging are recognisable.
- `docs/HOMEPAGE_UX_AUDIT.md` already contains useful homepage findings and should be treated as supporting research, not replaced.

## 10. Proposed design direction

### 10.1 Position

"Your neighbourhood store, delivered."

Gokez should feel:

- local, warm and human;
- fresh and food-led;
- honest about zones and timing;
- trustworthy at checkout;
- simpler than the big quick-commerce apps.

### 10.2 Visual system

- Primary: Gokez green, centred on `#0A9250`.
- Canvas: warm cream or off-white instead of pure white everywhere.
- Ink: near-black green-charcoal.
- Accent: saffron/amber for offers and highlights only.
- Neutral surfaces: white with subtle warm borders.
- Radius: standardise on two or three values, likely 12 and 16 px, plus full pills.
- Shadows: one soft elevation system; avoid mixing heavy and flat cards.
- Typography: Inter for UI; keep Poppins only for a small display role.
- Type floor: 12 px for secondary labels, 14 px for body, 16 px for primary card titles.
- Photography: real produce, packs and local stores; consistent 1:1 packshot treatment on a cream background.
- Illustration: remove emoji as a primary fallback; use a branded neutral placeholder.
- Motion: 150-250 ms, purposeful, reduced-motion safe.
- Dark mode: defer comprehensive cleanup. Do not let it block brand or hierarchy work.

### 10.3 Homepage information architecture

1. Brand/header with zone and serviceability.
2. Search with clear intent and recent/recommended suggestions.
3. One primary hero: local freshness/value proposition.
4. Buy Again / reorder rail.
5. Image-led category tiles, six to eight maximum.
6. "Fresh today" product rail with larger cards.
7. Local-store trust strip: neighbourhood stores, pay on delivery, same-day slots.
8. Curated bundles and seasonal edits.
9. Subscription value block.
10. One offers area, not several competing promo bands.

Rules:

- Limit the number of homepage modules.
- Define fixed module templates and image ratios.
- Do not auto-rotate the primary message.
- Do not introduce new speed claims or a live ETA.
- Keep the existing customer-selected delivery labels and show zone/slot language alongside them.

### 10.4 Product card

- Consistent square image area.
- `object-contain` for packshots; `object-cover` only for lifestyle imagery.
- Two to three line title with predictable height.
- Unit and approximate weight clearly visible.
- Price, MRP and discount in one row.
- Stock state without hiding the whole card.
- Add/quantity control that does not cover the product.
- Optional ratings/popularity only if the data exists.
- Branded image fallback.

### 10.5 Cart and checkout

- One brand-green system.
- Visible step indicator: Cart, Delivery, Payment, Review.
- Delivery zone and serviceability shown as reassurance.
- Schedule options as clear cards with readable labels.
- Delivery instructions integrated into fulfilment, not a separate violet module.
- Transparent fee and payment summary.
- Pay-on-delivery reassurance before the final CTA.
- Sticky action bar that remains legible and single-purpose.
- Explicit review/confirmation before placement.
- Empty-cart and order-failure states with a clear next action.

### 10.6 Zone and cancellation UX

- Primary language: "Delivery area", "zone", "slot", "store".
- Show the selected zone near search and checkout.
- If outside the zone:
  - friendly popup explaining coverage;
  - option to browse or choose another area;
  - option to continue and place the order for later review.
- If an order is placed and later found too far outside the zone:
  - sweet push notification with a human explanation;
  - cancellation reason card in order detail;
  - clear next action: change address, contact support or browse available areas.
- Never show a countdown or estimated arrival based on customer-device location.
- Never blame the customer for an address that the app accepted.

## 11. Implementation plan

### Phase 0 — repository and design foundations

- Add/repair design tokens for colour, type, radius, shadow and spacing.
- Consolidate on one green; remove violet and rainbow category accents.
- Replace arbitrary account greys with tokens.
- Establish a type floor and a small, documented type scale.
- Add shared `Button`, `Card`, `Badge`, `Input`, `Sheet`, `EmptyState` and `Skeleton` primitives.
- Add image guidelines and a responsive-image policy.
- Fix asset/preload mismatch.
- Document zone and cancellation language.

### Phase 1 — customer-facing quick wins

- Redesign header and homepage module order.
- Replace the primary carousel with one strong hero.
- Upgrade category tiles and product cards.
- Add Buy Again using existing order data.
- Use existing homepage modules for local-store trust; do not add a separate top-of-home strip. Add a subscription value block when the product supports it.
- Fix desktop/mobile nav icon mismatch.
- Fix category-tile navigation and promotional CTA handling.
- Align checkout to brand green and improve schedule/instruction hierarchy.
- Improve loading, empty and error states.

### Phase 2 — journey polish

- Checkout stepper and review state.
- Zone/serviceability reassurance in cart and checkout.
- Warm cancellation state in order detail.
- Push-notification copy guidelines.
- Desktop-specific layout.
- Motion and focus-state pass.
- Dark-mode consolidation only after light mode is stable.

### Phase 3 — structural improvements

- Content governance for homepage modules.
- Personalization and recommendation rules.
- Loyalty/gamification only if it fits the marketplace model.
- Hub design-system alignment.
- Customer analytics for module performance.

## 12. Non-goals for the first implementation

- No 8/10-minute delivery promises.
- No live ETA or rider tracking.
- No dark-store operational changes.
- No new payment gateway.
- No merchant commission changes.
- No order-lifecycle rewrite.
- No full mobile-app parity work.
- No Hub redesign beyond consistency fixes.
- No gamification or loyalty mechanics in Phase 0/1.
- No hidden fees or dark-pattern urgency.
- No commit, push or PR without explicit approval.

## 13. Acceptance criteria

- A new customer can identify the delivery area and service model without opening help.
- The homepage has one obvious primary message and no fabricated live ETA or store-confirmation claim.
- The same brand green is used across home, account, cart and checkout.
- Secondary text is at least 12 px and primary body text at least 14 px.
- Product cards have consistent image framing, readable pricing and a clear add control.
- Category tiles open the selected category, not the category root.
- Mobile and desktop navigation use consistent labels and icons.
- Checkout visibly explains zone, slot, fees and pay-on-delivery.
- Out-of-zone and cancellation states are warm, clear and actionable.
- The page remains usable at 390 px, 768 px and 1440 px widths.
- No regression in existing cart, order, login, PWA, zone or checkout behaviour.
- Lint, type-check and existing tests pass before any merge request.

## 14. Open questions for confirmation

1. Confirm the feature branch name: `feature/customer-ux-refresh`.
2. Confirm the main backup branch name: `backup/main-20261026`.
3. Confirm whether the local `main` branch should be updated from `origin/main` (local `main` is stale).
4. Confirm whether the backup branch should be pushed to `origin`.
5. Confirm whether Phase 0 and Phase 1 should be implemented together or as separate commits.
6. Confirm the final brand direction: deep green plus warm cream plus saffron accent.
7. Confirm whether dark-mode work is deferred.
8. Confirm whether any existing promotional campaign artwork must be preserved exactly.
9. Confirm the preferred tone for out-of-zone cancellation copy.
10. Confirm that no backend or order-lifecycle changes are included in the first implementation.

## 15. Confirmation gate

Repository preparation is complete only when:

- this document exists;
- `backup/main-20261026` exists from `origin/main`;
- `feature/customer-ux-refresh` exists from `origin/develop`;
- the working tree state is understood and preserved;
- no customer-facing code has changed.

At that point, stop and request final confirmation before editing application code.


## 16. Implementation progress — 2026-10-26

Branch: `feature/customer-ux-refresh`  
Backup: `backup/main-20261026`  
Commit status: no commit, push or pull request yet.

Completed in the working tree:

- Brand tokens: Gokez green 50–950, warm cream canvas, ink, saffron, card shadows and type tokens.
- Shared primitives: `Button`, `SectionHeading`, `Badge`, `ProductCardSkeleton`.
- Header: brand-green shell, clearer delivery-area label, consistent desktop icons and active states.
- Mobile nav: correct `/fresh-veg.webp` asset, brand active state and clearer tap targets.
- Home: warmer search field, category grid wired to the selected category, shared section headings and branded loading skeletons.
- Home modules: banner/category CTAs now call the app category selector instead of dispatching an unhandled event.
- Buy Again: the existing recent-order component is now mounted on Home with brand styling.
- Checkout: added a delivery-area reassurance strip using the selected zone.
- Product cards: cream packshot frame, consistent `object-contain` imagery, branded fallback, clearer name/unit/price hierarchy and accessible card interaction.
- Checkout: brand-green schedule, offer and instruction panels; delivery copy keeps the existing customer-selected 10–15 min / scheduled options.
- Orders: restored the existing 10–15 / ~30 min preference labels and removed store-confirmation wording.
- Account/About/login/cart: brand-green controls, cream surfaces, WebP brand logo and tokenised text/borders.
- Assets: converted `f1.png`–`f4.png` to WebP, removed the unused PNGs and the unused 243 KB `fresh_icon.webp`; fixed the footer/account/About brand image to `/mart_brand_new.webp`.

Verification:

- `npm run build --workspace=mart-user` passes, including 19 SEO gate checks.
- `npm test --workspace=mart-user` passes: 65 tests.
- `git diff --check` passes.

Still pending for Phase 1:

- Subscription value block (no subscription product exists yet, so this needs a product decision).
- Desktop-specific layout pass.
- Out-of-zone popup behaviour and cancellation flow changes (need explicit approval because they touch logic).
- Visual regression pass at 390 px, 768 px and 1440 px.
