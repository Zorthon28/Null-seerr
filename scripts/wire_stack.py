#!/usr/bin/env python3
"""
Null-seerr All-In-One Media Stack CLI Wiring Utility & Init Engine
Automatically extracts/generates API keys, generates secure unified stack credentials,
seeds pre-configured templates, tests connections, and wires together:
- Dynamic Random Password & Per-Installation Secret Generation for the entire stack
- Jellyfin Auto-Initialization (Bypasses startup wizard, creates libraries & admin with stack password)
- Plex Media Server Auto-Initialization (Provisions Movies, TV Shows, Anime libraries when enabled)
- Null-seerr Auto-Initialization (Skips onboarding wizard, creates admin, wires Jellyfin/Plex/Radarr/Sonarr)
- Shoko Server Auto-Initialization (Bypasses setup wizard, creates admin, starts server when enabled)
- qBittorrent WebUI Host Validation, Save Path & Max Throughput Optimization
- Bazarr Auto-Configuration (Wires Radarr, Sonarr, Jellyfin, free subtitle providers & English + Spanish dual profiles)
- Auto-registers Root Media Folders in Radarr & Sonarr (/data/media/movies, /data/media/tv, /data/media/anime)
- Unified 1080p Quality Profile in Radarr & Sonarr (Groups Remux/Bluray/WEB into single flexible tier)
- Configure Unified Admin & Local Address Bypass across Radarr, Sonarr, and Prowlarr
- Prowlarr <-> Radarr & Sonarr (Indexers & Sync)
- Prowlarr Auto-Seeder (1337x, YTS, The Pirate Bay, LimeTorrents, Torrent Downloads, TorrentDownload, TorrentProject2, Knaben, Nyaa, SubsPlease, Tokyo Toshokan)
- Prowlarr <-> FlareSolverr (Cloudflare bypass proxy)
- qBittorrent <-> Radarr & Sonarr (Download Client with Category Routing & Remote Path Mappings)
- Plex & Jellyfin Standard Media Naming Rules in Radarr & Sonarr
"""

import os
import sys
import json
import time
import uuid
import shutil
import base64
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

IN_DOCKER = os.environ.get("RUNNING_IN_DOCKER", "").lower() in ("true", "1", "yes") or os.path.exists("/.dockerenv")

ARR_DIR = os.environ.get("STACK_ROOT", "/opt/arr-stack" if sys.platform != "win32" else r"C:\arr-stack")
CONFIG_ROOT = "/config" if IN_DOCKER else os.path.join(ARR_DIR, "config")
DATA_ROOT = "/data" if IN_DOCKER else os.path.join(ARR_DIR, "data")
CREDENTIALS_FILE = "/config/CREDENTIALS.txt" if IN_DOCKER else os.path.join(ARR_DIR, "CREDENTIALS.txt")
TEMPLATES_DIR = "/templates" if IN_DOCKER else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")

# Core & Optional Services
SERVICES = {
    "seerr": {"url": "http://localhost:5055", "docker_url": "http://seerr:5055", "name": "Null-seerr", "core": True},
    "radarr": {"url": "http://localhost:7878", "docker_url": "http://radarr:7878", "name": "Radarr", "core": True},
    "sonarr": {"url": "http://localhost:8989", "docker_url": "http://sonarr:8989", "name": "Sonarr", "core": True},
    "prowlarr": {"url": "http://localhost:9696", "docker_url": "http://prowlarr:9696", "name": "Prowlarr", "core": True},
    "qbittorrent": {"url": "http://localhost:8089", "docker_url": "http://qbittorrent:8080", "name": "qBittorrent", "core": True},
    "flaresolverr": {"url": "http://localhost:8191", "docker_url": "http://flaresolverr:8191", "name": "FlareSolverr", "core": True},
    "jellyfin": {"url": "http://localhost:8096", "docker_url": "http://jellyfin:8096", "name": "Jellyfin", "core": True},
    "bazarr": {"url": "http://localhost:6767", "docker_url": "http://bazarr:6767", "name": "Bazarr", "core": True},
    "plex": {"url": "http://localhost:32400", "docker_url": "http://plex:32400", "name": "Plex", "core": False},
    "suggestarr": {"url": "http://localhost:4455", "docker_url": "http://suggestarr:5000", "name": "Suggestarr", "core": False},
    "shoko": {"url": "http://localhost:8111", "docker_url": "http://shoko:8111", "name": "Shoko Server", "core": False},
    "tdarr": {"url": "http://localhost:8265", "docker_url": "http://tdarr:8265", "name": "Tdarr", "core": False},
}

def get_url(service_key):
    info = SERVICES.get(service_key, {})
    return info.get("docker_url" if IN_DOCKER else "url", "")

def log(msg, symbol="*"):
    print(f"[{symbol}] {msg}")

def generate_random_api_key():
    """Generates a 32-character hexadecimal API key"""
    return secrets.token_hex(16)

def generate_session_secret():
    """Generates a 64-character hexadecimal session secret"""
    return secrets.token_hex(32)

