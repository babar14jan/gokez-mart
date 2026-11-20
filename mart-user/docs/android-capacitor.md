# Gokez Mart customer Android app

This Android app wraps the existing customer frontend in `mart-user` with Capacitor 7. It is a separate customer app and does not use or modify `mart-mobile` / Smart Mobile.

## Build

Prerequisites:

- Node `20.15.0` or compatible Node 20.
- Android Studio with Android SDK platform 35 and build tools 35+.
- Java 21+; on this machine use Android Studio's bundled JBR.

From the repository root:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
VITE_API_URL="https://api.mart.gokez.com/api/v1" npm run apk:debug --workspace=mart-user
```

`VITE_API_URL` is required and is baked into the JS at build time. Without it the
app calls the frontend origin (`https://mart.gokez.com`) instead of the API and
shows no data. CI sets it in `.github/workflows/build-android.yml`; set it
explicitly for local builds (use a staging URL if testing against staging).

The debug APK is written to:

```text
mart-user/android/app/build/outputs/apk/debug/app-debug.apk
```

Other scripts in `mart-user/package.json`:

```bash
npm run cap:build --workspace=mart-user
npm run cap:open --workspace=mart-user
npm run cap:run --workspace=mart-user
```

`cap:build` runs the normal customer web build, then `cap sync android`.

## Application identity

- Application ID: `com.gokez.mart.customer`
- App name: `Gokez Mart`
- WebView origin: `https://mart.gokez.com`

The custom WebView hostname matches the production customer origin, so API calls use the same CORS origin as the website. Do not add `https://localhost` CORS exceptions for this app.

## Firebase Cloud Messaging setup

The native Android app needs a Firebase project. The production website/PWA web push setup is separate and remains unchanged.

1. Create or select a Firebase project.
2. Add an Android app with package name `com.gokez.mart.customer`.
3. Download the generated `google-services.json`.
4. Place it at:

```text
mart-user/android/app/google-services.json
```

5. Rebuild the APK.

The file is intentionally not committed. It is app configuration supplied by the Firebase project owner.

## Backend FCM token endpoints

Native push notifications are not operational until the backend exposes token registration and unregistration endpoints. The existing `/push/*` routes are Web Push/VAPID routes and do not accept FCM tokens.

Add these endpoints to the API and set the matching variables in the build environment:

```text
VITE_FCM_TOKEN_ENDPOINT=/push/register-fcm
VITE_FCM_TOKEN_UNREGISTER_ENDPOINT=/push/unregister-fcm
```

Relative paths are appended to `VITE_API_URL`.

Register request:

```http
POST {VITE_FCM_TOKEN_ENDPOINT}
Authorization: Bearer <customer token>
Content-Type: application/json

{
  "token": "<fcm registration token>",
  "platform": "android"
}
```

Unregister request:

```http
POST {VITE_FCM_TOKEN_UNREGISTER_ENDPOINT}
Authorization: Bearer <customer token>
Content-Type: application/json

{
  "token": "<fcm registration token>",
  "platform": "android"
}
```

Both endpoints should be idempotent. The backend should store one token per customer/device and remove stale tokens when FCM reports them as unregistered.

## Notification payload

Send an FCM notification payload with a data object containing an allowed customer route:

```json
{
  "notification": {
    "title": "Order updated",
    "body": "Your Gokez Mart order is out for delivery."
  },
  "data": {
    "type": "order_update",
    "route": "/orders"
  }
}
```

Allowed routes include `/`, `/orders`, `/deals`, `/referrals`, `/account`, `/categories`, `/login`, `/fresh`, `/about`, `/privacy`, `/terms`, `/grievance`, `/feedback`, `/delete-account`, `/what-is-gokez-mart`, and `/notification-settings`. Unknown or external links are ignored.

## Native notification behavior

- Android 13+ permission is requested from the existing notification opt-in prompt or the Account page toggle.
- On older Android versions the app registers when permission is already granted.
- The FCM token is cached locally and associated with the signed-in customer.
- Logging out disconnects the token from that customer. The next login re-associates it.
- Foreground notifications are displayed by the Capacitor push plugin.
- Background and closed-app notifications are displayed by FCM.
- Tapping a notification opens the allowed route in the customer app.

## PWA behavior

The production website and PWA are unchanged:

- Web Push/VAPID code in `src/services/push.ts` remains the browser path.
- Service worker registration is skipped inside the native Android WebView.
- Shared React views, routing, stores, assets, and API access continue to come from `mart-user`.
