# Gokez MART Homepage UX Audit & Improvement Proposal

## Part 1 — Existing Implementation

### Current Render Order (mart-user/src/App.tsx)
- View router (path-based: home, categories, deals, orders, account, privacy, terms, grievance, delete-account, feedback)
- Session init (track session_start)
- Zone/store state from zoneStore; activeStoreId drives catalog/homeSections/settings
- Silent/periodic catalog refresh; loading/error states
- Header (Navbar) + StoreStatusStrip
- Home view body (when no search/category filter active): HomeCarousel, category pills, BuyAgain (logged-in with history), resolvedHomeSections (HomeSections), fallback category groups
- Search/filter path: flat grid of filtered products
- BottomNav (Home, Vegetables, Orders, Account)

### Key Components
- Navbar (components/Navbar.tsx): logo+brand, zone dropdown/use-my-location, dark toggle, desktop nav (Home, Vegetables, Orders, Account, Cart), mobile search (hidden on categories/orders/account), bottom border
- BottomNav (components/BottomNav.tsx): Home, Vegetables, Orders, Account (icon+label, active indicator)
- HomeCarousel (components/HomeCarousel.tsx): fetches /carousel (campaignApi.getCarousel), slides (images or gradient), campaign overlay (badge, discount label, coupon copy or auto-applied), swipe/touch, auto-rotate
- HomeSections (components/HomeSections.tsx): configurable sections from backend (top_picks "Store Favourites", todays_combos, fresh_vegetables, deals); resolves live products; layout defaults (combos/top_picks row by default after UX tweak), 2-col grid fallback for combos/top_picks if grid, row with larger cards for row
- BuyAgain (components/BuyAgain.tsx): logged-in only; pulls last orders via authApi.getOrders, maps to live products, shows only if >=2 matches; excludes hidden items
- ProductCard (components/ProductCard.tsx): image, discount badge, out-of-stock overlay, ADD/qty control, name (local+English), unit/approx weight, price/savings; opens ProductDetailSheet
- CategoriesView (components/CategoriesView.tsx): split/category-scoped browsing
- FloatingCart, CartQuantityControl, ProductDetailSheet, CheckoutPage

### Data Sources
- storeApi.getCategories(), getProducts(storeId?), getSettings(storeId), getHomeSections(storeId)
- campaignApi.getCarousel()
- authApi.getOrders() (BuyAgain)
- Home sections resolved live from catalogue (no product duplication in section config storage) — top_picks may be hand-picked productIds or auto-filled with bestsellers by backend when empty

### Functionality Notes
- Store hours gating: StoreStatusStrip + closed-order dialog; checkout blocked while closed (App-level gate)
- Zone-based store switching; filters reset on zone change
- PWA-first (service worker, manifest, install prompt) but not forced before browsing
- Search takes priority: on home, mobile search focus hides carousel/category pills; desktop has search box
- View is path-based (no react-router in mart-user); BottomNav sets view
- "Vegetables" is already used in BottomNav (not "Category")

## Part 2 — Key Findings

### Verified
- Bottom nav labels: Home, Vegetables, Orders, Account — matches proposed clarity for vegetables-only
- Home sections are dynamic (backend-configured) with sensible fallbacks
- BuyAgain is properly scoped to logged-in + has history; filters to live/available
- Carousel is data-driven from /carousel; campaign badges/coupons supported
- Closed store UX exists (strip+dialog)
- Mobile search UX hides discovery blocks when focused (prevents clutter)

### Opportunities / Potential Issues
- Top Picks named "Store Favourites" in backend/migrations/UI text in places; consider "Top Picks" for customer-facing clarity
- Section duplication: a product in a combo (todays_combos) could also appear in BuyAgain, Top Picks, or Deals — frontend doesn't deduplicate across sections; can feel repetitive
- Deals section shows all discounted products (biggest discount first) — good, but no "View All" special handling beyond categories/deals; deals has its own DealsPage
- Fresh Vegetables section exists but can be omitted if catalog browsing via Vegetables tab is primary
- Category pills show only categories that have products; fine for vegetables-only
- ProductCard name formatting changed recently (local name in parentheses) — compact but may truncate on small screens

### Unknowns (require verification)
- Whether carousel targeting by customer state (first-time vs returning) is enforced beyond generic slides (API returns carousel items; eligibility rules may live in campaigns)
- Exact stock/availability semantics for combos (bundle components deduct inventory) — affects whether combo items can be "orderable" individually in other sections
- Whether backend prevents showing expired campaigns in carousel

## Part 3 — Proposed Homepage Structure (Mobile-first)

Recommended order (top → bottom) with rationale:
1. Header (existing Navbar): zone selector, logo, theme, search on desktop. Mobile: search in row2 when not in account/orders/categories.
2. Store status (existing): closed/open strip above content.
3. Hero/Carousel (HomeCarousel): promotions, new arrivals, offers; auto-rotate, swipeable. Hide when actively searching on mobile.
4. Category quick access (existing category pills): fast jump to specific vegetable groups. Hide on search.
5. Today's Combos (todays_combos row): high-value bundles; horizontal scroll for discovery. Keep row layout.
6. Best Deals (deals row/grid): discounts first. Horizontal scroll on mobile.
7. Order Again (BuyAgain row): "Your Usuals"; only visible to logged-in users with >=2 valid items. Builds habit.
8. Top Picks (top_picks row): curated favourites; horizontal row as implemented.
9. Fresh Vegetables (fresh_vegetables): optional; could be removed if categories tab is primary path, or kept as a featured subset (grid of 6-8 items) with "View All".
10. Footer-like safety (optional): delivery area note, store hours, support link — minimal on mobile.

