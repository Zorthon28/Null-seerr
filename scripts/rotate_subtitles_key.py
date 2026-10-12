#!/usr/bin/env python3
"""
OpenSubtitles On-Demand API Key Rotator & Pool for Jellyfin SubBuzz
-------------------------------------------------------------------
Maintains a pool of OpenSubtitles API keys and automatically rotates
them on-demand whenever Jellyfin / SubBuzz encounters:
- HTTP 429 (Too Many Requests / Rate Limit)
- HTTP 406 / HTTP 403 / HTTP 401 (Quota exceeded / Download limit reached / Auth error)
- Explicit quota exhausted / limit errors in Jellyfin runtime logs.

Can be run via CLI, scheduled, or executed as an on-demand watchdog
thread inside the Null-seerr Power Guard daemon.
"""

import os
import sys
import glob
import json
import xml.etree.ElementTree as ET
import argparse
import urllib.request
import urllib.error
from datetime import datetime

def get_config_dir():
    if os.environ.get("JELLYFIN_CONFIG"):
        return os.environ.get("JELLYFIN_CONFIG")
    stack_root = os.environ.get("STACK_ROOT")
    if stack_root:
        cand = os.path.join(stack_root, "config", "jellyfin")
        if os.path.exists(cand):
            return cand
    candidates = [
        r"C:\arr-stack\config\jellyfin",
        "/config/jellyfin",
        "/opt/arr-stack/config/jellyfin",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]

CONFIG_DIR = get_config_dir()
POOL_FILE = os.path.join(CONFIG_DIR, "subtitles_key_pool.json")
SUBBUZZ_XML = os.path.join(CONFIG_DIR, "data", "plugins", "configurations", "subbuzz.xml")
LOGS_DIR = os.path.join(CONFIG_DIR, "log")

def mask_key(k: str) -> str:
    if not k:
        return ""
    if len(k) <= 8:
        return "***"
    return f"{k[:4]}...{k[-4:]}"

# Track file read offset for on-demand log tailing
_last_log_file = None
_last_log_offset = 0

