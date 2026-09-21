# Gokez Mart Mobile — Build Plan

## Decisions (confirmed)
- App name: **Gokez Mart**
- App ID: **com.gokez.mart** (no Capacitor)
- Primary tabs: **Home · Categories · Orders · Profile**
- Design reference: Zepto / Blinkit (product card ADD on image, floating cart pill, split-view categories)
- Stack: Expo SDK 54 + Expo Router v4 + NativeWind v4 + Zustand + Axios

---

## Phase 1 — Scaffold ✅ DONE

| File | Status |
|------|--------|
| `package.json` | ✅ |
| `app.config.js` | ✅ |
| `eas.json` | ✅ |
| `babel.config.js` | ✅ |
| `tailwind.config.js` | ✅ |
| `tsconfig.json` | ✅ |
| `global.css` | ✅ |
| `.gitignore` | ✅ |
| `.env.example` | ✅ |
| `constants/theme.ts` | ✅ |
| `constants/config.ts` | ✅ |
| `services/api.ts` | ✅ Ported from mart-user |
| `store/authStore.ts` | ✅ SecureStore |
| `store/cartStore.ts` | ✅ AsyncStorage |
| `store/themeStore.ts` | ✅ |

## Phase 2 — Core Screens ✅ DONE

| Screen | Status |
|--------|--------|
| `app/_layout.tsx` | ✅ Root layout, font load, auth hydrate |
| `app/(auth)/_layout.tsx` | ✅ Redirect if logged in |
| `app/(auth)/login.tsx` | ✅ Phone + OTP |
| `app/(auth)/setup-profile.tsx` | ✅ Name + address |
| `app/(tabs)/_layout.tsx` | ✅ 4-tab bottom nav |
| `app/(tabs)/index.tsx` | ✅ Home — carousel + horizontal category rows |
| `app/(tabs)/categories.tsx` | ✅ Split-view sidebar + grid |
| `app/(tabs)/orders.tsx` | ✅ Active/Past tabs, status badges |
| `app/(tabs)/profile.tsx` | ✅ Inline edit, logout |
| `app/checkout.tsx` | ✅ Unified cart + address, delivery pref, offers, bill, place order (Zepto-style single screen) |
| `app/order/[id].tsx` | ✅ Status stepper, items, bill, 30s poll |

## Phase 3 — Components ✅ DONE

| Component | Status |
|-----------|--------|
| `components/features/ProductCard.tsx` | ✅ Zepto-style ADD on image |
| `components/features/CartPill.tsx` | ✅ Floating green pill |
| `components/features/HomeCarousel.tsx` | ✅ Auto-scroll, dots |

---

## Phase 4 — Remaining (next sessions)

### Screens
- [ ] `app/product/[id].tsx` — Product detail bottom sheet (weight options, description)
- [ ] `app/(auth)/setup-profile.tsx` — Already done ✅

### Features
- [ ] Push notifications — register after first order (Expo Notifications)
- [ ] Offline banner — NetInfo
- [ ] Campaign / coupon code on checkout
- [ ] Feedback screen after delivery
- [ ] Delete account flow
- [ ] Privacy / Terms screens (WebView or static)

### Polish
- [ ] Skeleton loaders (replace ActivityIndicator)
- [ ] Haptic feedback on ADD/remove
- [ ] Empty state illustrations
- [ ] Dark mode (themeStore wired to NativeWind `dark:` classes)
- [ ] App icon + splash screen assets

### Build
- [ ] `eas build --profile preview --platform android` — first APK
- [ ] Replace `YOUR_EAS_PROJECT_ID` in `app.config.js` after `eas init`

---

## First-run setup

```bash
cd mart-mobile
npm install
cp .env.example .env

# Install Expo CLI + EAS CLI globally if not already
npm install -g expo-cli eas-cli

# Init EAS (one-time)
eas init

# Start dev server
npx expo start

# Build preview APK
eas build --profile preview --platform android
```

## Assets needed (add to assets/)
- `icon.png` — 1024×1024
- `splash.png` — 1284×2778
- `adaptive-icon.png` — 1024×1024
- `notification-icon.png` — 96×96 (white on transparent)
- `fonts/Inter-Regular.ttf`
- `fonts/Inter-Medium.ttf`
- `fonts/Inter-SemiBold.ttf`
- `fonts/Inter-Bold.ttf`

Inter font: https://fonts.google.com/specimen/Inter (download TTF)
