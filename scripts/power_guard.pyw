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

def get_qbittorrent_url():
    url = os.environ.get("QBITTORRENT_URL")
    if url:
        return url.rstrip("/")
    port = os.environ.get("QBIT_WEBUI_PORT", "8089")
    return f"http://localhost:{port}"

def get_jellyfin_url():
    url = os.environ.get("JELLYFIN_URL")
    if url:
        return url.rstrip("/")
    port = os.environ.get("JELLYFIN_PORT", "8096")
    return f"http://localhost:{port}"

def check_qbittorrent_active():
    """
    Returns True if qBittorrent has active downloads or high-speed activity.
    FAIL-SAFE: If the status cannot be verified (e.g. 401/403 auth required,
    connection timeout, or server error), returns True to prevent sleeping during active downloads.
    """
    if os.environ.get("DISABLE_QBIT_CHECK", "0") == "1":
        return False

    base_url = get_qbittorrent_url()
    url = f"{base_url}/api/v2/torrents/info?filter=downloading"
    headers = {"User-Agent": "NullSeerrPowerGuard/1.0"}
    cookie = os.environ.get("QBITTORRENT_COOKIE")
    if cookie:
        headers["Cookie"] = cookie

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                return len(data) > 0
            # Non-200 status code (e.g. 401/403/500): fail-safe
            return True
    except urllib.error.HTTPError:
        # HTTP 401 Unauthorized / 403 Forbidden etc.: fail-safe to keep host awake
        return True
    except Exception:
        # Network/timeout error: fail-safe
        return True

def check_jellyfin_active():
    """
    Returns True if any client is currently playing media on Jellyfin.
    FAIL-SAFE: If the status cannot be verified (e.g. 401/403 auth required,
    connection timeout, or server error), returns True to prevent sleeping during active playback.
    """
    if os.environ.get("DISABLE_JELLYFIN_CHECK", "0") == "1":
        return False

    base_url = get_jellyfin_url()
    url = f"{base_url}/Sessions"
    headers = {"User-Agent": "NullSeerrPowerGuard/1.0"}
    token = os.environ.get("JELLYFIN_API_KEY") or os.environ.get("JELLYFIN_TOKEN")
    if token:
        headers["X-MediaBrowser-Token"] = token

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            if resp.status == 200:
                sessions = json.loads(resp.read().decode("utf-8"))
                for s in sessions:
                    if s.get("NowPlayingItem") is not None:
                        return True
                return False
            # Non-200 status code: fail-safe
            return True
    except urllib.error.HTTPError:
        # HTTP 401 Unauthorized / 403 Forbidden etc.: fail-safe to keep host awake
        return True
    except Exception:
        # Network/timeout error: fail-safe
        return True

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
