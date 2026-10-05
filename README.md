# BharatWatch device health

This safety upgrade replaces the disguised Android monitoring agent with a visible, consent-based health reporter. It shares battery level, screen-on state and online status only. It has a launcher entry, explicit consent dialog, persistent disclosure notification and Stop controls. It never starts on boot or restarts after dismissal. Remote screenshots, camera capture, browser/app history collection, device locking and app blocking are removed from the agent and rejected by the server.

## Security rollout

Treat credentials from the old public source or APKs as exposed. **Generate and deploy new dashboard and agent credentials, then restart the server to revoke all sessions.** Updating source does not rotate deployed secrets or erase Git history. Deactivate the old app's Device Administrator/Accessibility permissions and remove the old install before testing this replacement. Install with the device owner's knowledge and agreement.

## Server

Use Node 22 or newer. Run `npm ci`, copy `.env.example` to `.env`, then set a unique `DASHBOARD_PIN` passphrase (at least 12 characters) and a separate random `AGENT_KEY` (at least 32 characters). For example, `openssl rand -hex 32` generates a token. Missing, weak or known placeholder credentials prevent startup. No credentials are logged. Run `npm start` behind HTTPS/WSS with a trusted reverse proxy. The dashboard input retains the historical `pin` field name but now requires a passphrase. Login permits five attempts per socket IP per five minutes; proxy deployments should add trusted-edge rate limiting. Sessions expire after 24 hours in both HTTP and WebSocket paths; logout/expiry also closes open dashboard connections within 30 seconds.

## Android build

Use JDK 17 and Android SDK 34. Supply `BHARATWATCH_SERVER_URL` (`wss://your-host/ws/agent`) and `BHARATWATCH_AGENT_KEY` through your build environment, then run `bash gradlew assembleDebug` in `android-agent`. Empty configuration builds an app that refuses to start sharing. Credentials are no longer committed, but a credential embedded in an APK can still be extracted: distribute carefully, use a dedicated server for each enrolled device, and rotate on revocation. Per-device enrollment/credential revocation is a future improvement.

Generated Gradle/build files and local machine configuration are removed from the tracked tree. The Gradle wrapper remains. No Git history is rewritten. The dashboard now displays only device health and accepts passphrases. It keeps its token in memory and polls authenticated status; signing out revokes the session. Existing historical database data is retained for owner-controlled cleanup; define a deliberate retention policy before rollout.

## Validation

`npm run check` checks server syntax and tests missing/weak credentials, constant-time comparison, rate limiting and shared session expiry. CI also builds the Android debug app. Runtime tests on Android 11–14, notification Stop behavior, HTTPS reverse proxy configuration and live credential rotation remain required before rollout. No device monitoring or live server was started during this change.
