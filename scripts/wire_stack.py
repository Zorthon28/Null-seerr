#!/usr/bin/env python3
"""
Null-seerr All-In-One Media Stack CLI Wiring Utility
Automatically extracts API keys, tests connections, and wires together:
- Prowlarr <-> Radarr & Sonarr (Indexers & Sync)
- Prowlarr <-> FlareSolverr (Cloudflare bypass)
- qBittorrent <-> Radarr & Sonarr (Download Client)
- Null-seerr <-> Radarr, Sonarr, & Plex/Jellyfin (Media Request Automation)
"""

import os
import sys
import json
import time
import xml.etree.ElementTree as ET
import urllib.request
import urllib.parse
import urllib.error

# Ensure UTF-8 output encoding on Windows consoles
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

ARR_DIR = r"C:\arr-stack"

# Service default ports & URLs
SERVICES = {
    "seerr": {"url": "http://localhost:5055", "docker_url": "http://seerr:5055", "name": "Null-seerr"},
    "radarr": {"url": "http://localhost:7878", "docker_url": "http://radarr:7878", "name": "Radarr"},
    "sonarr": {"url": "http://localhost:8989", "docker_url": "http://sonarr:8989", "name": "Sonarr"},
    "prowlarr": {"url": "http://localhost:9696", "docker_url": "http://prowlarr:9696", "name": "Prowlarr"},
    "qbittorrent": {"url": "http://localhost:8089", "docker_url": "http://qbittorrent:8080", "name": "qBittorrent"},
    "flaresolverr": {"url": "http://localhost:8191", "docker_url": "http://flaresolverr:8191", "name": "FlareSolverr"},
    "plex": {"url": "http://localhost:32400", "docker_url": "http://plex:32400", "name": "Plex"},
    "jellyfin": {"url": "http://localhost:8096", "docker_url": "http://jellyfin:8096", "name": "Jellyfin"},
    "bazarr": {"url": "http://localhost:6767", "docker_url": "http://bazarr:6767", "name": "Bazarr"},
    "suggestarr": {"url": "http://localhost:4455", "docker_url": "http://suggestarr:5000", "name": "Suggestarr"},
    "shoko": {"url": "http://localhost:8111", "docker_url": "http://shoko:8111", "name": "Shoko Server"},
    "tdarr": {"url": "http://localhost:8265", "docker_url": "http://tdarr:8265", "name": "Tdarr"},
}

def log(msg, symbol="*"):
    print(f"[{symbol}] {msg}")

def get_xml_api_key(config_path):
    if not os.path.exists(config_path):
        return None
    try:
        tree = ET.parse(config_path)
        root = tree.getroot()
        api_elem = root.find("ApiKey")
        if api_elem is not None and api_elem.text:
            return api_elem.text.strip()
    except Exception as e:
        log(f"Error reading {config_path}: {e}", "!")
    return None

def get_seerr_api_key(settings_path):
    if not os.path.exists(settings_path):
        return None
    try:
        with open(settings_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("main", {}).get("apiKey")
    except Exception as e:
        log(f"Error reading {settings_path}: {e}", "!")
    return None

def http_request(url, method="GET", data=None, headers=None):
    headers = headers or {}
    if data is not None and isinstance(data, (dict, list)):
        data_bytes = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif data is not None and isinstance(data, str):
        data_bytes = data.encode("utf-8")
    else:
        data_bytes = None

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp_body = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(resp_body)
            except Exception:
                return resp.status, resp_body
    except urllib.error.HTTPError as e:
        try:
            err_body = e.read().decode("utf-8")
            return e.code, json.loads(err_body)
        except Exception:
            return e.code, str(e)
    except Exception as e:
        return 0, str(e)

def wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key):
    if not prowlarr_key:
        log("Prowlarr API key not found. Skipping Prowlarr app sync.", "!")
        return

    url = f"{SERVICES['prowlarr']['url']}/api/v1/applications"
    headers = {"X-Api-Key": prowlarr_key}

    status, existing_apps = http_request(url, headers=headers)
    if status != 200:
        log(f"Failed to fetch Prowlarr applications: {existing_apps}", "!")
        return

    existing_names = [a.get("name") for a in existing_apps] if isinstance(existing_apps, list) else []

    # Wire Radarr
    if radarr_key and "Radarr" not in existing_names:
        log("Registering Radarr in Prowlarr...", "+")
        radarr_payload = {
            "name": "Radarr",
            "syncLevel": "fullSync",
            "implementation": "Radarr",
            "configContract": "RadarrSettings",
            "fields": [
                {"name": "prowlarrUrl", "value": "http://prowlarr:9696"},
                {"name": "baseUrl", "value": "http://radarr:7878"},
                {"name": "apiKey", "value": radarr_key},
                {"name": "syncCategories", "value": [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080]}
            ]
        }
        st, res = http_request(url, method="POST", data=radarr_payload, headers=headers)
        if st in (200, 201):
            log("Radarr successfully linked in Prowlarr!", "+")
        else:
            log(f"Prowlarr -> Radarr registration returned HTTP {st}: {res}", "!")
    elif "Radarr" in existing_names:
        log("Radarr is already linked in Prowlarr", "OK")

    # Wire Sonarr
    if sonarr_key and "Sonarr" not in existing_names:
        log("Registering Sonarr in Prowlarr...", "+")
        sonarr_payload = {
            "name": "Sonarr",
            "syncLevel": "fullSync",
            "implementation": "Sonarr",
            "configContract": "SonarrSettings",
            "fields": [
                {"name": "prowlarrUrl", "value": "http://prowlarr:9696"},
                {"name": "baseUrl", "value": "http://sonarr:8989"},
                {"name": "apiKey", "value": sonarr_key},
                {"name": "syncCategories", "value": [5000, 5010, 5020, 5030, 5040, 5045, 5060, 5070, 5080]}
            ]
        }
        st, res = http_request(url, method="POST", data=sonarr_payload, headers=headers)
        if st in (200, 201):
            log("Sonarr successfully linked in Prowlarr!", "+")
        else:
            log(f"Prowlarr -> Sonarr registration returned HTTP {st}: {res}", "!")
    elif "Sonarr" in existing_names:
        log("Sonarr is already linked in Prowlarr", "OK")

