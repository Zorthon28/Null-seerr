#!/usr/bin/env python3
"""
Null-seerr All-In-One Media Stack CLI Wiring Utility
Automatically extracts API keys, generates secure unified stack credentials,
tests connections, and wires together:
- Dynamic Random Password Generation for the entire stack (admin / <generated_password>)
- Null-seerr Auto-Initialization (Skips onboarding wizard, creates admin & configures Radarr/Sonarr)
- Prowlarr <-> Radarr & Sonarr (Indexers & Sync)
- Prowlarr Auto-Seeder (YTS, Nyaa, The Pirate Bay, AnimeTosho, etc.)
- Prowlarr <-> FlareSolverr (Cloudflare bypass proxy)
- qBittorrent <-> Radarr & Sonarr (Download Client with Category Routing)
- Plex & Jellyfin Standard Media Naming Rules in Radarr & Sonarr
"""

import os
import sys
import json
import time
import sqlite3
import secrets
import string
import subprocess
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

def get_or_create_stack_credentials():
    """Generates or loads a secure temporary password for the admin account across the stack"""
    cred_file = os.path.join(ARR_DIR, "CREDENTIALS.txt")
    user = "admin"
    password = None

    if os.path.exists(cred_file):
        try:
            with open(cred_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("PASSWORD:"):
                        password = line.split(":", 1)[1].strip()
                    elif line.startswith("USER:"):
                        user = line.split(":", 1)[1].strip()
        except Exception:
            pass

    if not password:
        # Generate clean, high-entropy 16-character password without ambiguous characters
        alphabet = string.ascii_letters + string.digits + "!@#$"
        password = "".join(secrets.choice(alphabet) for _ in range(16))
        try:
            with open(cred_file, "w", encoding="utf-8") as f:
                f.write(f"USER: {user}\nPASSWORD: {password}\nGENERATED: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        except Exception as e:
            log(f"Warning: Could not save credentials file: {e}", "!")

    return user, password

def hash_password(password):
    """Hashes password using bcrypt via container or local runtime"""
    # Method 1: Ask running null-seerr container
    try:
        cmd = ["docker", "exec", "null-seerr", "node", "-e", f"const b = require('bcrypt'); console.log(b.hashSync('{password}', 10));"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip().startswith("$2b$"):
            return res.stdout.strip()
    except Exception:
        pass

    # Method 2: Local node
    try:
        cmd = ["node", "-e", f"const b = require('bcrypt'); console.log(b.hashSync('{password}', 10));"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip().startswith("$2b$"):
            return res.stdout.strip()
    except Exception:
        pass

    return None

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

def auto_initialize_nullseerr(admin_user, admin_password, radarr_key, sonarr_key):
    """Automatically pre-configures Null-seerr, bypasses /setup onboarding, and provisions unified admin"""
    overseerr_dir = os.path.join(ARR_DIR, "config", "overseerr")
    settings_file = os.path.join(overseerr_dir, "settings.json")
    db_file = os.path.join(overseerr_dir, "db", "db.sqlite3")

    needs_restart = False

    # 1. Pre-configure settings.json
    if os.path.exists(settings_file):
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                settings = json.load(f)

            updated = False
            if not settings.get("public", {}).get("initialized", False):
                settings["public"] = settings.get("public", {})
                settings["public"]["initialized"] = True
                updated = True

            if not settings.get("main", {}).get("localLogin", False):
                settings["main"] = settings.get("main", {})
                settings["main"]["localLogin"] = True
                settings["main"]["applicationTitle"] = "Null-seerr"
                settings["main"]["mediaServerType"] = 1 # Default Plex/Unified
                updated = True

            if radarr_key and len(settings.get("radarr", [])) == 0:
                settings["radarr"] = [
                    {
                        "name": "Radarr",
                        "hostname": "radarr",
                        "port": 7878,
                        "apiKey": radarr_key,
                        "useSsl": False,
                        "baseUrl": "",
                        "activeProfileId": 4,
                        "activeProfileName": "HD-1080p",
                        "activeDirectory": "/data/media/movies",
                        "is4k": False,
                        "minimumAvailability": "released",
                        "tags": [],
                        "isDefault": True,
                        "syncEnabled": False,
                        "preventSearch": False,
                        "tagRequests": False,
                        "id": 0
                    }
                ]
                updated = True

            if sonarr_key and len(settings.get("sonarr", [])) == 0:
                settings["sonarr"] = [
                    {
                        "name": "Sonarr",
                        "hostname": "sonarr",
                        "port": 8989,
                        "apiKey": sonarr_key,
                        "useSsl": False,
                        "baseUrl": "",
                        "activeProfileId": 4,
                        "activeLanguageProfileId": 1,
                        "activeProfileName": "HD-1080p",
                        "activeDirectory": "/data/media/tv",
                        "seriesType": "standard",
                        "tags": [],
                        "animeTags": [],
                        "is4k": False,
                        "isDefault": True,
                        "enableSeasonFolders": True,
                        "syncEnabled": False,
                        "preventSearch": False,
                        "tagRequests": False,
                        "id": 0
                    }
                ]
                updated = True

            if updated:
                with open(settings_file, "w", encoding="utf-8") as f:
                    json.dump(settings, f, indent=1)
                log("Null-seerr settings initialized (onboarding wizard bypassed)", "+")
                needs_restart = True
        except Exception as e:
            log(f"Error initializing settings.json: {e}", "!")

    # 2. Pre-create local admin user in db.sqlite3 with dynamic password
    if os.path.exists(db_file):
        try:
            hashed_pwd = hash_password(admin_password)
            if hashed_pwd:
                conn = sqlite3.connect(db_file)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM user;")
                count = cur.fetchone()[0]
                if count == 0:
                    cur.execute('''
                        INSERT INTO user (
                            id, email, username, permissions, avatar, password, userType
                        ) VALUES (
                            1, ?, ?, 2, 'https://gravatar.com/avatar/admin?d=mp', ?, 2
                        );
                    ''', (f"{admin_user}@nullseerr.local", admin_user, hashed_pwd))
                    conn.commit()
                    log(f"Created unified admin account ({admin_user}) in database", "+")
                    needs_restart = True
                else:
                    # Update existing admin password to match current credentials
                    cur.execute('''
                        UPDATE user SET username = ?, password = ? WHERE id = 1;
                    ''', (admin_user, hashed_pwd))
                    conn.commit()
                conn.close()
        except Exception as e:
            log(f"Error seeding admin user into database: {e}", "!")

    if needs_restart:
        try:
            subprocess.run(["docker", "restart", "null-seerr"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(4)
        except Exception:
            pass

def wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key):
    if not prowlarr_key:
        return

    url = f"{SERVICES['prowlarr']['url']}/api/v1/applications"
    headers = {"X-Api-Key": prowlarr_key}

    status, existing_apps = http_request(url, headers=headers)
    if status != 200:
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
        st, _ = http_request(url, method="POST", data=radarr_payload, headers=headers)
        if st in (200, 201):
            log("Radarr successfully linked in Prowlarr!", "+")
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
        st, _ = http_request(url, method="POST", data=sonarr_payload, headers=headers)
        if st in (200, 201):
            log("Sonarr successfully linked in Prowlarr!", "+")
    elif "Sonarr" in existing_names:
        log("Sonarr is already linked in Prowlarr", "OK")

def seed_prowlarr_indexers(prowlarr_key):
    """Auto-seeds popular public indexers into Prowlarr"""
    if not prowlarr_key:
        return

    headers = {"X-Api-Key": prowlarr_key}

    idx_url = f"{SERVICES['prowlarr']['url']}/api/v1/indexer"
    status, existing = http_request(idx_url, headers=headers)
    if status != 200:
        return

    existing_def_names = [i.get("definitionName", "").lower() for i in existing] if isinstance(existing, list) else []

    schema_url = f"{SERVICES['prowlarr']['url']}/api/v1/indexer/schema"
    s_status, schemas = http_request(schema_url, headers=headers)
    if s_status != 200 or not isinstance(schemas, list):
        return

    target_definitions = {
        "yts": "YTS (Movies)",
        "nyaasi": "Nyaa.si (Anime)",
        "thepiratebay": "The Pirate Bay (General)",
        "animetosho": "AnimeTosho (Anime)",
        "torrentdownload": "TorrentDownload (General)"
    }

    log("Auto-seeding popular indexers in Prowlarr...", "⚡")
    for def_name, label in target_definitions.items():
        if def_name in existing_def_names:
            log(f"Indexer {label} already active", "OK")
            continue

        matching_schema = next((s for s in schemas if s.get("definitionName", "").lower() == def_name), None)
        if not matching_schema:
            continue

        indexer_payload = dict(matching_schema)
        indexer_payload["enable"] = True
        indexer_payload["appProfileId"] = 1
        
        st, res = http_request(idx_url, method="POST", data=indexer_payload, headers=headers)
        if st in (200, 201):
            log(f"Seeded indexer: {label}", "+")

def wire_prowlarr_flaresolverr(prowlarr_key):
    """Configures FlareSolverr proxy in Prowlarr for Cloudflare challenge bypass"""
    if not prowlarr_key:
        return
    headers = {"X-Api-Key": prowlarr_key}
    proxy_url = f"{SERVICES['prowlarr']['url']}/api/v1/indexerproxy"
    
    st, existing_proxies = http_request(proxy_url, headers=headers)
    if st == 200 and isinstance(existing_proxies, list):
        if any(p.get("implementation") == "FlareSolverr" for p in existing_proxies):
            log("FlareSolverr proxy already configured in Prowlarr", "OK")
            return

    proxy_payload = {
        "name": "FlareSolverr",
        "implementation": "FlareSolverr",
        "configContract": "FlareSolverrSettings",
        "fields": [
            {"name": "host", "value": "http://flaresolverr:8191/"},
            {"name": "requestTimeout", "value": 60}
        ],
        "tags": []
    }
    pst, res = http_request(proxy_url, method="POST", data=proxy_payload, headers=headers)
    if pst in (200, 201):
        log("FlareSolverr proxy linked in Prowlarr!", "+")

def configure_media_naming(radarr_key, sonarr_key):
    """Sets standard Plex / Jellyfin naming conventions in Radarr and Sonarr"""
    # 1. Radarr Naming
    if radarr_key:
        url = f"{SERVICES['radarr']['url']}/api/v3/config/naming"
        headers = {"X-Api-Key": radarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, dict):
            current["renameMovies"] = True
            current["replaceIllegalCharacters"] = True
            current["colonReplacementFormat"] = "delete"
            current["standardMovieFormat"] = "{Movie CleanTitle} ({Release Year})/{Movie CleanTitle} ({Release Year}) [{Quality Full}]"
            current["movieFolderFormat"] = "{Movie CleanTitle} ({Release Year})"
            put_st, _ = http_request(url, method="PUT", data=current, headers=headers)
            if put_st in (200, 202):
                log("Plex/Jellyfin standard naming applied to Radarr", "OK")

    # 2. Sonarr Naming
    if sonarr_key:
        url = f"{SERVICES['sonarr']['url']}/api/v3/config/naming/1"
        headers = {"X-Api-Key": sonarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, dict):
            current["renameEpisodes"] = True
            current["replaceIllegalCharacters"] = True
            current["standardEpisodeFormat"] = "{Series CleanTitle} - S{season:00}E{episode:00} - {Episode CleanTitle} [{Quality Full}]"
            current["dailyEpisodeFormat"] = "{Series CleanTitle} - {Air-Date} - {Episode CleanTitle} [{Quality Full}]"
            current["animeEpisodeFormat"] = "{Series CleanTitle} - S{season:00}E{episode:00} - {absolute:000} - {Episode CleanTitle} [{Quality Full}]"
            current["seriesFolderFormat"] = "{Series CleanTitle}"
            current["seasonFolderFormat"] = "Season {season:00}"
            put_st, _ = http_request(url, method="PUT", data=current, headers=headers)
            if put_st in (200, 202):
                log("Plex/Jellyfin standard naming applied to Sonarr", "OK")

def wire_qbittorrent_to_arr(app_name, app_url, app_key, admin_user, admin_password, category):
    if not app_key:
        return
    url = f"{app_url}/api/v3/downloadclient"
    headers = {"X-Api-Key": app_key}

    status, clients = http_request(url, headers=headers)
    if status != 200:
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
            {"name": "username", "value": admin_user},
            {"name": "password", "value": admin_password},
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

def check_and_wire_all():
    print("=" * 65)
    print("NULL-SEERR ALL-IN-ONE MEDIA STACK AUTO-WIRING TOOL")
    print("=" * 65)

    # 1. Generate / Retrieve Unified Stack Credentials
    admin_user, admin_password = get_or_create_stack_credentials()

    # 2. Extract API Keys
    radarr_xml = os.path.join(ARR_DIR, "config", "radarr", "config.xml")
    sonarr_xml = os.path.join(ARR_DIR, "config", "sonarr", "config.xml")
    prowlarr_xml = os.path.join(ARR_DIR, "config", "prowlarr", "config.xml")
    seerr_json = os.path.join(ARR_DIR, "config", "overseerr", "settings.json")

    radarr_key = get_xml_api_key(radarr_xml)
    sonarr_key = get_xml_api_key(sonarr_xml)
    prowlarr_key = get_xml_api_key(prowlarr_xml)

    # 3. Auto-Initialize Null-seerr (Bypass onboarding setup wizard & create default admin)
    auto_initialize_nullseerr(admin_user, admin_password, radarr_key, sonarr_key)
    seerr_key = get_seerr_api_key(seerr_json)

    print("\nDiscovered API Keys:")
    print(f"  * Radarr:     {radarr_key or 'Not found'}")
    print(f"  * Sonarr:     {sonarr_key or 'Not found'}")
    print(f"  * Prowlarr:   {prowlarr_key or 'Not found'}")
    print(f"  * Null-seerr: {seerr_key or 'Not found'}\n")

    # 4. Check Service Health
    print("Checking Service Connectivity:")
    for key, info in SERVICES.items():
        st, _ = http_request(info["url"])
        status_text = f"ONLINE (HTTP {st})" if st > 0 else "OFFLINE / STARTING"
        symbol = "OK" if st in (200, 301, 302, 401, 403) else ".."
        print(f"  [{symbol:>2}] {info['name']:<15} {info['url']:<26} -> {status_text}")

    # 5. Perform Auto-Wiring
    print("\nLinking Stack Services:")
    if prowlarr_key and (radarr_key or sonarr_key):
        wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key)

    if prowlarr_key:
        wire_prowlarr_flaresolverr(prowlarr_key)
        seed_prowlarr_indexers(prowlarr_key)

    if radarr_key:
        wire_qbittorrent_to_arr("Radarr", SERVICES["radarr"]["url"], radarr_key, admin_user, admin_password, "movies")
    if sonarr_key:
        wire_qbittorrent_to_arr("Sonarr", SERVICES["sonarr"]["url"], sonarr_key, admin_user, admin_password, "tv")

    # 6. Configure Media Naming
    configure_media_naming(radarr_key, sonarr_key)

    print("\n" + "=" * 65)
    print("✨ STACK WIRING COMPLETE & CREDENTIALS CONFIGURED!")
    print("=" * 65)
    print(f"  🔑 UNIFIED ADMIN USERNAME:  {admin_user}")
    print(f"  🔒 GENERATED TEMP PASSWORD:  {admin_password}")
    print(f"  📁 Saved in:                {os.path.join(ARR_DIR, 'CREDENTIALS.txt')}")
    print("=" * 65)
    print("  * Null-seerr Portal:   http://localhost:5055")
    print("  * Radarr (Movies):     http://localhost:7878")
    print("  * Sonarr (TV):         http://localhost:8989")
    print("  * Prowlarr (Index):    http://localhost:9696")
    print("  * qBittorrent (DL):    http://localhost:8089")
    print("  * Plex Media Server:   http://localhost:32400/web")
    print("  * Jellyfin Server:     http://localhost:8096")
    print("  * Bazarr (Subtitles):  http://localhost:6767")
    print("  * Suggestarr (AI):     http://localhost:4455")
    print("  * Shoko (Anime):       http://localhost:8111")
    print("  * Tdarr (Transcode):   http://localhost:8265")
    print("=" * 65)

if __name__ == "__main__":
    check_and_wire_all()
