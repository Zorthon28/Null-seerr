"""
Null-seerr Host Power Guard Daemon (Windows)
--------------------------------------------
Monitors:
1. ARK Dedicated Server (ShooterGameServer.exe / UDP 27015)
2. Minecraft Fabric Server (Java fabric-server-launch.jar / TCP 25565)
3. qBittorrent active downloads & high-speed transfer
4. Jellyfin media playback sessions (/Sessions with API key)
5. Null-seerr's `sleepOnIdleEnabled` switch in settings.json

Policy:
- When sleepOnIdleEnabled is OFF (Default):
    Holds the PC awake 24/7 so gaming servers, downloads, and streams are never interrupted.
- When sleepOnIdleEnabled is ON:
    Keeps the PC awake continuously whenever ARK, Minecraft, qBittorrent downloads,
    or Jellyfin streams are ACTIVE.
    Once ALL services have been idle for 15 minutes, releases the execution lock
    and triggers low-power Sleep (S3 Standby).
    The Intel Wi-Fi card remains armed in WoWLAN to wake on demand via Magic Packet
    (Null-seerr UI or Jellyfin client).
"""

import os
import sys
import time
import json
import socket
import urllib.request
import urllib.error
import ctypes

try:
    import psutil
except ImportError:
    psutil = None

ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_AWAYMODE_REQUIRED = 0x00000040

IDLE_TIMEOUT_SECONDS = 900  # 15 minutes of Stack + Game Servers inactivity before sleep
POLL_INTERVAL_SECONDS = 20

def set_execution_state(flags):
    try:
        return ctypes.windll.kernel32.SetThreadExecutionState(flags)
    except Exception:
        return 0

def trigger_system_sleep():
    """Triggers Windows S3 Sleep / Standby with wakeup events (WoWLAN / RTC) enabled."""
    try:
        # powrprof.SetSuspendState(bHibernate=0, bForce=1, bWakeupEventsDisabled=0)
        return ctypes.windll.powrprof.SetSuspendState(0, 1, 0)
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

def load_settings():
    path = get_settings_path()
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8-sig") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def is_sleep_on_idle_enabled():
    settings = load_settings()
    return bool(settings.get("main", {}).get("sleepOnIdleEnabled", False))

def get_jellyfin_api_key():
    env_key = os.environ.get("JELLYFIN_API_KEY") or os.environ.get("JELLYFIN_TOKEN")
    if env_key:
        return env_key
    settings = load_settings()
    return settings.get("jellyfin", {}).get("apiKey", "")

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

# --- PHYSICAL USER ACTIVITY DETECTION (MOUSE & KEYBOARD) ---
class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]

def get_user_idle_seconds():
    """Returns the seconds since the user last physically moved the mouse or pressed a key."""
    try:
        lii = LASTINPUTINFO()
        lii.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if ctypes.windll.user32.GetLastInputInfo(ctypes.byref(lii)):
            millis = ctypes.windll.kernel32.GetTickCount() - lii.dwTime
            return max(0.0, millis / 1000.0)
    except Exception:
        pass
    return 0.0

def check_user_active(threshold_seconds=IDLE_TIMEOUT_SECONDS):
    """
    Returns True if the user physically used the computer within threshold_seconds.
    Guarantees the PC NEVER sleeps or shuts down while someone is sitting at the desk using it.
    """
    if os.environ.get("DISABLE_USER_CHECK", "0") == "1":
        return False, "User input check disabled"
    idle_sec = get_user_idle_seconds()
    if idle_sec < threshold_seconds:
        return True, f"User actively using computer (last input {int(idle_sec)}s ago)"
    return False, f"User physically idle ({int(idle_sec)}s since last input)"

# --- ARK DEDICATED SERVER DETECTION ---
def check_ark_active():
    """
    Checks if ARK dedicated server is alive.
    Process: ShooterGameServer.exe
    Query Port: UDP 27015
    """
    if os.environ.get("DISABLE_ARK_CHECK", "0") == "1":
        return False, "ARK check disabled"

    # 1. Process check via psutil
    if psutil:
        try:
            for proc in psutil.process_iter(['name']):
                pname = (proc.info.get('name') or '').lower()
                if 'shootergame' in pname:
                    return True, "ARK server process running (ShooterGameServer.exe)"
        except Exception:
            pass

    # 2. UDP Query Port check (27015)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.4)
        sock.sendto(b"\xFF\xFF\xFF\xFF\x54\x53\x6F\x75\x72\x63\x65\x20\x45\x6E\x67\x69\x6E\x65\x20\x51\x75\x65\x72\x79\x00", ("127.0.0.1", 27015))
        resp, _ = sock.recvfrom(512)
        sock.close()
        if len(resp) > 4:
            return True, "ARK server responding on query port 27015"
    except Exception:
        pass

    return False, "ARK server offline"