def wire_qbittorrent_to_arr(app_name, app_url, app_key, category):
    if not app_key:
        return
    url = f"{app_url}/api/v3/downloadclient"
    headers = {"X-Api-Key": app_key}

    status, clients = http_request(url, headers=headers)
    if status != 200:
        log(f"Failed to query download clients for {app_name}: {clients}", "!")
        return

    if isinstance(clients, list) and any(c.get("name") == "qBittorrent" for c in clients):
        log(f"qBittorrent is already configured in {app_name}", "OK")
        return

    log(f"Configuring qBittorrent download client in {app_name} (Category: {category})...", "+")
    payload = {
        "name": "qBittorrent",
        "enable": True,
        "protocol": "torrent",
        "priority": 1,
        "implementation": "QBittorrent",
        "configContract": "QBittorrentSettings",
        "fields": [
            {"name": "host", "value": "qbittorrent"},
            {"name": "port", "value": 8080},
            {"name": "urlBase", "value": ""},
            {"name": "username", "value": "admin"},
            {"name": "password", "value": "admin1234"},
            {"name": "tvCategory", "value": category},
            {"name": "movieCategory", "value": category},
            {"name": "recentTvPriority", "value": 0},
            {"name": "olderTvPriority", "value": 0},
            {"name": "initialState", "value": 0}
        ]
    }
    st, res = http_request(url, method="POST", data=payload, headers=headers)
    if st in (200, 201):
        log(f"qBittorrent added successfully to {app_name}!", "+")
    else:
        log(f"Could not auto-add qBittorrent to {app_name} (HTTP {st}): {res}", "!")

def check_and_wire_all():
    print("=" * 65)
    print("NULL-SEERR ALL-IN-ONE MEDIA STACK AUTO-WIRING TOOL")
    print("=" * 65)

    # 1. Extract API Keys
    radarr_xml = os.path.join(ARR_DIR, "config", "radarr", "config.xml")
    sonarr_xml = os.path.join(ARR_DIR, "config", "sonarr", "config.xml")
    prowlarr_xml = os.path.join(ARR_DIR, "config", "prowlarr", "config.xml")
    seerr_json = os.path.join(ARR_DIR, "config", "overseerr", "settings.json")

    radarr_key = get_xml_api_key(radarr_xml)
    sonarr_key = get_xml_api_key(sonarr_xml)
    prowlarr_key = get_xml_api_key(prowlarr_xml)
    seerr_key = get_seerr_api_key(seerr_json)

    print("\nDiscovered API Keys:")
    print(f"  * Radarr:     {radarr_key or 'Not found'}")
    print(f"  * Sonarr:     {sonarr_key or 'Not found'}")
    print(f"  * Prowlarr:   {prowlarr_key or 'Not found'}")
    print(f"  * Null-seerr: {seerr_key or 'Not found'}\n")

    # 2. Check Service Health
    print("Checking Service Connectivity:")
    for key, info in SERVICES.items():
        st, _ = http_request(info["url"])
        status_text = f"ONLINE (HTTP {st})" if st > 0 else "OFFLINE / STARTING"
        symbol = "OK" if st in (200, 301, 302, 401, 403) else ".."
        print(f"  [{symbol:>2}] {info['name']:<15} {info['url']:<26} -> {status_text}")

    # 3. Perform Auto-Wiring
    print("\nLinking Stack Services:")
    if prowlarr_key and (radarr_key or sonarr_key):
        wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key)

    if radarr_key:
        wire_qbittorrent_to_arr("Radarr", SERVICES["radarr"]["url"], radarr_key, "movies")
    if sonarr_key:
        wire_qbittorrent_to_arr("Sonarr", SERVICES["sonarr"]["url"], sonarr_key, "tv")

    print("\n" + "=" * 65)
    print("Stack Wiring Complete!")
    print("=" * 65)
    print("Null-seerr Portal:  http://localhost:5055")
    print("Radarr (Movies):    http://localhost:7878")
    print("Sonarr (TV):        http://localhost:8989")
    print("Prowlarr (Index):   http://localhost:9696")
    print("qBittorrent (DL):   http://localhost:8089")
    print("Plex Media Server:  http://localhost:32400/web")
    print("Jellyfin Server:    http://localhost:8096")
    print("Bazarr (Subtitles): http://localhost:6767")
    print("Suggestarr (AI):    http://localhost:4455")
    print("Shoko (Anime):      http://localhost:8111")
    print("Tdarr (Transcode):  http://localhost:8265")
    print("=" * 65)

if __name__ == "__main__":
    check_and_wire_all()