Notes: "Store Favourites" → "Top Picks" customer-facing label (UI text) while backend key unchanged; reduce cross-section duplication by preferring bundles/combos over individual components when both visible.

## Part 4 — Customer-State Visibility Matrix

| State | Carousel | Combos | Deals | BuyAgain | Top Picks | Category Pills | Empty Treatment |
|---|---|---|---|---|---|---|---|
| Anonymous, first-time | Generic welcome/promos | Show | Show | Hidden | Show (fallback bestsellers) | Show | "No products found" / empty states as is |
| Logged-in, no previous orders | Generic/promos | Show | Show | Hidden (needs history) | Show | Show | Friendly prompts (browse categories) |
| Logged-in, 1-2 orders | Relevant (optional) | Show | Show | Hidden (<2 valid) | Show | Show | As is |
| Logged-in, repeat with history (>=2) | Personalized? | Show | Show | Visible (Your Usuals) | Show | Show | As is |
| Logged-in, frequent | Personalized | Show | Show | Prominent | Show | Show | As is |
| Store closed | Status strip | Still visible? (browse-only) | Visible | Visible | Visible | Visible | Closed overlay blocks checkout |
| No promos | Fallback slides | Show | Maybe sparse | Per state | Show | Show | Graceful |

Recommendation: keep visibility simple and consistent; avoid heavy personalization unless campaign/sections support it cleanly.

## Part 5 — Bottom Nav: Category vs Vegetables
Current: Home, Vegetables (LayoutGrid), Orders, Account. Proposal: keep as-is. "Vegetables" matches the vegetables-only catalogue (avoids generic "Categories"). Icon choice (LayoutGrid) is fine. Behaviour: same as categories view; active state consistent.

## Part 6 — Prioritized Improvements

| Priority | Improvement | Frontend | Backend | Effort | Risk | Rationale |
|---|---|---|---|---|---|---|
| P0 | Dedupe products across sections (optional flag: excludeFromOtherSections for combo items) | X | X (section config or resolution) | M | Low-Med | Avoids repetition (combo contains same SKU as Deals/Top Picks). Could filter out product IDs that appear in an active combo bundle from other sections (configurable). |
| P0 | Rename customer-facing "Store Favourites" → "Top Picks" in Hub labels where shown to customers and in UI strings; keep internal key | X (Hub/User strings) | X (labels) | S | Low | Clarity per UX request. Data keys remain stable. |
| P1 | Add "View All" for Deals, Top Picks, Combos to jump to filtered views | X | — | S | Low | Better discovery on long rows. Deals already has DealsPage. |
| P1 | Section empty states (when resolved empty): show "No items yet" with CTA to Categories | X | — | S | Low | Prevents blank gaps. |
| P1 | Optimize carousel image loading (LCP): lazy load non-active slides, prefetch next, use WebP/AVIF, aspect ratio consistent | X | — | S | Low | Performance on mobile networks. |
| P2 | Hide Fresh Vegetables section if redundant with Vegetables tab (toggle in admin) | X | X (section config/enable) | S-M | Low | Simplify homepage for some stores. |
| P2 | Analytics (view/click) for sections/carousel (non-blocking) | X | X (optional events) | M | Low | Measure which sections drive orders. |
| P3 | Skeleton loaders for BuyAgain/HomeSections (avoid layout shift) | X | — | S | Low | Polish. |

## Part 7 — Visual/Spec Guidance
- Section headers: text-sm font-semibold uppercase tracking-wider, mb-2.5, with optional "View All" link text-xs
- Row sections (combos, deals, buyagain, top_picks): horizontal scroll (overflow-x-auto), gap-2.5, pb-1, hide scrollbar, snap-x optional
- Grid sections: gap-2.5, grid-cols-2 (mobile) or grid-cols-3 (sm)
- Card widths (row): keep w-[42%] min-w-[140px] sm:w-[170px] md:w-[190px] for Top Picks as implemented (consistent across row sections)
- Carousel: 16/9 mobile, 16/6 or 21/9 desktop; rounded-2xl, shadow-md; campaign text centered, tappable coupon
- Spacing rhythm: mt-4 mb-4 between major blocks on home (matches current App.tsx)
- Dark/light: follow existing tokens; section headers use text-gray-500 dark:text-slate-400
- Accessibility: alt text on carousel images, aria-label on section View All, focus states preserved

## Part 8 — Staged Roadmap
Stage 1 (Safe, no schema): Fix customer-facing labels ("Store Favourites"→"Top Picks"), add View All links, section empty states, minor performance tweaks (carousel prefetch/lazy). Build+typecheck+tests.
Stage 2 (Configurable): Add dedupe/visibility rules (exclude combo items from others) behind flags if needed; admin toggle for Fresh Vegetables.
Stage 3 (Analytics/personalization): Track interactions, experiment with ordering if data supports.

## Part 9 — Approval Checklist
- [ ] Confirm section order (especially Fresh Vegetables vs Categories)
- [ ] Approve "Store Favourites" → "Top Picks" rename scope (Hub labels only or also in migrations copy?)
- [ ] Approve deduplication strategy (which sections take precedence: combos > deals > top_picks > buyagain)
- [ ] Approve View All destinations per section
- [ ] Confirm row card sizing consistency across all row sections

## Summary
Homepage is well-structured for vegetables-only PWA. Key refinements: dedupe cross-section items, clarify labels (Top Picks), add View All + empty states, optimize carousel loading. Bottom nav "Vegetables" is appropriate as-is. No breaking changes proposed; all suggestions are incremental.