def load_pool():
    if not os.path.exists(POOL_FILE):
        return {"active_key_index": 0, "keys": []}
    try:
        with open(POOL_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading pool: {e}")
        return {"active_key_index": 0, "keys": []}

def save_pool(pool):
    try:
        os.makedirs(os.path.dirname(POOL_FILE), exist_ok=True)
        with open(POOL_FILE, "w", encoding="utf-8") as f:
            json.dump(pool, f, indent=2)
    except Exception as e:
        print(f"Error saving pool: {e}")

def update_subbuzz_xml(api_key):
    """Updates subbuzz.xml with the given API key and triggers live reload in Jellyfin."""
    if not os.path.exists(SUBBUZZ_XML):
        print(f"subbuzz.xml not found at {SUBBUZZ_XML}")
        return False
    try:
        tree = ET.parse(SUBBUZZ_XML)
        root = tree.getroot()
        elem = root.find("OpenSubApiKey")
        if elem is None:
            elem = ET.SubElement(root, "OpenSubApiKey")
        elem.text = api_key
        tree.write(SUBBUZZ_XML, encoding="utf-8", xml_declaration=True)
        print(f"[OpenSub Rotator] Applied API Key ({api_key[:6]}...{api_key[-4:]}) to subbuzz.xml")

        # Notify Jellyfin to reload SubBuzz configuration dynamically if online
        notify_jellyfin_reload(api_key)
        return True
    except Exception as e:
        print(f"Error updating subbuzz.xml: {e}")
        return False

def notify_jellyfin_reload(api_key):
    """Notifies Jellyfin via REST API to reload SubBuzz in-memory configuration."""
    jellyfin_url = os.environ.get("JELLYFIN_URL", "http://localhost:8096")
    plugin_guid = "5aeab01b-2ef8-45c6-bb6b-16ce9cb268d4"
    try:
        url = f"{jellyfin_url}/Plugins/{plugin_guid}/Configuration"
        req = urllib.request.Request(
            url,
            headers={"Content-Type": "application/json"},
            method="GET"
        )
        with urllib.request.urlopen(req, timeout=3) as resp:
            cfg = json.loads(resp.read().decode())
            cfg["OpenSubApiKey"] = api_key
            update_req = urllib.request.Request(
                url,
                data=json.dumps(cfg).encode(),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(update_req, timeout=3) as _:
                pass
    except Exception:
        # If Jellyfin API requires auth token or server is restarting, subbuzz.xml on disk is sufficient
        pass

def rotate_key(reason="Manual"):
    """Rotates to the next API key in the pool and updates Jellyfin SubBuzz."""
    pool = load_pool()
    keys = pool.get("keys", [])
    if not keys:
        print("[OpenSub Rotator] No keys in pool!")
        return None

    current_idx = pool.get("active_key_index", 0)
    next_idx = (current_idx + 1) % len(keys)
    pool["active_key_index"] = next_idx

    active_key = keys[next_idx]
    active_key["last_used"] = datetime.utcnow().isoformat() + "Z"
    active_key["last_rotation_reason"] = reason
    save_pool(pool)

    print(f"[OpenSub Rotator] Rotated key to [{next_idx}] {active_key.get('name', 'Key')}: {mask_key(active_key['api_key'])} (Reason: {reason})")
    update_subbuzz_xml(active_key["api_key"])
    return active_key

def add_key(name, key):
    pool = load_pool()
    for k in pool.get("keys", []):
        if k["api_key"] == key:
            print(f"Key {name} already exists in pool.")
            return
    pool.setdefault("keys", []).append({
        "name": name,
        "api_key": key,
        "status": "active",
        "added_at": datetime.utcnow().isoformat() + "Z"
    })
    save_pool(pool)
    print(f"Added key {name} to pool. Total keys: {len(pool['keys'])}")

def list_keys():
    pool = load_pool()
    idx = pool.get("active_key_index", 0)
    print(f"\n--- OpenSubtitles API Key Pool (Active Index: {idx}) ---")
    for i, k in enumerate(pool.get("keys", [])):
        marker = "-> [ACTIVE]" if i == idx else "   "
        print(f"{marker} [{i}] {k.get('name')}: {mask_key(k['api_key'])} (status: {k.get('status', 'active')})")

def check_and_rotate_on_demand():
    """
    Tails the active Jellyfin log file and checks for OpenSubtitles rate-limit,
    download limit, or 429 / 406 quota errors.
    Automatically rotates to the next key on demand when triggered.
    """
    global _last_log_file, _last_log_offset

    if not os.path.exists(LOGS_DIR):
        return False, None

    # Find newest log_*.log
    log_files = sorted(glob.glob(os.path.join(LOGS_DIR, "log_*.log")))
    if not log_files:
        return False, None

    current_log = log_files[-1]
    if current_log != _last_log_file:
        _last_log_file = current_log
        _last_log_offset = max(0, os.path.getsize(current_log) - 10000)

    try:
        file_size = os.path.getsize(current_log)
        if file_size < _last_log_offset:
            _last_log_offset = 0

        if file_size == _last_log_offset:
            return False, None

        with open(current_log, "r", encoding="utf-8", errors="ignore") as f:
            f.seek(_last_log_offset)
            new_lines = f.readlines()
            _last_log_offset = f.tell()

        rate_limit_patterns = [
            "429",
            "Too Many Requests",
            "406",
            "download limit",
            "quota exceeded",
            "rate limit",
            "Cannot consume this service",
            "Your download limit has been reached"
        ]

        for line in new_lines:
            lower = line.lower()
            if "subbuzz" in lower or "opensubtitle" in lower or "opensub" in lower:
                for pattern in rate_limit_patterns:
                    if pattern.lower() in lower:
                        print(f"[OpenSub Rotator] Detected rate-limit condition in Jellyfin log: {pattern}")
                        new_key = rotate_key(reason=f"Detected error: {pattern}")
                        return True, new_key
    except Exception as e:
        print(f"[OpenSub Rotator] Log check error: {e}")

    return False, None

def get_current_status():
    pool = load_pool()
    idx = pool.get("active_key_index", 0)
    keys = pool.get("keys", [])
    active = keys[idx] if idx < len(keys) else None
    return {
        "total_keys": len(keys),
        "active_index": idx,
        "active_name": active.get("name") if active else None,
        "active_key_masked": f"{active['api_key'][:6]}...{active['api_key'][-4:]}" if active else None,
        "last_rotation": active.get("last_used") if active else None
    }

def main():
    parser = argparse.ArgumentParser(description="Rotate OpenSubtitles API keys in Jellyfin SubBuzz on demand")
    parser.add_argument("--rotate", action="store_true", help="Rotate to next API key in pool")
    parser.add_argument("--list", action="store_true", help="List all keys in pool")
    parser.add_argument("--add", nargs=2, metavar=("NAME", "API_KEY"), help="Add a new API key to the pool")
    parser.add_argument("--check-logs", action="store_true", help="Perform on-demand check of Jellyfin logs")
    args = parser.parse_args()

    if args.add:
        add_key(args.add[0], args.add[1])
    elif args.rotate:
        rotate_key()
    elif args.check_logs:
        rotated, key = check_and_rotate_on_demand()
        if rotated:
            print(f"Triggered on-demand rotation: switched to {key['name']}")
        else:
            print("No rate-limit condition found in logs.")
    elif args.list:
        list_keys()
    else:
        list_keys()

if __name__ == "__main__":
    main()
