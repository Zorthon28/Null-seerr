# Living Room TV Setup & Streaming Guide

This guide walks you through setting up and optimizing media playback on your Living Room TV, Streaming Sticks, and Home Theater devices using **null-arr-stack**.

---

## 1. Network Preparation & Server IP

Your media server runs directly from your PC or host machine. To stream to devices in your home:
1. Ensure your TV or streaming stick is connected to the **same local Wi-Fi or Ethernet network** as your server.
2. Find your Server's Local IP Address:
   - **Windows**: Open PowerShell or Command Prompt and type:
     ```powershell
     ipconfig
     ```
     Look for `IPv4 Address` under your active adapter (typically `192.168.1.xxx` or `192.168.0.xxx`).
   - **Linux / macOS**: Run:
     ```bash
     hostname -I
     ```

> [!TIP]
> **Windows Firewall Note**: If your TV cannot discover or reach the PC, allow Jellyfin and Plex through Windows Firewall by running this once in PowerShell (Administrator):
> ```powershell
> New-NetFirewallRule -DisplayName "Null-seerr Media Stack" -Direction Inbound -LocalPort 8096,32400 -Protocol TCP -Action Allow
> ```

---

## 2. Recommended TV Apps by Device

| Device | Best Option | Alternative Option |
| :--- | :--- | :--- |
| **Onn TV 4K / Google TV / Android TV** | **Jellyfin for Android TV** | **Plex** or **Kodi + Jellycon** |
| **Amazon Fire TV Stick / Cube** | **Jellyfin for Android TV** | **Plex** |
| **Apple TV 4K** | **Plex** or **Swiftfin** | **Infuse** |
| **Roku / LG webOS / Samsung Tizen** | **Plex** | **Jellyfin (webOS/Roku store)** |

---

## 3. Option A: Jellyfin Android TV (Recommended)

The official Jellyfin Android TV app is free, open source, and natively supports multi-user profiles and direct stream playback.

### Step 1: Install the App
- Open the **Google Play Store** (or Amazon Appstore on Fire TV).
- Search for **Jellyfin for Android TV** and install it.

### Step 2: Connect to Your Server
- Open the Jellyfin app.
- When prompted for the Server Address, enter:
  ```text
  http://<YOUR-PC-IP>:8096
  ```
  *(Example: `http://192.168.1.50:8096`)*
- Enter your admin credentials:
  - **Username**: `admin`
  - **Password**: Your Master Password (stored in `C:\arr-stack\CREDENTIALS.txt`).

### Step 3: Crucial Performance & Subtitle Sync Setting
> [!IMPORTANT]
> To prevent audio/subtitle desync and avoid unnecessary video transcoding on TV devices:
> 1. In the Jellyfin TV app, click the **Gear Icon** (Settings) in the top right.
> 2. Navigate to **Client Playback Settings** -> **Media Player**.
> 3. Change the preferred player from **ExoPlayer** to **LibVLC**.
> 4. Set **Audio Output** to **Direct**.
> 
> *Result: All MKV/MP4 files with embedded and external subtitles will Direct-Play instantly with zero lag or buffer delays.*

---

## 4. Option B: Plex Media Server (Turnkey Direct Play)

If your stack was launched with `--profile plex` or `docker compose --profile all up -d`:
1. Install the **Plex** app from your TV's app store.
2. Sign in with your Plex account or link your TV code at `https://plex.tv/link`.
3. Your TV will automatically discover your server on the local network.
4. All Movies, TV Shows, and Anime libraries will appear on the home screen ready to stream.

---

## 5. Option C: Kodi + Jellycon (Fastest for Budget / Older TV Sticks)

For ultra-budget hardware (older Fire TV sticks, low-spec streaming boxes) where native apps may feel sluggish, **Kodi with the Jellycon addon** offers the highest possible rendering performance.

### Step 1: Install Kodi
- Install **Kodi** from the Google Play Store on your TV device.

### Step 2: Add the Official Jellyfin Repository
1. Open Kodi and navigate to **Settings** (Gear icon) -> **File Manager** -> **Add source**.
2. Click `<None>` and carefully type the URL:
   ```text
   https://kodi.jellyfin.org
   ```
   *(Be sure to use `.org`, not `.com`)*
3. Name the source `Jellyfin` and click **OK**.

### Step 3: Install the Jellycon Addon
1. Go back to Kodi Settings -> **Add-ons** -> **Install from zip file**.
2. Select **Jellyfin** -> `repository.jellyfin.kodi.zip`.
3. Select **Install from repository** -> **Kodi Jellyfin Addons** -> **Video add-ons** -> **Jellycon** -> **Install**.
4. Jellycon will automatically detect your local Jellyfin server on port `8096`. Click your server, choose user `admin`, and enter your stack password.

---

## 6. Managing Subtitles from the Couch

null-arr-stack automatically downloads dual English and Spanish subtitles via Bazarr upon media acquisition. You can also search and download subtitles on-demand straight from your TV remote:

1. During media playback, press **Down** or **OK** on your remote to bring up the on-screen player controls.
2. Click the **Subtitles Icon** (or Audio/Subtitles menu).
3. If your preferred subtitle is not already active:
   - Select **Search for Subtitles** / **Download Subtitles**.
   - Jellyfin's rotating OpenSubtitles API pool will instantly fetch the best matching community subtitles without rate limits.
   - Choose the subtitle track to immediately apply it without restarting playback.

---

## 7. Troubleshooting Living Room Streaming

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **"Could not connect to server"** | PC is asleep or blocked by Windows Firewall | Ensure PC power mode is active (`setup.ps1` disables standby idle automatically). Run the Windows Firewall rule in Section 1. |
| **Playback stops after 15–30 minutes** | Windows idle sleep timer kicked in | Verify `power_guard.pyw` is active in Task Manager, or run `powercfg /change standby-timeout-ac 0` in PowerShell. |
| **Subtitle text is delayed or out of sync** | Default TV player handling timing offsets | Switch media player engine to **LibVLC** in Jellyfin TV App Settings -> Playback. |
| **Video keeps buffering or transcoding** | TV Wi-Fi signal or bitrate limit | Connect TV stick to 5 GHz Wi-Fi band or Ethernet adapter. In Jellyfin TV app Settings, ensure Home Streaming Quality is set to **Maximum / Direct Play**. |
