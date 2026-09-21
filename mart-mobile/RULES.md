# Gokez Mart Mobile — Development Rules

## Stack
- React Native 0.81+ with Expo SDK 54
- Expo Router v6 (file-based routing — same as mobility-parent)
- TypeScript strict mode
- Zustand (state management)
- Axios (API calls — same as mart-user)
- NativeWind v4 (Tailwind for React Native)
- Expo Notifications (push — replaces web push)
- Expo SecureStore (token storage)
- EAS Build (cloud builds — no Android Studio / Xcode needed)

---

## Project Structure

```
mart-mobile/
├── app/
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── login.tsx          # Phone input + OTP
│   │   └── setup-profile.tsx  # Name + address (new customers)
│   ├── (tabs)/
│   │   ├── _layout.tsx        # Bottom tab navigator
│   │   ├── index.tsx          # Home — products grouped by category
│   │   ├── categories.tsx     # Category browser
│   │   ├── orders.tsx         # Order history (current + past tabs)
│   │   └── profile.tsx        # Profile + settings
│   ├── product/[id].tsx       # Product detail sheet
│   ├── cart.tsx               # Cart screen
│   ├── checkout.tsx           # Checkout
│   ├── order/[id].tsx         # Order tracking
│   └── _layout.tsx            # Root layout
├── components/
│   ├── ui/                    # Base: Button, Input, Card, Badge
│   └── features/              # ProductCard, CartItem, OrderCard etc.
├── services/
│   └── api.ts                 # Same endpoints as mart-user
├── store/
│   ├── cartStore.ts           # Ported from mart-user
│   ├── authStore.ts           # Customer OTP auth
│   └── themeStore.ts
├── constants/
│   ├── theme.ts               # Colors, spacing, typography
│   └── config.ts              # API URL, app config
├── hooks/                     # Custom hooks
├── utils/                     # Helpers
├── app.config.js
├── eas.json
├── RULES.md
└── PLAN.md
```

---

## Coding Rules

### TypeScript
- Strict mode always — no `any`
- All API responses typed with interfaces
- All component props typed

### Components
- Functional only, one per file, PascalCase filename
- Max 150 lines — split if larger
- No inline styles — NativeWind classes or StyleSheet only
- No hardcoded colors — use `constants/theme.ts`

### API Layer
- All calls through `services/api.ts`
- Env var: `EXPO_PUBLIC_API_URL`
- Same endpoints as mart-backend — no new endpoints without backend change
- Axios interceptor injects auth token from SecureStore
- Always handle loading / error / success states

### State
- Zustand for global (cart, auth, theme)
- Local useState for component-level only
- Auth token → Expo SecureStore (never AsyncStorage)
- Cart → AsyncStorage (persisted)

### Navigation
- Expo Router only — no React Navigation directly
- Protected routes via `(auth)` group
- Unauthenticated → redirect to `/(auth)/login`

### Lists
- Always FlatList — never ScrollView + map
- keyExtractor always provided
- getItemLayout for fixed-height lists

### Images
- expo-image for all images (lazy, cached)
- Always provide width + height or aspectRatio

### Push Notifications
- Expo Notifications (not web push API)
- Same backend endpoint: `POST /push/subscribe/customer`
- Ask permission after first successful order only
- Never ask on app launch

### Security
- Token in Expo SecureStore only
- No sensitive data in AsyncStorage
- No console.log in production builds

### Error Handling
- Every API call in try/catch
- User-friendly messages — no raw API errors
- Offline state handled with NetInfo

---

## Brand & Design

### Colors
```ts
export const colors = {
  primary:     '#10b981',  // emerald-500
  primaryDark: '#065f46',  // emerald-900
  yellow:      '#FED102',  // brand yellow
  amber:       '#E8960A',  // deep amber (Gokez text)
  bgLight:     '#f0fdf4',  // light green background
  bgDark:      '#18191a',  // Facebook dark
  cardDark:    '#242526',  // Facebook dark card
  white:       '#ffffff',
  black:       '#111827',
};
```

### Typography
- Font: Inter
- xs=12, sm=14, base=16, lg=18, xl=20, 2xl=24, 3xl=30
- Weights: 400/500/600/700

### Spacing (4px grid)
- xs=4, sm=8, md=12, lg=16, xl=20, 2xl=24, 3xl=32, 4xl=48

### Border Radius
- sm=8, md=12, lg=16, xl=20, 2xl=24, full=9999

---

## Shared with mart-user (reuse directly)

| What | How |
|---|---|
| API endpoints | Copy `services/api.ts`, change axios base |
| Cart logic | Port `cartStore.ts` to RN AsyncStorage |
| Auth logic | Port `customerAuthStore.ts` to SecureStore |
| Business rules | Delivery charge calc, free delivery threshold |
| Order status labels | Copy STATUS_LABELS constants |

## What is NOT shared (needs RN rewrite)

| What | Why |
|---|---|
| All UI components | HTML → React Native View/Text/TouchableOpacity |
| CSS/Tailwind | NativeWind classes (similar but RN-specific) |
| Web push | Expo Notifications |
| localStorage | AsyncStorage / SecureStore |
| window/document | Not available in RN |

---

## Git Rules
- Always branch from `feature/mart_mobile_app`
- Commit format: `feat:` / `fix:` / `chore:` / `screen:`
- Never commit `.env` or `google-services.json`
- Never touch `mart-user`, `mart-hub`, `mart-backend`

## EAS Build
```
App ID:        com.gokez.mart
Bundle ID:     com.gokez.mart
App Name:      Gokez Mart
```

```bash
# Development build
eas build --profile development --platform android

# Preview APK (share for testing)
eas build --profile preview --platform android

# Production
eas build --profile production --platform all
```

## Environment Variables
```
EXPO_PUBLIC_API_URL=https://api.mart.gokez.com/api/v1
```

## DO NOT
- ❌ Wrap mart-user in WebView — build native screens
- ❌ Duplicate backend logic — use mart-backend as-is
- ❌ Use React Navigation directly — Expo Router only
- ❌ Store tokens in AsyncStorage
- ❌ Add inline styles
- ❌ Skip TypeScript types
- ❌ Touch mart-user / mart-hub / mart-backend
- ❌ Add new backend endpoints without updating mart-backend first
