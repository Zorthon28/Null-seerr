#!/usr/bin/env python3
"""
qBittorrent Download Speed and Swarm Optimizer
Optimizes networking parameters (TCP protocol priority, UPnP, connection limits)
and automatically pulls the latest top public trackers from ngosang/trackerslist,
injecting them into slow or all active torrents to maximize peer discovery.
"""

import sys
import json
import urllib.request
import urllib.parse
from typing import List, Optional

QB_URL = "http://localhost:8089"
QB_USER = "admin"
QB_PASS = "PAssw0rd2026!"

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
    def __init__(self, base_url: str = QB_URL, username: str = QB_USER, password: str = QB_PASS):
        self.base_url = base_url.rstrip("/")
        passman = urllib.request.HTTPPasswordMgrWithDefaultRealm()
        passman.add_password(None, self.base_url, username, password)
        self.opener = urllib.request.build_opener(urllib.request.HTTPBasicAuthHandler(passman))

    def get(self, endpoint: str):
        req = urllib.request.Request(f"{self.base_url}{endpoint}")
        with self.opener.open(req) as resp:
            data = resp.read().decode("utf-8")
            return json.loads(data) if data else None

    def post(self, endpoint: str, data: Optional[dict] = None):
        encoded = urllib.parse.urlencode(data).encode("utf-8") if data else None
        req = urllib.request.Request(f"{self.base_url}{endpoint}", data=encoded)
        with self.opener.open(req) as resp:
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
    print("=== Optimizing qBittorrent Configuration ===")
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

    client.post("/api/v2/app/setPreferences", {"json": json.dumps(preferences)})
    print("[+] Updated preferences: TCP protocol prioritized, UPnP enabled, max connections increased.")

    torrents = client.get("/api/v2/torrents/info") or []
    print(f"[+] Inspecting {len(torrents)} torrent(s)...")

    for torrent in torrents:
        name = torrent.get("name", "")
        t_hash = torrent.get("hash", "")
        if target_filter and target_filter.lower() not in name.lower():
            continue

        print(f"\n---> Optimizing: {name}")
        print(f"     Speed: {torrent.get('dlspeed', 0) / 1024:.1f} KiB/s | Seeds: {torrent.get('num_seeds')} ({torrent.get('num_complete')})")

        client.post("/api/v2/torrents/addTrackers", {
            "hash": t_hash,
            "urls": trackers_str
        })
        client.post("/api/v2/torrents/reannounce", {"hashes": t_hash})
        print("     [+] Injected live trackers and reannounced to swarm.")


if __name__ == "__main__":
    filter_arg = sys.argv[1] if len(sys.argv) > 1 else None
    qb = QbClient()
    optimize_qbittorrent(qb, target_filter=filter_arg)