# --- MINECRAFT SERVER DETECTION ---
def check_mc_active():
    """
    Checks if Minecraft server is alive.
    Process: java.exe running fabric-server-launch.jar / in MinecraftServer directory
    Port: TCP 25565
    """
    if os.environ.get("DISABLE_MC_CHECK", "0") == "1":
        return False, "Minecraft check disabled"

    # 1. TCP Port 25565 check (fastest)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(0.3)
        res = sock.connect_ex(('127.0.0.1', 25565))
        sock.close()
        if res == 0:
            return True, "Minecraft server listening on port 25565"
    except Exception:
        pass

    # 2. Process check via psutil
    if psutil:
        try:
            for proc in psutil.process_iter(['name', 'cmdline', 'cwd']):
                pname = (proc.info.get('name') or '').lower()
                if 'java' in pname:
                    cmdline = ' '.join(proc.info.get('cmdline') or [])
                    cwd = proc.info.get('cwd') or ''
                    if 'fabric-server-launch.jar' in cmdline or 'MinecraftServer' in cwd or 'MinecraftServer' in cmdline:
                        return True, "Minecraft Java server process running"
        except Exception:
            pass

    return False, "Minecraft server offline"

# --- QBITTORRENT DOWNLOAD DETECTION ---
def check_qbittorrent_active():
    """
    Checks if qBittorrent is actively downloading torrents.
    Inspects:
    1. Transfer speed: dl_info_speed > 10 KB/s
    2. Torrents state: downloading, forcedDL, metaDL with active progress
    """
    if os.environ.get("DISABLE_QBIT_CHECK", "0") == "1":
        return False, "qBittorrent check disabled"

    base_url = get_qbittorrent_url()
    headers = {"User-Agent": "NullSeerrPowerGuard/2.0"}
    cookie = os.environ.get("QBITTORRENT_COOKIE")
    if cookie:
        headers["Cookie"] = cookie

    # Check 1: Transfer info (speed)
    try:
        req = urllib.request.Request(f"{base_url}/api/v2/transfer/info", headers=headers)
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                dl_speed = data.get("dl_info_speed", 0)
                if dl_speed > 10240:  # > 10 KB/s
                    speed_mb = dl_speed / (1024 * 1024)
                    return True, f"qBittorrent actively downloading ({speed_mb:.2f} MB/s)"
    except Exception:
        pass

    # Check 2: Active downloading torrents list
    try:
        req = urllib.request.Request(f"{base_url}/api/v2/torrents/info?filter=downloading", headers=headers)
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                torrents = json.loads(resp.read().decode("utf-8"))
                active_torrents = []
                for t in torrents:
                    state = t.get("state", "")
                    dlspeed = t.get("dlspeed", 0)
                    progress = t.get("progress", 0)
                    # Exclude completed, stalled at 0 B/s without progress, or paused
                    if state in ["downloading", "forcedDL", "metaDL"] and (dlspeed > 1024 or progress < 1.0):
                        active_torrents.append(t.get("name", "Torrent"))

                if active_torrents:
                    return True, f"qBittorrent downloading: {len(active_torrents)} active torrent(s)"
    except Exception:
        pass

    return False, "qBittorrent idle"

# --- JELLYFIN STREAMING DETECTION ---
def check_jellyfin_active():
    """
    Checks if Jellyfin has active media playback sessions.
    Requires X-MediaBrowser-Token from settings.json.
    Inspects NowPlayingItem and PlayState.IsPaused.
    """
    if os.environ.get("DISABLE_JELLYFIN_CHECK", "0") == "1":
        return False, "Jellyfin check disabled"

    api_key = get_jellyfin_api_key()
    if not api_key:
        return False, "No Jellyfin API key configured"

    base_url = get_jellyfin_url()
    headers = {
        "User-Agent": "NullSeerrPowerGuard/2.0",
        "X-MediaBrowser-Token": api_key,
    }

    try:
        req = urllib.request.Request(f"{base_url}/Sessions", headers=headers)
        with urllib.request.urlopen(req, timeout=3) as resp:
            if resp.status == 200:
                sessions = json.loads(resp.read().decode("utf-8"))
                active_streams = []
                for s in sessions:
                    item = s.get("NowPlayingItem")
                    play_state = s.get("PlayState", {})
                    is_paused = play_state.get("IsPaused", False)
                    if item is not None and not is_paused:
                        title = item.get("Name", "Unknown Media")
                        user = s.get("UserName", "User")
                        active_streams.append(f"{title} ({user})")

                if active_streams:
                    return True, f"Jellyfin streaming: {', '.join(active_streams)}"
    except Exception:
        pass

    return False, "Jellyfin idle"

