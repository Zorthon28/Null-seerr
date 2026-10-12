#!/usr/bin/env python3
"""
qBittorrent Download Speed and Swarm Optimizer
Optimizes networking parameters (TCP protocol priority, UPnP, connection limits)
and automatically pulls the latest top public trackers from ngosang/trackerslist,
injecting them into slow or all active torrents to maximize peer discovery.
"""

import os
import sys
import json
import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
from typing import List, Optional

FALLBACK_TRACKERS = [
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.tracker.cl:1337/announce",
    "udp://opentracker.i2p.rocks:6969/announce",
    "udp://tracker.openbittorrent.com:6969/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://open.demonii.com:1337/announce",
    "udp://tracker.dler.org:6969/announce",
    "udp://exodus.desync.com:6969/announce",
    "udp://tracker.bitsearch.to:1337/announce",
    "udp://tracker.qu.ax:6969/announce",
    "udp://p4p.arenabg.com:1337/announce",
    "udp://leet-tracker.moe:1337/announce"
]


class QbClient:
    def __init__(self, base_url: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None):
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        self.username = username or os.environ.get("QBITTORRENT_USER", "admin")
        self.password = password or os.environ.get("QBITTORRENT_PASSWORD") or os.environ.get("MASTER_PASSWORD", "")
        self.base_url = self._resolve_base_url(base_url)
        self._authenticate()

    def _resolve_base_url(self, explicit_url: Optional[str]) -> str:
        if explicit_url:
            return explicit_url.rstrip("/")

        env_url = os.environ.get("QBITTORRENT_URL")
        if env_url:
            return env_url.rstrip("/")

        host = os.environ.get("QBITTORRENT_HOST", "localhost")
        port_env = os.environ.get("QBITTORRENT_PORT") or os.environ.get("QBIT_WEBUI_PORT")

        ports_to_try = [int(port_env)] if port_env else [8089, 8080]

        for port in ports_to_try:
            cand = f"http://{host}:{port}"
            try:
                req = urllib.request.Request(f"{cand}/api/v2/app/version")
                with self.opener.open(req, timeout=1.5) as resp:
                    if resp.status == 200:
                        return cand
            except urllib.error.HTTPError as e:
                # 403 / 401 means server is alive and requires auth
                if e.code in (401, 403):
                    return cand
            except Exception:
                continue

        # Default fallback
        chosen_port = ports_to_try[0]
        return f"http://{host}:{chosen_port}"

    def _authenticate(self):
        # Test if unauthenticated access is permitted (localhost bypass)
        try:
            req = urllib.request.Request(f"{self.base_url}/api/v2/app/version")
            with self.opener.open(req, timeout=2.0) as resp:
                if resp.status == 200:
                    return
        except urllib.error.HTTPError as e:
            if e.code not in (401, 403):
                return
        except Exception:
            return

        # Attempt login via WebUI cookie session
        if self.password:
            try:
                login_data = urllib.parse.urlencode({
                    "username": self.username,
                    "password": self.password
                }).encode("utf-8")
                req = urllib.request.Request(f"{self.base_url}/api/v2/auth/login", data=login_data)
                req.add_header("Referer", self.base_url)
                with self.opener.open(req, timeout=3.0) as resp:
                    body = resp.read().decode("utf-8", errors="ignore")
                    if "Ok." in body:
                        print(f"[+] Authenticated successfully with qBittorrent at {self.base_url}")
                    else:
                        print(f"[!] Warning: qBittorrent login returned: {body}")
            except Exception as e:
                print(f"[!] Warning: Could not authenticate with qBittorrent: {e}")

    def get(self, endpoint: str):
        req = urllib.request.Request(f"{self.base_url}{endpoint}")
        with self.opener.open(req, timeout=8) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data) if data else None

    def post(self, endpoint: str, data: Optional[dict] = None):
        encoded = urllib.parse.urlencode(data).encode("utf-8") if data else None
        req = urllib.request.Request(f"{self.base_url}{endpoint}", data=encoded)
        with self.opener.open(req, timeout=8) as resp:
            return resp.read().decode("utf-8")


def fetch_live_trackers() -> List[str]:
    url = "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            lines = [line.strip() for line in r.read().decode("utf-8").splitlines() if line.strip()]
            if lines:
                print(f"[+] Successfully fetched {len(lines)} active trackers from ngosang/trackerslist.")
                return lines
    except Exception as exc:
        print(f"[!] Warning: Unable to fetch live tracker list ({exc}). Using fallback list.")
    return FALLBACK_TRACKERS


def optimize_qbittorrent(client: QbClient, target_filter: Optional[str] = None):
    print(f"=== Optimizing qBittorrent Configuration ({client.base_url}) ===")
    trackers = fetch_live_trackers()
    trackers_str = "\n".join(trackers)

    preferences = {
        "upnp": True,
        "add_trackers_enabled": True,
        "add_trackers": trackers_str,
        "dht": True,
        "pex": True,
        "lsd": True,
        "max_connec": 2000,
        "max_connec_per_torrent": 500,
        "max_uploads_per_torrent": 50,
        "enable_utp": False,
        "bittorrent_protocol": 1,
    }

    try:
        client.post("/api/v2/app/setPreferences", {"json": json.dumps(preferences)})
        print("[+] Updated preferences: TCP protocol prioritized, UPnP enabled, max connections increased.")
    except Exception as e:
        print(f"[!] Warning: Failed to set preferences: {e}")

    torrents = client.get("/api/v2/torrents/info") or []
    print(f"[+] Inspecting {len(torrents)} torrent(s)...")

    for torrent in torrents:
        name = torrent.get("name", "")
        t_hash = torrent.get("hash", "")
        if target_filter and target_filter.lower() not in name.lower():
            continue

        print(f"\n---> Optimizing: {name}")
        print(f"     Speed: {torrent.get('dlspeed', 0) / 1024:.1f} KiB/s | Seeds: {torrent.get('num_seeds')} ({torrent.get('num_complete')})")

        try:
            client.post("/api/v2/torrents/addTrackers", {
                "hash": t_hash,
                "urls": trackers_str
            })
            client.post("/api/v2/torrents/reannounce", {"hashes": t_hash})
            print("     [+] Injected live trackers and reannounced to swarm.")
        except Exception as e:
            print(f"     [!] Tracker injection warning: {e}")


if __name__ == "__main__":
    filter_arg = sys.argv[1] if len(sys.argv) > 1 else None
    qb = QbClient()
    optimize_qbittorrent(qb, target_filter=filter_arg)