def generate_seerr_api_key():
    """Generates a base64 encoded API key matching Overseerr format"""
    raw = f"{int(time.time() * 1000)}{secrets.token_hex(16)}"
    return base64.b64encode(raw.encode("utf-8")).decode("utf-8")

def get_xml_api_key(config_path):
    if not os.path.exists(config_path):
        return None
    try:
        tree = ET.parse(config_path)
        root = tree.getroot()
        api_elem = root.find("ApiKey")
        if api_elem is not None and api_elem.text and api_elem.text.strip():
            return api_elem.text.strip()
    except Exception as e:
        log(f"Error reading {config_path}: {e}", "!")
    return None

def set_xml_api_key(config_path, new_key):
    """Ensures XML config file has the specified ApiKey"""
    try:
        os.makedirs(os.path.dirname(config_path), exist_ok=True)
        if os.path.exists(config_path):
            tree = ET.parse(config_path)
            root = tree.getroot()
            api_elem = root.find("ApiKey")
            if api_elem is None:
                api_elem = ET.SubElement(root, "ApiKey")
            api_elem.text = new_key
            tree.write(config_path, encoding="utf-8", xml_declaration=True)
        return True
    except Exception as e:
        log(f"Error updating API key in {config_path}: {e}", "!")
        return False

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

def seed_templates():
    """Copies pre-seeded configuration bundles with dynamically generated unique secrets"""
    radarr_xml = os.path.join(CONFIG_ROOT, "radarr", "config.xml")
    sonarr_xml = os.path.join(CONFIG_ROOT, "sonarr", "config.xml")
    prowlarr_xml = os.path.join(CONFIG_ROOT, "prowlarr", "config.xml")
    bazarr_yaml = os.path.join(CONFIG_ROOT, "bazarr", "config", "config.yaml")
    overseerr_json = os.path.join(CONFIG_ROOT, "overseerr", "settings.json")
    qbit_conf = os.path.join(CONFIG_ROOT, "qbittorrent", "qBittorrent", "qBittorrent.conf")

    # 1. Discover or generate unique API keys per installation
    radarr_key = get_xml_api_key(radarr_xml) or generate_random_api_key()
    sonarr_key = get_xml_api_key(sonarr_xml) or generate_random_api_key()
    prowlarr_key = get_xml_api_key(prowlarr_xml) or generate_random_api_key()
    bazarr_key = generate_random_api_key()

    if os.path.exists(bazarr_yaml):
        try:
            import yaml
            with open(bazarr_yaml, "r", encoding="utf-8") as f:
                b_cfg = yaml.safe_load(f) or {}
                if b_cfg.get("auth", {}).get("apikey"):
                    bazarr_key = b_cfg["auth"]["apikey"]
        except Exception:
            pass

    # 2. Seed and inject unique keys
    xml_targets = [
        ("radarr/config.xml", radarr_xml, radarr_key),
        ("sonarr/config.xml", sonarr_xml, sonarr_key),
        ("prowlarr/config.xml", prowlarr_xml, prowlarr_key),
    ]

    for src_rel, dest, key in xml_targets:
        src = os.path.join(TEMPLATES_DIR, src_rel)
        if not os.path.exists(dest) and os.path.exists(src):
            try:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                shutil.copy2(src, dest)
                set_xml_api_key(dest, key)
                log(f"Seeded configuration with unique key: {src_rel}", "+")
            except Exception as e:
                log(f"Could not seed {src_rel}: {e}", "!")
        elif os.path.exists(dest):
            curr_key = get_xml_api_key(dest)
            if not curr_key:
                set_xml_api_key(dest, key)

    # 3. Seed Bazarr YAML
    bazarr_src = os.path.join(TEMPLATES_DIR, "bazarr", "config", "config.yaml")
    if not os.path.exists(bazarr_yaml) and os.path.exists(bazarr_src):
        try:
            os.makedirs(os.path.dirname(bazarr_yaml), exist_ok=True)
            shutil.copy2(bazarr_src, bazarr_yaml)
            try:
                import yaml
                with open(bazarr_yaml, "r", encoding="utf-8") as f:
                    cfg = yaml.safe_load(f) or {}
                cfg.setdefault("auth", {})["apikey"] = bazarr_key
                cfg.setdefault("radarr", {})["apikey"] = radarr_key
                cfg.setdefault("sonarr", {})["apikey"] = sonarr_key
                with open(bazarr_yaml, "w", encoding="utf-8") as f:
                    yaml.dump(cfg, f)
            except Exception:
                pass
            log("Seeded configuration with unique key: bazarr/config.yaml", "+")
        except Exception as e:
            log(f"Could not seed Bazarr config: {e}", "!")

    # 4. Seed Overseerr / Null-seerr settings.json
    seerr_src = os.path.join(TEMPLATES_DIR, "overseerr", "settings.json")
    if not os.path.exists(overseerr_json) and os.path.exists(seerr_src):
        try:
            os.makedirs(os.path.dirname(overseerr_json), exist_ok=True)
            with open(seerr_src, "r", encoding="utf-8") as f:
                settings = json.load(f)
            
            settings["clientId"] = str(uuid.uuid4())
            settings["sessionSecret"] = generate_session_secret()
            settings.setdefault("main", {})["apiKey"] = generate_seerr_api_key()
            
            if settings.get("radarr") and len(settings["radarr"]) > 0:
                settings["radarr"][0]["apiKey"] = radarr_key
            if settings.get("sonarr") and len(settings["sonarr"]) > 0:
                settings["sonarr"][0]["apiKey"] = sonarr_key

            with open(overseerr_json, "w", encoding="utf-8") as f:
                json.dump(settings, f, indent=1)
            log("Seeded configuration with unique secrets: overseerr/settings.json", "+")
        except Exception as e:
            log(f"Could not seed Overseerr settings: {e}", "!")

    # 5. Seed qBittorrent template
    qbit_src = os.path.join(TEMPLATES_DIR, "qbittorrent", "qBittorrent.conf")
    if not os.path.exists(qbit_conf) and os.path.exists(qbit_src):
        try:
            os.makedirs(os.path.dirname(qbit_conf), exist_ok=True)
            shutil.copy2(qbit_src, qbit_conf)
            log("Seeded configuration template: qbittorrent/qBittorrent.conf", "+")
        except Exception as e:
            log(f"Could not seed qBittorrent config: {e}", "!")