def write_status(data):
    """Writes status heartbeat for Null-seerr / diagnostics."""
    status_file = os.path.join(os.environ.get("STACK_ROOT", "C:/arr-stack"), "config", "power_guard_status.json")
    try:
        os.makedirs(os.path.dirname(status_file), exist_ok=True)
        with open(status_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception:
        pass

def main():
    currently_holding_awake = False
    idle_since = None

    # Hold awake immediately on start until initial evaluation
    set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
    currently_holding_awake = True

    while True:
        try:
            sleep_enabled = is_sleep_on_idle_enabled()

            if not sleep_enabled:
                # User wants PC awake 24/7 (Power Management switch is OFF in Null-seerr)
                if not currently_holding_awake:
                    set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
                    currently_holding_awake = True
                idle_since = None

                write_status({
                    "timestamp": time.time(),
                    "sleepOnIdleEnabled": False,
                    "state": "AWAKE_ALWAYS",
                    "reason": "Host Power Management switch is OFF (24/7 awake mode)",
                    "idle_seconds": 0
                })

            else:
                # Power Management is ON: Evaluate all safety conditions
                user_up, user_reason = check_user_active(IDLE_TIMEOUT_SECONDS)
                ark_up, ark_reason = check_ark_active()
                mc_up, mc_reason = check_mc_active()
                qbit_up, qbit_reason = check_qbittorrent_active()
                jelly_up, jelly_reason = check_jellyfin_active()

                active_reasons = []
                if user_up:
                    active_reasons.append(user_reason)
                if ark_up:
                    active_reasons.append(ark_reason)
                if mc_up:
                    active_reasons.append(mc_reason)
                if qbit_up:
                    active_reasons.append(qbit_reason)
                if jelly_up:
                    active_reasons.append(jelly_reason)

                is_active = len(active_reasons) > 0

                if is_active:
                    # Critical activity detected -> Hold PC awake
                    idle_since = None
                    if not currently_holding_awake:
                        set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
                        currently_holding_awake = True

                    write_status({
                        "timestamp": time.time(),
                        "sleepOnIdleEnabled": True,
                        "state": "ACTIVE",
                        "active_services": active_reasons,
                        "user": user_reason,
                        "user_idle_seconds": int(get_user_idle_seconds()),
                        "ark": ark_reason,
                        "minecraft": mc_reason,
                        "qbittorrent": qbit_reason,
                        "jellyfin": jelly_reason,
                        "idle_seconds": 0
                    })

                else:
                    # All gaming servers, downloads, streams, and physical user are idle!
                    now = time.time()
                    if idle_since is None:
                        idle_since = now

                    elapsed_idle = now - idle_since
                    remaining_idle = max(0, IDLE_TIMEOUT_SECONDS - elapsed_idle)

                    write_status({
                        "timestamp": time.time(),
                        "sleepOnIdleEnabled": True,
                        "state": "IDLE",
                        "idle_seconds": int(elapsed_idle),
                        "timeout_seconds": IDLE_TIMEOUT_SECONDS,
                        "remaining_seconds": int(remaining_idle),
                        "user": user_reason,
                        "user_idle_seconds": int(get_user_idle_seconds()),
                        "ark": ark_reason,
                        "minecraft": mc_reason,
                        "qbittorrent": qbit_reason,
                        "jellyfin": jelly_reason
                    })

                    if elapsed_idle >= IDLE_TIMEOUT_SECONDS:
                        # 15 minutes of continuous full idle reached: Trigger Sleep!
                        write_status({
                            "timestamp": time.time(),
                            "sleepOnIdleEnabled": True,
                            "state": "ENTERING_SLEEP",
                            "reason": f"System idle for {int(elapsed_idle)}s. Entering S3 Standby.",
                            "idle_seconds": int(elapsed_idle)
                        })

                        # Release execution lock
                        if currently_holding_awake:
                            set_execution_state(ES_CONTINUOUS)
                            currently_holding_awake = False

                        # Trigger Windows S3 Sleep
                        trigger_system_sleep()

                        # Upon resume/wake-up from Sleep:
                        time.sleep(5)
                        idle_since = None
                        set_execution_state(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED)
                        currently_holding_awake = True

        except Exception as e:
            pass

        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
