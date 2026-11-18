# HELPDESK.AI — Android Mobile App (Expo SDK 54 / React Native)

> **Open Call to Contributors:** The Android APK is currently incomplete and inconsistent across screens, navigation, and release packaging. This repository is open for contributors to stabilize, redesign, and ship a production-ready Android APK!

## Current Gaps & Priority Areas

1. **Missing Expo / EAS App Entrypoints & Android Config**
   - Restore clean `app.json` (package `com.ritesh.helpdeskai`, adaptive icon, splash screen, permissions), `eas.json` (`preview_apk` & `production` APK profiles), root `index.js`, and `App.js` navigation container.
   - Remove legacy `@logrocket/react-native` runtime issues if unused or guard safely behind env config.
2. **Consistent UI/UX Parity with Mobile Web**
   - Unify design tokens (`src/styles/theme.js`) across Auth, User, and Admin screens (`#0b1f17` dark emerald hero headers, `#10b981` primary accent, `#f6f8f7` canvas, consistent spacing, safe-area insets, and bottom tab bar).
   - Fix keyboard handling (`KeyboardAvoidingView`), clipped headers, and inconsistent typography across Android aspect ratios (360dp to 430dp).
3. **End-to-End Auth, OTP Email Change & Ticket Flows**
   - Verify Supabase session persistence (`AsyncStorage`), role-based routing (`user` / `admin` / `master_admin`), and single-company `RITESH PVT LTD` signup/lobby alignment.
   - Complete ticket creation (text, voice/mic, image attachment + OCR), live ticket detail timeline, and status/priority updates.
4. **Reproducible Android APK Build Pipeline**
   - Support both local Gradle APK builds (`npx expo prebuild --platform android && cd android && ./gradlew assembleRelease`) and EAS cloud APK builds (`npx eas build --profile preview_apk --platform android`).
   - Add a GitHub Actions workflow to verify TypeScript/Jest tests and build debug/preview Android APKs automatically on PRs.

## Quick Local Setup

```bash
git clone https://github.com/riteshbonthalakoti/HELPDESK.AI.git
cd HELPDESK.AI/MobileApp
npm install
cp .env.example .env
```

Fill in `MobileApp/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
EXPO_PUBLIC_BACKEND_URL=https://helpdeskai1918.vercel.app
```

Run in development:

```bash
npx expo start
# Press 'a' for Android Emulator / connected USB device, or scan QR with Expo Go
```

Run tests:

```bash
npx jest
```

## Building a Standalone Android APK

### Option A — Local Gradle APK (no EAS account needed)

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
# Output: android/app/build/outputs/apk/release/app-release.apk
```

### Option B — Expo EAS Cloud APK

```bash
npx eas build --profile preview_apk --platform android
```

## Contributing & Claiming Issues

1. Browse open APK issues labeled **`mobile-apk`** and **`wocs`**:
   https://github.com/riteshbonthalakoti/HELPDESK.AI/issues?q=is%3Aissue+is%3Aopen+label%3Amobile-apk
2. Comment on the issue to claim it, fork the repo, and open a PR referencing `Closes #<issue-number>`.
3. Include **Android emulator/device screenshots or a short screen recording** and (for build issues) attach or verify a clean APK build.
