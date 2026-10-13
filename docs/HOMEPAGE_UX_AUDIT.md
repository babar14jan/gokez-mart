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
