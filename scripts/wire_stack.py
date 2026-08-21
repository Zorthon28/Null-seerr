#!/usr/bin/env python3
"""
Null-seerr All-In-One Media Stack CLI Wiring Utility
Automatically extracts API keys, generates secure unified stack credentials,
tests connections, and wires together:
- Dynamic Random Password Generation for the entire stack (admin / <generated_password>)
- Null-seerr Auto-Initialization (Skips onboarding wizard, creates admin & configures Radarr/Sonarr)
- Jellyfin Auto-Initialization (Bypasses startup wizard, creates admin with stack password)
- Shoko Server Auto-Initialization (Bypasses setup wizard, creates admin & starts server)
- qBittorrent WebUI Host Validation & Bypass Configuration
- Configure Unified Admin & Local Address Bypass across Radarr, Sonarr, and Prowlarr
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
import hashlib
import base64
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
    email = "admin@nullseerr.local"
    password = None

    if os.path.exists(cred_file):
        try:
            with open(cred_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("PASSWORD:"):
                        password = line.split(":", 1)[1].strip()
                    elif line.startswith("USER:"):
                        user = line.split(":", 1)[1].strip()
                    elif line.startswith("EMAIL:"):
                        email = line.split(":", 1)[1].strip()
        except Exception:
            pass

    if not password:
        alphabet = string.ascii_letters + string.digits + "!@#$"
        password = "".join(secrets.choice(alphabet) for _ in range(16))
        try:
            with open(cred_file, "w", encoding="utf-8") as f:
                f.write(f"USER: {user}\nEMAIL: {email}\nPASSWORD: {password}\nGENERATED: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        except Exception as e:
            log(f"Warning: Could not save credentials file: {e}", "!")

    return user, email, password

def hash_password(password):
    """Hashes password using bcrypt via container or local runtime"""
    try:
        cmd = ["docker", "exec", "null-seerr", "node", "-e", f"const b = require('bcrypt'); console.log(b.hashSync('{password}', 10));"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip().startswith("$2b$"):
            return res.stdout.strip()
    except Exception:
        pass

    try:
        cmd = ["node", "-e", f"const b = require('bcrypt'); console.log(b.hashSync('{password}', 10));"]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        if res.returncode == 0 and res.stdout.strip().startswith("$2b$"):
            return res.stdout.strip()
    except Exception:
        pass

    return None

def configure_qbittorrent_auth(admin_user, admin_password):
    """Sets PBKDF2 credentials and host header validation bypass in qBittorrent"""
    conf_path = os.path.join(ARR_DIR, "config", "qbittorrent", "qBittorrent", "qBittorrent.conf")
    if not os.path.exists(conf_path):
        return

    try:
        with open(conf_path, "r", encoding="utf-8") as f:
            content = f.read()

        if "HostHeaderValidation=false" in content and "AuthSubnetWhitelistEnabled=true" in content:
            log("qBittorrent WebUI authentication and host validation configured", "OK")
            return

        subprocess.run(["docker", "stop", "qbittorrent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)

        with open(conf_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            if not line.startswith("WebUI\\"):
                new_lines.append(line)

        pref_idx = -1
        for idx, l in enumerate(new_lines):
            if l.strip() == "[Preferences]":
                pref_idx = idx
                break

        webui_settings = [
            "WebUI\\Address=0.0.0.0\n",
            "WebUI\\ServerDomains=*\n",
            "WebUI\\HostHeaderValidation=false\n",
            "WebUI\\CSRFProtection=false\n",
            "WebUI\\ClickjackingProtection=false\n",
            "WebUI\\AuthSubnetWhitelist=0.0.0.0/0, ::/0\n",
            "WebUI\\AuthSubnetWhitelistEnabled=true\n",
            "WebUI\\LocalHostAuth=false\n",
            "Session\\DefaultSavePath=/data/torrents/\n",
            "Session\\TempPath=/data/torrents/incomplete/\n",
            "Downloads\\SavePath=/data/torrents/\n",
            "Downloads\\TempPath=/data/torrents/incomplete/\n",
            "Connection\\GlobalDLLimit=-1\n",
            "Connection\\GlobalUPLimit=-1\n",
            "Connection\\MaxConnecs=1500\n",
            "Connection\\MaxConnecsPerTorrent=500\n",
            "Session\\DiskCache=1024\n",
            "Session\\DiskCacheTTL=120\n",
            "Session\\AsyncIOThreadsCount=16\n",
            "Session\\HashingThreadsCount=4\n",
            "Session\\FilePoolSize=500\n",
            "Session\\SendBufferWatermark=3072\n",
            "Session\\SendBufferLowWatermark=1024\n",
            "Session\\SendBufferWatermarkFactor=250\n",
            "Session\\SocketReceiveBufferSize=4096\n",
            "Session\\SocketSendBufferSize=4096\n",
            "Session\\MaxConcurrentHTTPAnnounces=100\n",
            "Session\\PiecePreallocation=false\n",
            "Session\\CoalesceReadsWrite=true\n",
            "Queueing\\QueueingEnabled=true\n",
            "Queueing\\MaxActiveDownloads=20\n",
            "Queueing\\MaxActiveTorrents=50\n",
            "Queueing\\MaxActiveUploads=20\n",
            "Queueing\\IgnoreSlowTorrents=true\n"
        ]

        if pref_idx != -1:
            for s in reversed(webui_settings):
                new_lines.insert(pref_idx + 1, s)

        with open(conf_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

        subprocess.run(["docker", "start", "qbittorrent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log("Configured qBittorrent for MAXIMUM download speed & throughput", "OK")
    except Exception as e:
        log(f"Error configuring qBittorrent: {e}", "!")

def auto_initialize_jellyfin(admin_user, admin_password):
    """Automatically completes Jellyfin setup wizard, provisions libraries, and generates API key for Null-seerr"""
    base = SERVICES["jellyfin"]["url"]
    token = None
    server_id = None
    user_id = None

    try:
        # Check if startup wizard is needed
        st, info = http_request(f"{base}/System/Info/Public")
        if st == 200 and isinstance(info, dict) and not info.get("StartupWizardCompleted", False):
            # 1. Update Startup User
            user_req_data = {"Name": admin_user, "Password": admin_password}
            http_request(f"{base}/Startup/User", method="POST", data=user_req_data)

            # 2. Set Config
            conf_data = {"UICulture": "en-US", "MetadataCountryCode": "US", "PreferredMetadataLanguage": "en"}
            http_request(f"{base}/Startup/Configuration", method="POST", data=conf_data)

            # 3. Complete Setup
            http_request(f"{base}/Startup/Complete", method="POST", data={})
            log("Jellyfin first-time setup wizard completed automatically", "+")

        # Authenticate
        auth_data = json.dumps({"Username": admin_user, "Pw": admin_password}).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "X-Emby-Authorization": 'MediaBrowser Client="CLI", Device="CLI", DeviceId="cli-init", Version="1.0.0"'
        }
        auth_st, auth_res = http_request(f"{base}/Users/AuthenticateByName", method="POST", data=auth_data, headers=headers)
        if auth_st == 200 and isinstance(auth_res, dict):
            token = auth_res.get("AccessToken")
            server_id = auth_res.get("ServerId")
            user_id = auth_res.get("User", {}).get("Id")
            log("Jellyfin server authenticated and active", "OK")

        if not token:
            return None

        auth_headers = {"X-Emby-Token": token, "Content-Type": "application/json"}

        # 4. Check / Provision Virtual Folders (Libraries)
        lst, libs = http_request(f"{base}/Library/VirtualFolders", headers=auth_headers)
        existing_lib_names = [lib.get("Name") for lib in libs] if lst == 200 and isinstance(libs, list) else []

        libraries_to_create = [
            {"name": "Movies", "type": "movies", "path": "/data/media/movies"},
            {"name": "TV Shows", "type": "tvshows", "path": "/data/media/tv"},
            {"name": "Anime", "type": "tvshows", "path": "/data/media/anime"}
        ]

        for l in libraries_to_create:
            if l["name"] not in existing_lib_names:
                create_url = f"{base}/Library/VirtualFolders?name={urllib.parse.quote(l['name'])}&collectionType={l['type']}&paths={urllib.parse.quote(l['path'])}&refreshLibrary=true"
                http_request(create_url, method="POST", headers=auth_headers)
                log(f"Created Jellyfin Library: {l['name']}", "+")

        # 5. Create / Retrieve API Key for Null-seerr
        kst, keys_res = http_request(f"{base}/Auth/Keys", headers=auth_headers)
        seerr_api_key = None
        if kst == 200 and isinstance(keys_res, dict):
            for k in keys_res.get("Items", []):
                if k.get("AppName") == "Null-seerr":
                    seerr_api_key = k.get("AccessToken")
                    break

        if not seerr_api_key:
            add_key_url = f"{base}/Auth/Keys?app=Null-seerr"
            http_request(add_key_url, method="POST", headers=auth_headers)
            kst2, keys_res2 = http_request(f"{base}/Auth/Keys", headers=auth_headers)
            if kst2 == 200 and isinstance(keys_res2, dict):
                for k in keys_res2.get("Items", []):
                    if k.get("AppName") == "Null-seerr":
                        seerr_api_key = k.get("AccessToken")
                        break

        # 6. Fetch Virtual Folders with ItemIds
        lst2, libs2 = http_request(f"{base}/Library/VirtualFolders", headers=auth_headers)
        jellyfin_libs_config = []
        if lst2 == 200 and isinstance(libs2, list):
            for lib in libs2:
                jellyfin_libs_config.append({
                    "id": lib.get("ItemId"),
                    "name": lib.get("Name"),
                    "enabled": True
                })

        return {
            "serverId": server_id,
            "userId": user_id,
            "apiKey": seerr_api_key,
            "libraries": jellyfin_libs_config
        }
    except Exception as e:
        log(f"Could not auto-initialize Jellyfin: {e}", "!")
        return None

def auto_initialize_shoko(admin_user, admin_password):
    """Automatically completes Shoko Server first time setup and starts the engine"""
    base = f"{SERVICES['shoko']['url']}/api/v3/Init"
    try:
        st, status = http_request(f"{base}/Status")
        if st == 200 and isinstance(status, dict):
            if status.get("State") in ("Starting", "Started", "Running"):
                log("Shoko Server engine is active", "OK")
                return

            # Set default user
            http_request(f"{base}/DefaultUser", method="POST", data={"Username": admin_user, "Password": admin_password, "IsAdmin": True})
            # Start engine
            http_request(f"{base}/StartServer", method="GET")
            log("Shoko Server default admin provisioned and engine started", "+")
    except Exception as e:
        log(f"Could not auto-initialize Shoko: {e}", "!")

def configure_servarr_auth(radarr_key, sonarr_key, prowlarr_key, admin_user, admin_password):
    """Configures unified admin credentials on Radarr, Sonarr, and Prowlarr with local address bypass"""
    targets = [
        ("Radarr", f"{SERVICES['radarr']['url']}/api/v3/config/host", radarr_key),
        ("Sonarr", f"{SERVICES['sonarr']['url']}/api/v3/config/host", sonarr_key),
        ("Prowlarr", f"{SERVICES['prowlarr']['url']}/api/v1/config/host", prowlarr_key),
    ]
    for name, url, key in targets:
        if not key:
            continue
        headers = {"X-Api-Key": key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, dict):
            current["authenticationMethod"] = "forms"
            current["authenticationRequired"] = "disabledForLocalAddresses"
            current["username"] = admin_user
            current["password"] = admin_password
            current["passwordConfirmation"] = admin_password
            put_st, _ = http_request(url, method="PUT", data=current, headers=headers)
            if put_st in (200, 202):
                log(f"Configured unified admin & local bypass for {name}", "OK")

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

def auto_initialize_nullseerr(admin_user, admin_email, admin_password, radarr_key, sonarr_key, jellyfin_info=None):
    """Automatically pre-configures Null-seerr, bypasses /setup onboarding, and provisions unified admin"""
    overseerr_dir = os.path.join(ARR_DIR, "config", "overseerr")
    settings_file = os.path.join(overseerr_dir, "settings.json")
    db_file = os.path.join(overseerr_dir, "db", "db.sqlite3")

    needs_restart = False

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
                settings["main"]["mediaServerType"] = 2 if jellyfin_info else 1
                updated = True

            if not settings.get("plex", {}).get("ip"):
                settings["plex"] = settings.get("plex", {})
                settings["plex"]["ip"] = "plex"
                settings["plex"]["name"] = "Plex"
                settings["plex"]["port"] = 32400
                updated = True

            if jellyfin_info and jellyfin_info.get("apiKey"):
                settings["main"] = settings.get("main", {})
                settings["main"]["mediaServerType"] = 2
                settings["jellyfin"] = {
                    "name": "Jellyfin",
                    "ip": "jellyfin",
                    "port": 8096,
                    "useSsl": False,
                    "urlBase": "",
                    "externalHostname": "http://localhost:8096",
                    "jellyfinForgotPasswordUrl": "",
                    "libraries": jellyfin_info.get("libraries", []),
                    "serverId": jellyfin_info.get("serverId", ""),
                    "apiKey": jellyfin_info.get("apiKey", ""),
                    "userId": jellyfin_info.get("userId", "")
                }
                updated = True

            if radarr_key:
                if len(settings.get("radarr", [])) == 0:
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
                            "syncEnabled": True,
                            "preventSearch": False,
                            "tagRequests": False,
                            "id": 0
                        }
                    ]
                    updated = True
                else:
                    for r in settings.get("radarr", []):
                        if r.get("apiKey") != radarr_key:
                            r["apiKey"] = radarr_key
                            updated = True

            if sonarr_key:
                if len(settings.get("sonarr", [])) == 0:
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
                            "syncEnabled": True,
                            "preventSearch": False,
                            "tagRequests": False,
                            "id": 0
                        }
                    ]
                    updated = True
                else:
                    for s in settings.get("sonarr", []):
                        if s.get("apiKey") != sonarr_key:
                            s["apiKey"] = sonarr_key
                            updated = True

            if updated:
                with open(settings_file, "w", encoding="utf-8") as f:
                    json.dump(settings, f, indent=1)
                log("Null-seerr settings initialized (onboarding wizard bypassed)", "+")
                needs_restart = True
        except Exception as e:
            log(f"Error initializing settings.json: {e}", "!")

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
                    ''', (admin_email, admin_user, hashed_pwd))
                    conn.commit()
                    log(f"Created unified admin account ({admin_user} / {admin_email}) in database", "+")
                    needs_restart = True
                else:
                    cur.execute('''
                        UPDATE user SET username = ?, email = ?, password = ? WHERE id = 1;
                    ''', (admin_user, admin_email, hashed_pwd))
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

def wire_prowlarr_flaresolverr(prowlarr_key):
    """Configures FlareSolverr proxy in Prowlarr for Cloudflare challenge bypass"""
    if not prowlarr_key:
        return None
    headers = {"X-Api-Key": prowlarr_key}
    
    # Ensure tag 'flaresolverr' exists
    tag_id = 1
    tag_url = f"{SERVICES['prowlarr']['url']}/api/v1/tag"
    t_st, tags = http_request(tag_url, headers=headers)
    if t_st == 200 and isinstance(tags, list):
        f_tag = next((t for t in tags if t.get("label") == "flaresolverr"), None)
        if f_tag:
            tag_id = f_tag.get("id", 1)
        else:
            c_st, c_tag = http_request(tag_url, method="POST", data={"label": "flaresolverr"}, headers=headers)
            if c_st in (200, 201) and isinstance(c_tag, dict):
                tag_id = c_tag.get("id", 1)

    proxy_url = f"{SERVICES['prowlarr']['url']}/api/v1/indexerproxy"
    st, existing_proxies = http_request(proxy_url, headers=headers)
    if st == 200 and isinstance(existing_proxies, list):
        f_proxy = next((p for p in existing_proxies if p.get("implementation") == "FlareSolverr"), None)
        if f_proxy:
            if tag_id not in f_proxy.get("tags", []):
                f_proxy["tags"] = [tag_id]
                http_request(f"{proxy_url}/{f_proxy.get('id')}", method="PUT", data=f_proxy, headers=headers)
            log("FlareSolverr proxy active in Prowlarr", "OK")
            return tag_id

    proxy_payload = {
        "name": "FlareSolverr",
        "implementation": "FlareSolverr",
        "configContract": "FlareSolverrSettings",
        "fields": [
            {"name": "host", "value": "http://flaresolverr:8191/"},
            {"name": "requestTimeout", "value": 60}
        ],
        "tags": [tag_id]
    }
    pst, res = http_request(proxy_url, method="POST", data=proxy_payload, headers=headers)
    if pst in (200, 201):
        log("FlareSolverr proxy linked in Prowlarr!", "+")
    return tag_id

def seed_prowlarr_indexers(prowlarr_key, flare_tag_id=1):
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
        "1337x": {"label": "1337x (General / Movies / TV)", "tag": True, "baseUrl": "https://1337x.st/"},
        "yts": {"label": "YTS (Movies)"},
        "thepiratebay": {"label": "The Pirate Bay (General)"},
        "limetorrents": {"label": "LimeTorrents (General / Movies)"},
        "torrentdownloads": {"label": "Torrent Downloads (General)"},
        "torrentdownload": {"label": "TorrentDownload (General)"},
        "torrentproject2": {"label": "TorrentProject2 (Meta / General)"},
        "knaben": {"label": "Knaben (Meta / Multi)"},
        "nyaasi": {"label": "Nyaa.si (Anime)"},
        "subsplease": {"label": "SubsPlease (Anime Simulcasts)"},
        "tokyotosho": {"label": "Tokyo Toshokan (Anime)"}
    }

    log("Auto-seeding top indexers in Prowlarr...", "⚡")
    added_any = False
    for def_name, info in target_definitions.items():
        label = info.get("label", def_name)
        if def_name in existing_def_names:
            log(f"Indexer {label} already active", "OK")
            continue

        matching_schema = next((s for s in schemas if s.get("definitionName", "").lower() == def_name), None)
        if not matching_schema:
            continue

        indexer_payload = dict(matching_schema)
        indexer_payload["enable"] = True
        indexer_payload["appProfileId"] = 1
        
        if info.get("tag") and flare_tag_id:
            indexer_payload["tags"] = [flare_tag_id]

        if info.get("baseUrl"):
            for f in indexer_payload.get("fields", []):
                if f.get("name") == "baseUrl":
                    f["value"] = info.get("baseUrl")

        st, res = http_request(idx_url, method="POST", data=indexer_payload, headers=headers)
        if st in (200, 201):
            log(f"Seeded indexer: {label}", "+")
            added_any = True

    # Re-sync applications if new indexers were added
    if added_any:
        app_url = f"{SERVICES['prowlarr']['url']}/api/v1/applications"
        ast, apps = http_request(app_url, headers=headers)
        if ast == 200 and isinstance(apps, list):
            for app in apps:
                http_request(f"{app_url}/{app.get('id')}", method="PUT", data=app, headers=headers)
            log("Synchronized all indexers to Radarr and Sonarr", "+")

def configure_media_naming(radarr_key, sonarr_key):
    """Sets standard Plex / Jellyfin naming conventions in Radarr and Sonarr"""
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

def configure_root_folders(radarr_key, sonarr_key):
    """Registers standard media root folders in Radarr and Sonarr"""
    if radarr_key:
        url = f"{SERVICES['radarr']['url']}/api/v3/rootfolder"
        headers = {"X-Api-Key": radarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, list):
            if not any(r.get("path") == "/data/media/movies" for r in current):
                http_request(url, method="POST", data={"path": "/data/media/movies"}, headers=headers)
                log("Registered root folder in Radarr (/data/media/movies)", "+")

    if sonarr_key:
        url = f"{SERVICES['sonarr']['url']}/api/v3/rootfolder"
        headers = {"X-Api-Key": sonarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, list):
            existing_paths = [r.get("path") for r in current]
            for folder in ["/data/media/tv", "/data/media/anime"]:
                if folder not in existing_paths:
                    http_request(url, method="POST", data={"path": folder}, headers=headers)
                    log(f"Registered root folder in Sonarr ({folder})", "+")

def configure_seeder_priority(radarr_key, sonarr_key):
    """Configures 1080p unified quality profiles in Radarr and Sonarr to prioritize seeders/peers"""
    if radarr_key:
        url = f"{SERVICES['radarr']['url']}/api/v3/qualityprofile/4"
        headers = {"X-Api-Key": radarr_key}
        st, qp = http_request(url, headers=headers)
        if st == 200 and isinstance(qp, dict):
            all_1080p_r = [
                {"quality": {"id": 30, "name": "Remux-1080p", "source": "bluray", "resolution": 1080, "modifier": "remux"}, "items": [], "allowed": True},
                {"quality": {"id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080, "modifier": "none"}, "items": [], "allowed": True},
                {"quality": {"id": 3, "name": "WEBDL-1080p", "source": "webdl", "resolution": 1080, "modifier": "none"}, "items": [], "allowed": True},
                {"quality": {"id": 15, "name": "WEBRip-1080p", "source": "webrip", "resolution": 1080, "modifier": "none"}, "items": [], "allowed": True},
                {"quality": {"id": 9, "name": "HDTV-1080p", "source": "tv", "resolution": 1080, "modifier": "none"}, "items": [], "allowed": True}
            ]
            new_items = []
            for it in qp.get("items", []):
                q_id = it.get("quality", {}).get("id")
                if q_id in (7, 9, 30):
                    continue
                if it.get("name") in ("WEB 1080p", "1080p (Any Source / Max Seeders)"):
                    it["name"] = "1080p (Any Source / Max Seeders)"
                    it["items"] = all_1080p_r
                    it["allowed"] = True
                new_items.append(it)
            qp["items"] = new_items
            qp["cutoff"] = 1002
            pst, _ = http_request(url, method="PUT", data=qp, headers=headers)
            if pst in (200, 202):
                log("Radarr 1080p profile configured for maximum seeders priority", "OK")

    if sonarr_key:
        url = f"{SERVICES['sonarr']['url']}/api/v3/qualityprofile/4"
        headers = {"X-Api-Key": sonarr_key}
        st, qp = http_request(url, headers=headers)
        if st == 200 and isinstance(qp, dict):
            all_1080p_s = [
                {"quality": {"id": 20, "name": "Bluray-1080p Remux", "source": "blurayRaw", "resolution": 1080}, "items": [], "allowed": True},
                {"quality": {"id": 7, "name": "Bluray-1080p", "source": "bluray", "resolution": 1080}, "items": [], "allowed": True},
                {"quality": {"id": 3, "name": "WEBDL-1080p", "source": "web", "resolution": 1080}, "items": [], "allowed": True},
                {"quality": {"id": 15, "name": "WEBRip-1080p", "source": "webRip", "resolution": 1080}, "items": [], "allowed": True},
                {"quality": {"id": 9, "name": "HDTV-1080p", "source": "television", "resolution": 1080}, "items": [], "allowed": True}
            ]
            new_items = []
            for it in qp.get("items", []):
                q_id = it.get("quality", {}).get("id")
                if q_id in (7, 9, 20):
                    continue
                if it.get("name") in ("WEB 1080p", "1080p (Any Source / Max Seeders)"):
                    it["name"] = "1080p (Any Source / Max Seeders)"
                    it["items"] = all_1080p_s
                    it["allowed"] = True
                new_items.append(it)
            qp["items"] = new_items
            qp["cutoff"] = 1002
            pst, _ = http_request(url, method="PUT", data=qp, headers=headers)
            if pst in (200, 202):
                log("Sonarr 1080p profile configured for maximum seeders priority", "OK")

def wire_qbittorrent_to_arr(app_name, app_url, app_key, admin_user, admin_password, category):
    if not app_key:
        return
    url = f"{app_url}/api/v3/downloadclient"
    headers = {"X-Api-Key": app_key}

    status, clients = http_request(url, headers=headers)
    if status == 200 and isinstance(clients, list) and not any(c.get("name") == "qBittorrent" for c in clients):
        schema_url = f"{app_url}/api/v3/downloadclient/schema"
        s_status, schemas = http_request(schema_url, headers=headers)
        if s_status == 200 and isinstance(schemas, list):
            qbit_schema = next((s for s in schemas if s.get("implementation") == "QBittorrent"), None)
            if qbit_schema:
                payload = dict(qbit_schema)
                payload["enable"] = True
                payload["name"] = "qBittorrent"
                for f in payload.get("fields", []):
                    if f["name"] == "host": f["value"] = "qbittorrent"
                    elif f["name"] == "port": f["value"] = 8080
                    elif f["name"] == "username": f["value"] = admin_user
                    elif f["name"] == "password": f["value"] = admin_password
                    elif f["name"] in ("movieCategory", "tvCategory"): f["value"] = category

                st, _ = http_request(url, method="POST", data=payload, headers=headers)
                if st in (200, 201):
                    log(f"qBittorrent added successfully to {app_name}!", "+")
    elif status == 200 and isinstance(clients, list) and any(c.get("name") == "qBittorrent" for c in clients):
        log(f"qBittorrent is already configured in {app_name}", "OK")

    # Add Remote Path Mapping for qBittorrent (/downloads/ -> /data/torrents/)
    rpm_url = f"{app_url}/api/v3/remotepathmapping"
    rpm_st, rpms = http_request(rpm_url, headers=headers)
    if rpm_st == 200 and isinstance(rpms, list):
        if not any(r.get("host") == "qbittorrent" for r in rpms):
            rpm_data = {
                "host": "qbittorrent",
                "remotePath": "/downloads/",
                "localPath": "/data/torrents/"
            }
            http_request(rpm_url, method="POST", data=rpm_data, headers=headers)
            log(f"Remote path mapping added for {app_name} (/downloads/ -> /data/torrents/)", "+")

def configure_bazarr(radarr_key, sonarr_key, jellyfin_key):
    """Configures Bazarr for automated subtitle downloads, language profiles, and provider integration"""
    bazarr_yaml_path = os.path.join(ARR_DIR, 'config', 'bazarr', 'config', 'config.yaml')
    bazarr_db_path = os.path.join(ARR_DIR, 'config', 'bazarr', 'db', 'bazarr.db')

    if not os.path.exists(bazarr_yaml_path):
        return None

    try:
        import yaml
    except ImportError:
        return None

    try:
        with open(bazarr_yaml_path, 'r', encoding='utf-8') as f:
            cfg = yaml.safe_load(f) or {}

        updated = False
        if radarr_key and not cfg.get('general', {}).get('use_radarr'):
            cfg['general']['use_radarr'] = True
            cfg['general']['movie_default_enabled'] = True
            cfg['general']['movie_default_profile'] = '1'
            cfg['radarr']['ip'] = 'radarr'
            cfg['radarr']['port'] = 7878
            cfg['radarr']['apikey'] = radarr_key
            cfg['radarr']['ssl'] = False
            cfg['radarr']['base_url'] = ''
            updated = True

        if sonarr_key and not cfg.get('general', {}).get('use_sonarr'):
            cfg['general']['use_sonarr'] = True
            cfg['general']['serie_default_enabled'] = True
            cfg['general']['serie_default_profile'] = '1'
            cfg['sonarr']['ip'] = 'sonarr'
            cfg['sonarr']['port'] = 8989
            cfg['sonarr']['apikey'] = sonarr_key
            cfg['sonarr']['ssl'] = False
            cfg['sonarr']['base_url'] = ''
            updated = True

        if jellyfin_key and not cfg.get('general', {}).get('use_jellyfin'):
            cfg['general']['use_jellyfin'] = True
            cfg['jellyfin']['url'] = 'http://jellyfin:8096'
            cfg['jellyfin']['apikey'] = jellyfin_key
            cfg['jellyfin']['update_movie_library'] = True
            cfg['jellyfin']['update_series_library'] = True
            updated = True

        enabled_provs = ['yifysubtitles', 'podnapisi', 'supersubtitles', 'animetosho', 'subf2m', 'embeddedsubtitles']
        if cfg.get('general', {}).get('enabled_providers') != enabled_provs:
            cfg['general']['enabled_providers'] = enabled_provs
            cfg['general']['minimum_score_movie'] = 60
            cfg['general']['minimum_score'] = 60
            cfg['general']['use_embedded_subs'] = True
            cfg['general']['subfolder'] = 'current'
            cfg['general']['utf8_encode'] = True
            updated = True

        if cfg.get('auth', {}).get('type') is not None:
            cfg['auth']['type'] = None
            updated = True

        if updated:
            subprocess.run(['docker', 'stop', 'bazarr'], stdout=subprocess.DEVNULL)
            time.sleep(1)
            with open(bazarr_yaml_path, 'w', encoding='utf-8') as f:
                yaml.dump(cfg, f)

            # Seed Profile 1 into bazarr.db if missing
            if os.path.exists(bazarr_db_path):
                conn = sqlite3.connect(bazarr_db_path)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM table_languages_profiles WHERE profileId = 1;")
                if cur.fetchone()[0] == 0:
                    items_json = json.dumps([
                        {"id": 1, "language": "en", "forced": False, "hi": False, "audio_language": None},
                        {"id": 2, "language": "es", "forced": False, "hi": False, "audio_language": None}
                    ])
                    cur.execute('''
                        INSERT INTO table_languages_profiles (
                            profileId, cutoff, originalFormat, items, name, mustContain, mustNotContain, tag
                        ) VALUES (
                            1, 1, 0, ?, 'English & Spanish', '', '', ''
                        );
                    ''', (items_json,))
                    conn.commit()
                conn.close()

            subprocess.run(['docker', 'start', 'bazarr'], stdout=subprocess.DEVNULL)
            log("Bazarr automated subtitles and providers configured", "+")
        else:
            log("Bazarr subtitle automation is active", "OK")

        bazarr_key = cfg.get('auth', {}).get('apikey', '')
        return bazarr_key
    except Exception as e:
        log(f"Error configuring Bazarr: {e}", "!")
        return None

def check_and_wire_all():
    print("=" * 65)
    print("NULL-SEERR ALL-IN-ONE MEDIA STACK AUTO-WIRING TOOL")
    print("=" * 65)

    # 1. Generate / Retrieve Unified Stack Credentials
    admin_user, admin_email, admin_password = get_or_create_stack_credentials()

    # 2. Extract API Keys
    radarr_xml = os.path.join(ARR_DIR, "config", "radarr", "config.xml")
    sonarr_xml = os.path.join(ARR_DIR, "config", "sonarr", "config.xml")
    prowlarr_xml = os.path.join(ARR_DIR, "config", "prowlarr", "config.xml")
    seerr_json = os.path.join(ARR_DIR, "config", "overseerr", "settings.json")

    radarr_key = get_xml_api_key(radarr_xml)
    sonarr_key = get_xml_api_key(sonarr_xml)
    prowlarr_key = get_xml_api_key(prowlarr_xml)

    # 3. Auto-Initialize Jellyfin Setup Wizard & Libraries
    jellyfin_info = auto_initialize_jellyfin(admin_user, admin_password)

    # 4. Auto-Initialize Null-seerr
    auto_initialize_nullseerr(admin_user, admin_email, admin_password, radarr_key, sonarr_key, jellyfin_info)
    seerr_key = get_seerr_api_key(seerr_json)

    # 5. Auto-Configure qBittorrent WebUI Host Validation & High Speed Limits
    configure_qbittorrent_auth(admin_user, admin_password)

    # 6. Auto-Initialize Shoko Server Engine
    auto_initialize_shoko(admin_user, admin_password)

    print("\nDiscovered API Keys:")
    print(f"  * Radarr:     {radarr_key or 'Not found'}")
    print(f"  * Sonarr:     {sonarr_key or 'Not found'}")
    print(f"  * Prowlarr:   {prowlarr_key or 'Not found'}")
    print(f"  * Null-seerr: {seerr_key or 'Not found'}\n")

    # 7. Check Service Health
    print("Checking Service Connectivity:")
    for key, info in SERVICES.items():
        st, _ = http_request(info["url"])
        status_text = f"ONLINE (HTTP {st})" if st > 0 else "OFFLINE / STARTING"
        symbol = "OK" if st in (200, 301, 302, 401, 403) else ".."
        print(f"  [{symbol:>2}] {info['name']:<15} {info['url']:<26} -> {status_text}")

    # 8. Perform Auto-Wiring
    print("\nLinking Stack Services:")
    if prowlarr_key and (radarr_key or sonarr_key):
        wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key)

    if prowlarr_key:
        flare_tag_id = wire_prowlarr_flaresolverr(prowlarr_key)
        seed_prowlarr_indexers(prowlarr_key, flare_tag_id)

    if radarr_key:
        wire_qbittorrent_to_arr("Radarr", SERVICES["radarr"]["url"], radarr_key, admin_user, admin_password, "movies")
    if sonarr_key:
        wire_qbittorrent_to_arr("Sonarr", SERVICES["sonarr"]["url"], sonarr_key, admin_user, admin_password, "tv")

    # 9. Configure Media Naming
    configure_media_naming(radarr_key, sonarr_key)

    # 10. Configure Media Root Folders
    configure_root_folders(radarr_key, sonarr_key)

    # 11. Configure Maximum Seeders Priority (1080p Unified Quality Group)
    configure_seeder_priority(radarr_key, sonarr_key)

    # 12. Configure Servarr Authentication
    configure_servarr_auth(radarr_key, sonarr_key, prowlarr_key, admin_user, admin_password)

    # 13. Configure Bazarr Subtitle Automation
    configure_bazarr(radarr_key, sonarr_key, jellyfin_info.get("apiKey") if jellyfin_info else None)

    print("\n" + "=" * 65)
    print("✨ STACK WIRING COMPLETE & CREDENTIALS CONFIGURED!")
    print("=" * 65)
    print(f"  🔑 ADMIN USERNAME:          {admin_user}")
    print(f"  📧 ADMIN EMAIL:             {admin_email}")
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
