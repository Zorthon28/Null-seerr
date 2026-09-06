"""
Null-seerr Host Power Guard Daemon (Windows)
--------------------------------------------
Monitors Null-seerr's `sleepOnIdleEnabled` setting, qBittorrent downloads,
and Jellyfin streaming sessions.

- When sleepOnIdleEnabled is OFF (Default):
    Holds the PC awake 24/7 so downloads and streams are never interrupted.
- When sleepOnIdleEnabled is ON:
    Keeps the PC awake as long as downloads or active media streams are running.
    Once the stack has been idle for the threshold (e.g. 15 minutes), releases
    the sleep lock so Windows enters low-power Sleep/Suspend mode.
    The Intel Wi-Fi card remains armed in WoWLAN to wake on demand via Magic Packet.
"""

import os
import sys
import time
import json
import urllib.request
import urllib.error
import ctypes

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_AWAYMODE_REQUIRED = 0x00000040

IDLE_TIMEOUT_SECONDS = 900  # 15 minutes of inactivity before allowing sleep
POLL_INTERVAL_SECONDS = 20

def set_execution_state(flags):
    try:
        return ctypes.windll.kernel32.SetThreadExecutionState(flags)
    except Exception:
        return 0

def get_settings_path():
    candidates = [
        os.path.join(os.environ.get("STACK_ROOT", "C:/arr-stack"), "config", "overseerr", "settings.json"),
        os.path.join("C:/arr-stack", "config", "overseerr", "settings.json"),
        os.path.join(os.path.dirname(__file__), "..", "arr-stack", "config", "overseerr", "settings.json"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]

def is_sleep_on_idle_enabled():
    path = get_settings_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return bool(data.get("main", {}).get("sleepOnIdleEnabled", False))
        except Exception:
            pass
    return False

def check_qbittorrent_active():
    """Returns True if qBittorrent has active downloads or active high-speed seeding."""
    try:
        url = "http://localhost:8089/api/v2/torrents/info?filter=downloading"
        req = urllib.request.Request(url, headers={"User-Agent": "NullSeerrPowerGuard/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if len(data) > 0:
                return True
    except Exception:
        pass
    return False

def check_jellyfin_active():
    """Returns True if any client is currently playing media on Jellyfin."""
    try:
        url = "http://localhost:8096/Sessions"
        req = urllib.request.Request(url, headers={"User-Agent": "NullSeerrPowerGuard/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            sessions = json.loads(resp.read().decode("utf-8"))
            for s in sessions:
                if s.get("NowPlayingItem") is not None:
                    # Media is currently playing
                    return True
    except Exception:
        pass
    return False

def main():
    currently_holding_awake = False
    idle_since = None

    # Initial state: hold awake until evaluated
    set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
    currently_holding_awake = True

    while True:
        try:
            sleep_enabled = is_sleep_on_idle_enabled()

            if not sleep_enabled:
                # User wants PC awake 24/7 (Power Management switch is OFF)
                if not currently_holding_awake:
                    set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
                    currently_holding_awake = True
                idle_since = None
            else:
                # Power Management switch is ON
                is_downloading = check_qbittorrent_active()
                is_streaming = check_jellyfin_active()

                if is_downloading or is_streaming:
                    # Active work detected! Hold PC awake
                    idle_since = None
                    if not currently_holding_awake:
                        set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
                        currently_holding_awake = True
                else:
                    # Stack is idle
                    now = time.time()
                    if idle_since is None:
                        idle_since = now

                    elapsed_idle = now - idle_since
                    if elapsed_idle >= IDLE_TIMEOUT_SECONDS:
                        # Release the lock: allow Windows to sleep
                        if currently_holding_awake:
                            set_execution_state(ES_CONTINUOUS)
                            currently_holding_awake = False

        except Exception:
            pass

        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