def get_or_create_stack_credentials():
    """Generates or loads a secure temporary password for the admin account across the stack"""
    user = "admin"
    email = "admin@nullseerr.local"
    password = None

    candidates = [
        CREDENTIALS_FILE,
        os.path.join(CONFIG_ROOT, "CREDENTIALS.txt"),
        os.path.join(ARR_DIR, "CREDENTIALS.txt"),
        "/CREDENTIALS.txt",
        "/config/CREDENTIALS.txt",
    ]

    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            try:
                with open(candidate, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("PASSWORD:"):
                            password = line.split(":", 1)[1].strip()
                        elif line.startswith("USER:"):
                            user = line.split(":", 1)[1].strip()
                        elif line.startswith("EMAIL:"):
                            email = line.split(":", 1)[1].strip()
                if password:
                    break
            except Exception:
                pass

    if not password:
        alphabet = string.ascii_letters + string.digits + "!@#$"
        password = "".join(secrets.choice(alphabet) for _ in range(16))
        content = f"USER: {user}\nEMAIL: {email}\nPASSWORD: {password}\nGENERATED: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
        
        target_files = [CREDENTIALS_FILE]
        if IN_DOCKER:
            target_files.extend(["/CREDENTIALS.txt", "/config/CREDENTIALS.txt"])
        else:
            target_files.append(os.path.join(CONFIG_ROOT, "CREDENTIALS.txt"))

        for tf in target_files:
            try:
                os.makedirs(os.path.dirname(os.path.abspath(tf)), exist_ok=True)
                with open(tf, "w", encoding="utf-8") as f:
                    f.write(content)
            except Exception as e:
                log(f"Warning: Could not save credentials file ({tf}): {e}", "!")

    return user, email, password

def hash_password(password):
    """Hashes password using bcrypt via container, python, or local runtime"""
    try:
        import bcrypt
        return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    except ImportError:
        pass

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
    """Sets WebUI host headers, robust authentication, and high-throughput connection limits in qBittorrent"""
    conf_path = os.path.join(CONFIG_ROOT, "qbittorrent", "qBittorrent", "qBittorrent.conf")
    if not os.path.exists(conf_path):
        return

    try:
        with open(conf_path, "r", encoding="utf-8") as f:
            content = f.read()

        if "HostHeaderValidation=true" in content and "MaxConnections=1500" in content and "CSRFProtection=true" in content and "ServerDomains=localhost" in content:
            log("qBittorrent WebUI security and throughput optimizations configured", "OK")
            return

        if not IN_DOCKER:
            subprocess.run(["docker", "stop", "qbittorrent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(1)

        with open(conf_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        new_lines = []
        for line in lines:
            if not line.startswith("WebUI\\") and not line.startswith("Session\\") and not line.startswith("Connection\\") and not line.startswith("Downloads\\"):
                new_lines.append(line)

        pref_idx = -1
        bittorrent_idx = -1
        for idx, l in enumerate(new_lines):
            if l.strip() == "[Preferences]":
                pref_idx = idx
            elif l.strip() == "[BitTorrent]":
                bittorrent_idx = idx

        webui_settings = [
            "WebUI\\Address=0.0.0.0\n",
            "WebUI\\ServerDomains=localhost, 127.0.0.1, qbittorrent\n",
            "WebUI\\HostHeaderValidation=true\n",
            "WebUI\\CSRFProtection=true\n",
            "WebUI\\ClickjackingProtection=true\n",
            "WebUI\\AuthSubnetWhitelist=\n",
            "WebUI\\AuthSubnetWhitelistEnabled=false\n",
            "WebUI\\LocalHostAuth=true\n",
            "Downloads\\SavePath=/data/torrents/\n",
            "Downloads\\TempPath=/data/torrents/incomplete/\n",
            "Connection\\PortRangeMin=6881\n",
            "Connection\\UPnP=false\n",
            "Connection\\ResolvePeerCountries=false\n"
        ]

        bittorrent_settings = [
            "Session\\DefaultSavePath=/data/torrents/\n",
            "Session\\TempPath=/data/torrents/incomplete/\n",
            "Session\\MaxConnections=1500\n",
            "Session\\MaxConnectionsPerTorrent=500\n",
            "Session\\MaxUploads=100\n",
            "Session\\MaxUploadsPerTorrent=20\n",
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
            "Session\\QueueingSystemEnabled=true\n",
            "Session\\MaxActiveDownloads=20\n",
            "Session\\MaxActiveTorrents=50\n",
            "Session\\MaxActiveUploads=20\n",
            "Session\\IgnoreSlowTorrentsForQueueing=true\n"
        ]

        if pref_idx != -1:
            for s in reversed(webui_settings):
                new_lines.insert(pref_idx + 1, s)
        else:
            new_lines.append("\n[Preferences]\n")
            new_lines.extend(webui_settings)

        if bittorrent_idx != -1:
            for s in reversed(bittorrent_settings):
                new_lines.insert(bittorrent_idx + 1, s)
        else:
            new_lines.append("\n[BitTorrent]\n")
            new_lines.extend(bittorrent_settings)

        with open(conf_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)

        if not IN_DOCKER:
            subprocess.run(["docker", "start", "qbittorrent"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log("Configured qBittorrent with secure WebUI auth & high throughput tuning", "OK")
    except Exception as e:
        log(f"Error configuring qBittorrent: {e}", "!")

def auto_initialize_jellyfin(admin_user, admin_password):
    """Automatically completes Jellyfin setup wizard, provisions libraries, and generates API key for Null-seerr"""
    base = get_url("jellyfin")
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

def configure_plex():
    """Configures Plex library sections for Movies (/data/media/movies), TV Shows (/data/media/tv), and Anime (/data/media/anime)"""
    base = get_url("plex")
    st, _ = http_request(f"{base}/identity")
    if st <= 0:
        return None

    pref_path = os.path.join(CONFIG_ROOT, "plex", "Library", "Application Support", "Plex Media Server", "Preferences.xml")
    if not os.path.exists(pref_path):
        return None

    try:
        tree = ET.parse(pref_path)
        token = tree.getroot().get("PlexOnlineToken")
        if not token:
            return None

        st, sec_res = http_request(f"{base}/library/sections?X-Plex-Token={token}", headers={"Accept": "application/json"})
        existing_names = []
        if st == 200 and isinstance(sec_res, dict):
            for s in sec_res.get("MediaContainer", {}).get("Directory", []):
                existing_names.append(s.get("title"))

        libraries_to_create = [
            {"name": "Movies", "type": "movie", "agent": "tv.plex.agents.movie", "scanner": "Plex Movie", "location": "/data/media/movies", "language": "en-US"},
            {"name": "TV Shows", "type": "show", "agent": "tv.plex.agents.series", "scanner": "Plex TV Series", "location": "/data/media/tv", "language": "en-US"},
            {"name": "Anime", "type": "show", "agent": "tv.plex.agents.series", "scanner": "Plex TV Series", "location": "/data/media/anime", "language": "en-US"}
        ]

        for lib in libraries_to_create:
            if lib["name"] not in existing_names:
                params = urllib.parse.urlencode({
                    "name": lib["name"],
                    "type": lib["type"],
                    "agent": lib["agent"],
                    "scanner": lib["scanner"],
                    "language": lib["language"],
                    "location": lib["location"],
                    "X-Plex-Token": token
                })
                create_url = f"{base}/library/sections?{params}"
                c_st, _ = http_request(create_url, method="POST", headers={"Accept": "application/json"})
                if c_st in (200, 201):
                    log(f"Created Plex Library Section: {lib['name']} ({lib['location']})", "+")
            else:
                log(f"Plex Library Section active: {lib['name']} ({lib['location']})", "OK")

        st2, sec_res2 = http_request(f"{base}/library/sections?X-Plex-Token={token}", headers={"Accept": "application/json"})
        plex_sections = []
        if st2 == 200 and isinstance(sec_res2, dict):
            for s in sec_res2.get("MediaContainer", {}).get("Directory", []):
                plex_sections.append({
                    "id": str(s.get("key")),
                    "name": s.get("title"),
                    "type": s.get("type"),
                    "enabled": True
                })
                http_request(f"{base}/library/sections/{s.get('key')}/refresh?X-Plex-Token={token}")

        return {
            "token": token,
            "libraries": plex_sections
        }
    except Exception as e:
        log(f"Error configuring Plex libraries: {e}", "!")
        return None

def auto_initialize_shoko(admin_user, admin_password):
    """Automatically completes Shoko Server first time setup, starts engine, and registers anime import folder"""
    base = get_url("shoko")
    st, _ = http_request(f"{base}/api/v3/Init/Status")
    if st <= 0:
        return

    try:
        st, status = http_request(f"{base}/api/v3/Init/Status")
        if st == 200 and isinstance(status, dict):
            if status.get("State") not in ("Starting", "Started", "Running"):
                http_request(f"{base}/api/v3/Init/DefaultUser", method="POST", data={"Username": admin_user, "Password": admin_password, "IsAdmin": True})
                http_request(f"{base}/api/v3/Init/StartServer", method="GET")
                log("Shoko Server default admin provisioned and engine started", "+")
            else:
                log("Shoko Server engine is active", "OK")

        auth_data = json.dumps({"user": admin_user, "pass": admin_password, "device": "cli", "remember": True}).encode("utf-8")
        a_st, a_res = http_request(f"{base}/api/auth", method="POST", data=auth_data, headers={"Content-Type": "application/json"})
        if a_st == 200 and isinstance(a_res, dict):
            token = a_res.get("apikey")
            if token:
                headers = {"apikey": token, "Content-Type": "application/json", "Accept": "application/json"}
                f_st, folders = http_request(f"{base}/api/v3/ImportFolder", headers=headers)
                if f_st == 200 and isinstance(folders, list):
                    if not any(f.get("Path") == "/data/media/anime" for f in folders):
                        add_data = {"Path": "/data/media/anime", "Name": "Anime Library", "DropFolderType": "Both", "WatchForNewFiles": True}
                        http_request(f"{base}/api/v3/ImportFolder", method="POST", data=add_data, headers=headers)
                        log("Created Shoko Import Folder: /data/media/anime", "+")
                    else:
                        log("Shoko Import Folder active: /data/media/anime", "OK")
    except Exception as e:
        log(f"Could not auto-initialize Shoko: {e}", "!")

def http_request(url, method="GET", data=None, headers=None, timeout=10):
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
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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

def auto_initialize_nullseerr(admin_user, admin_email, admin_password, radarr_key, sonarr_key, jellyfin_info=None, plex_info=None):
    """Automatically pre-configures Null-seerr, bypasses /setup onboarding, and provisions unified admin"""
    overseerr_dir = os.path.join(CONFIG_ROOT, "overseerr")
    settings_file = os.path.join(overseerr_dir, "settings.json")
    db_file = os.path.join(overseerr_dir, "db", "db.sqlite3")

    needs_restart = False

    if os.path.exists(settings_file):
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                settings = json.load(f)

            updated = False

            if not settings.get("clientId"):
                settings["clientId"] = str(uuid.uuid4())
                updated = True
            if not settings.get("sessionSecret"):
                settings["sessionSecret"] = generate_session_secret()
                updated = True
            if not settings.get("main", {}).get("apiKey"):
                settings.setdefault("main", {})["apiKey"] = generate_seerr_api_key()
                updated = True

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

            if plex_info and plex_info.get("libraries"):
                settings["plex"] = settings.get("plex", {})
                settings["plex"]["ip"] = "plex"
                settings["plex"]["name"] = "Plex"
                settings["plex"]["port"] = 32400
                settings["plex"]["libraries"] = plex_info.get("libraries", [])
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

    if needs_restart and not IN_DOCKER:
        try:
            subprocess.run(["docker", "restart", "null-seerr"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(4)
        except Exception:
            pass

def wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key):
    if not prowlarr_key:
        return

    url = f"{get_url('prowlarr')}/api/v1/applications"
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
    
    tag_id = 1
    tag_url = f"{get_url('prowlarr')}/api/v1/tag"
    t_st, tags = http_request(tag_url, headers=headers)
    if t_st == 200 and isinstance(tags, list):
        f_tag = next((t for t in tags if t.get("label") == "flaresolverr"), None)
        if f_tag:
            tag_id = f_tag.get("id", 1)
        else:
            c_st, c_tag = http_request(tag_url, method="POST", data={"label": "flaresolverr"}, headers=headers)
            if c_st in (200, 201) and isinstance(c_tag, dict):
                tag_id = c_tag.get("id", 1)

    proxy_url = f"{get_url('prowlarr')}/api/v1/indexerproxy"
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

    idx_url = f"{get_url('prowlarr')}/api/v1/indexer"
    status, existing = http_request(idx_url, headers=headers)
    if status != 200:
        return

    existing_def_names = [i.get("definitionName", "").lower() for i in existing] if isinstance(existing, list) else []

    schema_url = f"{get_url('prowlarr')}/api/v1/indexer/schema"
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

    if added_any:
        app_url = f"{get_url('prowlarr')}/api/v1/applications"
        ast, apps = http_request(app_url, headers=headers)
        if ast == 200 and isinstance(apps, list):
            for app in apps:
                http_request(f"{app_url}/{app.get('id')}", method="PUT", data=app, headers=headers)
            log("Synchronized all indexers to Radarr and Sonarr", "+")

def configure_media_naming(radarr_key, sonarr_key):
    """Sets standard Plex / Jellyfin naming conventions & auto-unmonitor on delete in Radarr and Sonarr"""
    if radarr_key:
        url = f"{get_url('radarr')}/api/v3/config/naming"
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

        mm_url = f"{get_url('radarr')}/api/v3/config/mediamanagement"
        m_st, mm_curr = http_request(mm_url, headers=headers)
        if m_st == 200 and isinstance(mm_curr, dict):
            mm_curr["autoUnmonitorPreviouslyDownloadedMovies"] = True
            mm_curr["deleteEmptyFolders"] = True
            http_request(mm_url, method="PUT", data=mm_curr, headers=headers)

    if sonarr_key:
        url = f"{get_url('sonarr')}/api/v3/config/naming/1"
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

        mm_url = f"{get_url('sonarr')}/api/v3/config/mediamanagement"
        m_st, mm_curr = http_request(mm_url, headers=headers)
        if m_st == 200 and isinstance(mm_curr, dict):
            mm_curr["autoUnmonitorPreviouslyDownloadedEpisodes"] = True
            mm_curr["deleteEmptyFolders"] = True
            http_request(mm_url, method="PUT", data=mm_curr, headers=headers)

def configure_root_folders(radarr_key, sonarr_key):
    """Registers standard media root folders in Radarr and Sonarr"""
    if radarr_key:
        url = f"{get_url('radarr')}/api/v3/rootfolder"
        headers = {"X-Api-Key": radarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, list):
            if not any(r.get("path") == "/data/media/movies" for r in current):
                http_request(url, method="POST", data={"path": "/data/media/movies"}, headers=headers)
                log("Registered root folder in Radarr (/data/media/movies)", "+")

    if sonarr_key:
        url = f"{get_url('sonarr')}/api/v3/rootfolder"
        headers = {"X-Api-Key": sonarr_key}
        st, current = http_request(url, headers=headers)
        if st == 200 and isinstance(current, list):
            existing_paths = [r.get("path") for r in current]
            for folder in ["/data/media/tv", "/data/media/anime"]:
                if folder not in existing_paths:
                    http_request(url, method="POST", data={"path": folder}, headers=headers)
                    log(f"Registered root folder in Sonarr ({folder})", "+")

def configure_quality_profiles(radarr_key, sonarr_key):
    """Configures unified 1080p quality profiles in Radarr and Sonarr grouping Remux/Bluray/WEB into single flexible tier"""
    profile_label = "1080p (Flexible Source / Any 1080p)"

    if radarr_key:
        url = f"{get_url('radarr')}/api/v3/qualityprofile/4"
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
                if it.get("name") in ("WEB 1080p", "1080p (Any Source / Max Seeders)", profile_label):
                    it["name"] = profile_label
                    it["items"] = all_1080p_r
                    it["allowed"] = True
                new_items.append(it)
            qp["items"] = new_items
            qp["cutoff"] = 1002
            pst, _ = http_request(url, method="PUT", data=qp, headers=headers)
            if pst in (200, 202):
                log("Radarr unified 1080p quality profile configured", "OK")

    if sonarr_key:
        url = f"{get_url('sonarr')}/api/v3/qualityprofile/4"
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
                if it.get("name") in ("WEB 1080p", "1080p (Any Source / Max Seeders)", profile_label):
                    it["name"] = profile_label
                    it["items"] = all_1080p_s
                    it["allowed"] = True
                new_items.append(it)
            qp["items"] = new_items
            qp["cutoff"] = 1002
            pst, _ = http_request(url, method="PUT", data=qp, headers=headers)
            if pst in (200, 202):
                log("Sonarr unified 1080p quality profile configured", "OK")

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

def configure_servarr_auth(radarr_key, sonarr_key, prowlarr_key, admin_user, admin_password):
    """Configures unified admin credentials on Radarr, Sonarr, and Prowlarr with local address bypass"""
    targets = [
        ("Radarr", f"{get_url('radarr')}/api/v3/config/host", radarr_key),
        ("Sonarr", f"{get_url('sonarr')}/api/v3/config/host", sonarr_key),
        ("Prowlarr", f"{get_url('prowlarr')}/api/v1/config/host", prowlarr_key),
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

def configure_bazarr(radarr_key, sonarr_key, jellyfin_key):
    """Configures Bazarr for automated subtitle downloads, language profiles, and provider integration"""
    bazarr_yaml_path = os.path.join(CONFIG_ROOT, 'bazarr', 'config', 'config.yaml')
    bazarr_db_path = os.path.join(CONFIG_ROOT, 'bazarr', 'db', 'bazarr.db')

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
            cfg.setdefault('general', {})['use_radarr'] = True
            cfg['general']['movie_default_enabled'] = True
            cfg['general']['movie_default_profile'] = '1'
            cfg.setdefault('radarr', {})['ip'] = 'radarr'
            cfg['radarr']['port'] = 7878
            cfg['radarr']['apikey'] = radarr_key
            cfg['radarr']['ssl'] = False
            cfg['radarr']['base_url'] = ''
            updated = True

        if sonarr_key and not cfg.get('general', {}).get('use_sonarr'):
            cfg.setdefault('general', {})['use_sonarr'] = True
            cfg['general']['serie_default_enabled'] = True
            cfg['general']['serie_default_profile'] = '1'
            cfg.setdefault('sonarr', {})['ip'] = 'sonarr'
            cfg['sonarr']['port'] = 8989
            cfg['sonarr']['apikey'] = sonarr_key
            cfg['sonarr']['ssl'] = False
            cfg['sonarr']['base_url'] = ''
            updated = True

        if jellyfin_key and not cfg.get('general', {}).get('use_jellyfin'):
            cfg.setdefault('general', {})['use_jellyfin'] = True
            cfg.setdefault('jellyfin', {})['url'] = 'http://jellyfin:8096'
            cfg['jellyfin']['apikey'] = jellyfin_key
            cfg['jellyfin']['update_movie_library'] = True
            cfg['jellyfin']['update_series_library'] = True
            updated = True

        enabled_provs = ['bsplayer', 'subtitulamostv', 'supersubtitles', 'yifysubtitles', 'animetosho', 'subf2m', 'embeddedsubtitles']
        if cfg.get('general', {}).get('enabled_providers') != enabled_provs or cfg.get('general', {}).get('single_language') is not False:
            cfg.setdefault('general', {})['enabled_providers'] = enabled_provs
            cfg['general']['minimum_score_movie'] = 60
            cfg['general']['minimum_score'] = 60
            cfg['general']['use_embedded_subs'] = True
            cfg['general']['subfolder'] = 'current'
            cfg['general']['utf8_encode'] = True
            cfg['general']['single_language'] = False
            updated = True

        if cfg.get('auth', {}).get('type') is not None:
            cfg.setdefault('auth', {})['type'] = None
            updated = True

        if updated:
            if not IN_DOCKER:
                subprocess.run(['docker', 'stop', 'bazarr'], stdout=subprocess.DEVNULL)
                time.sleep(1)
            with open(bazarr_yaml_path, 'w', encoding='utf-8') as f:
                yaml.dump(cfg, f)

            if os.path.exists(bazarr_db_path):
                try:
                    conn = sqlite3.connect(bazarr_db_path)
                    cur = conn.cursor()
                    cur.execute("SELECT COUNT(*) FROM table_languages_profiles WHERE profileId = 1;")
                    items_json = json.dumps([
                        {"id": 1, "language": "en", "forced": False, "hi": False, "audio_language": None},
                        {"id": 2, "language": "es", "forced": False, "hi": False, "audio_language": None}
                    ])
                    if cur.fetchone()[0] == 0:
                        cur.execute('''
                            INSERT INTO table_languages_profiles (
                                profileId, cutoff, originalFormat, items, name, mustContain, mustNotContain, tag
                            ) VALUES (
                                1, 2, 0, ?, 'English & Spanish', '', '', ''
                            );
                        ''', (items_json,))
                    else:
                        cur.execute('''
                            UPDATE table_languages_profiles
                            SET cutoff = 2, items = ?, name = 'English & Spanish'
                            WHERE profileId = 1;
                        ''', (items_json,))
                    conn.commit()
                    conn.close()
                except Exception:
                    pass

            if not IN_DOCKER:
                subprocess.run(['docker', 'start', 'bazarr'], stdout=subprocess.DEVNULL)
            log("Bazarr automated subtitles and providers configured", "+")
        else:
            log("Bazarr subtitle automation is active", "OK")

        bazarr_key = cfg.get('auth', {}).get('apikey', '')
        return bazarr_key
    except Exception as e:
        log(f"Error configuring Bazarr: {e}", "!")
        return None

def wait_for_services(timeout=45):
    """Waits for key core services to become reachable on startup"""
    critical_services = [k for k, v in SERVICES.items() if v.get("core")]
    log(f"Waiting for core services to spin up ({timeout}s max)...", "⏳")
    start = time.time()
    while time.time() - start < timeout:
        all_ready = True
        for s in critical_services:
            st, _ = http_request(get_url(s), timeout=3)
            if st <= 0:
                all_ready = False
                break
        if all_ready:
            log("All primary core services are responsive!", "OK")
            return True
        time.sleep(2)
    return False

def check_and_wire_all():
    print("=" * 65)
    print("NULL-SEERR ALL-IN-ONE MEDIA STACK AUTO-WIRING ENGINE")
    print("=" * 65)

    # 1. Seed Pre-Configured Templates & Generate Unique Secrets
    seed_templates()

    # 2. Wait for Core Services
    wait_for_services(timeout=30 if IN_DOCKER else 5)

    # 3. Generate / Retrieve Unified Stack Credentials
    admin_user, admin_email, admin_password = get_or_create_stack_credentials()

    # 4. Extract API Keys
    radarr_xml = os.path.join(CONFIG_ROOT, "radarr", "config.xml")
    sonarr_xml = os.path.join(CONFIG_ROOT, "sonarr", "config.xml")
    prowlarr_xml = os.path.join(CONFIG_ROOT, "prowlarr", "config.xml")
    seerr_json = os.path.join(CONFIG_ROOT, "overseerr", "settings.json")

    radarr_key = get_xml_api_key(radarr_xml)
    sonarr_key = get_xml_api_key(sonarr_xml)
    prowlarr_key = get_xml_api_key(prowlarr_xml)

    # 5. Auto-Initialize Jellyfin Setup Wizard & Libraries
    jellyfin_info = auto_initialize_jellyfin(admin_user, admin_password)

    # 6. Auto-Configure Plex Libraries (if Plex container active)
    plex_info = configure_plex()

    # 7. Auto-Initialize Null-seerr
    auto_initialize_nullseerr(admin_user, admin_email, admin_password, radarr_key, sonarr_key, jellyfin_info, plex_info)
    seerr_key = get_seerr_api_key(seerr_json)

    # 8. Auto-Configure qBittorrent WebUI Host Validation & High Speed Limits
    configure_qbittorrent_auth(admin_user, admin_password)

    # 9. Auto-Initialize Shoko Server Engine (if Shoko container active)
    auto_initialize_shoko(admin_user, admin_password)

    print("\nDiscovered Unique API Keys:")
    print(f"  * Radarr:     {radarr_key or 'Not found'}")
    print(f"  * Sonarr:     {sonarr_key or 'Not found'}")
    print(f"  * Prowlarr:   {prowlarr_key or 'Not found'}")
    print(f"  * Null-seerr: {seerr_key or 'Not found'}\n")

    # 10. Check Service Health
    print("Checking Service Connectivity:")
    for key, info in SERVICES.items():
        st, _ = http_request(get_url(key), timeout=3)
        status_text = f"ONLINE (HTTP {st})" if st > 0 else ("OFFLINE / STARTING" if info.get("core") else "DISABLED (Optional Profile)")
        symbol = "OK" if st in (200, 301, 302, 401, 403) else (".." if info.get("core") else "--")
        display_url = info["docker_url"] if IN_DOCKER else info["url"]
        print(f"  [{symbol:>2}] {info['name']:<15} {display_url:<26} -> {status_text}")

    # 11. Perform Auto-Wiring
    print("\nLinking Stack Services:")
    if prowlarr_key and (radarr_key or sonarr_key):
        wire_prowlarr_apps(prowlarr_key, radarr_key, sonarr_key)

    if prowlarr_key:
        flare_tag_id = wire_prowlarr_flaresolverr(prowlarr_key)
        seed_prowlarr_indexers(prowlarr_key, flare_tag_id)

    if radarr_key:
        wire_qbittorrent_to_arr("Radarr", get_url("radarr"), radarr_key, admin_user, admin_password, "movies")
    if sonarr_key:
        wire_qbittorrent_to_arr("Sonarr", get_url("sonarr"), sonarr_key, admin_user, admin_password, "tv")

    # 12. Configure Media Naming
    configure_media_naming(radarr_key, sonarr_key)

    # 13. Configure Media Root Folders
    configure_root_folders(radarr_key, sonarr_key)

    # 14. Configure Unified 1080p Quality Profiles
    configure_quality_profiles(radarr_key, sonarr_key)

    # 15. Configure Servarr Authentication
    configure_servarr_auth(radarr_key, sonarr_key, prowlarr_key, admin_user, admin_password)

    # 16. Configure Bazarr Subtitle Automation
    configure_bazarr(radarr_key, sonarr_key, jellyfin_info.get("apiKey") if jellyfin_info else None)

    print("\n" + "=" * 65)
    print("✨ STACK WIRING COMPLETE & CREDENTIALS CONFIGURED!")
    print("=" * 65)
    print(f"  🔑 ADMIN USERNAME:          {admin_user}")
    print(f"  📧 ADMIN EMAIL:             {admin_email}")
    print(f"  🔒 GENERATED TEMP PASSWORD:  {admin_password}")
    print(f"  📁 Saved in:                {CREDENTIALS_FILE}")
    print("=" * 65)
    print("  * Null-seerr Portal:   http://localhost:5055")
    print("  * Radarr (Movies):     http://localhost:7878")
    print("  * Sonarr (TV):         http://localhost:8989")
    print("  * Prowlarr (Index):    http://localhost:9696")
    print("  * qBittorrent (DL):    http://localhost:8089")
    print("  * Jellyfin Server:     http://localhost:8096")
    print("  * Bazarr (Subtitles):  http://localhost:6767")
    print("  * Plex Media Server:   http://localhost:32400/web  (Optional)")
    print("  * Suggestarr (AI):     http://localhost:4455      (Optional)")
    print("  * Shoko (Anime):       http://localhost:8111      (Optional)")
    print("  * Tdarr (Transcode):   http://localhost:8265      (Optional)")
    print("=" * 65)

if __name__ == "__main__":
    check_and_wire_all()
