"""Check local Arr stack progress, recovery readiness, and deployment drift."""

import argparse
import json
import re
import shutil
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

from backup_arr_stack import docker_inventory


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def read_json(url, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": "ArrStackHealth/1.0", **(headers or {})})
    with HTTP.open(request, timeout=6) as response:
        return json.load(response)


def read_sabnzbd(stack_root, port, previous):
    config = (stack_root / "config/sabnzbd/sabnzbd.ini").read_text(encoding="utf-8-sig")
    misc = re.search(r"(?m)^\[misc\]\s*\n([^\[]*)", config)
    key_match = re.search(r"(?m)^api_key\s*=\s*([^\s]+)", misc.group(1)) if misc else None
    if not key_match:
        raise ValueError("SABnzbd API key is missing")
    key = key_match.group(1)

    def api(mode):
        params = urllib.parse.urlencode({"mode": mode, "output": "json", "apikey": key})
        return read_json(f"http://127.0.0.1:{port}/api?{params}")[mode]

    queue = api("queue")
    now = time.time()
    jobs = int(queue["noofslots"])
    remaining = float(queue["mbleft"])
    speed = queue.get("kbpersec")
    if speed is None:
        speed = str(queue["speed"]).split(maxsplit=1)[0]
    idle = jobs > 0 and not queue["paused"] and float(speed) == 0
    steady = idle and remaining == previous.get("remaining_mb") and jobs == previous.get("jobs")
    first_idle = previous.get("idle_since", now) if steady else now
    issues = []
    if idle:
        servers = api("status").get("servers", [])
        errors = [str(server.get("servererror", "")) for server in servers]
        if any("block account is fully used" in text.lower() for text in errors):
            issues.append("Usenet provider block is exhausted")
        elif servers and all(errors):
            issues.append("Every configured Usenet server reports an error")
        if now - first_idle >= 15 * 60:
            issues.append("SABnzbd queue has made no progress for at least 15 minutes")
    return {"jobs": jobs, "remaining_mb": remaining, "idle_since": first_idle}, issues


def drift(before, after):
    old = {entry["name"]: entry for entry in before}
    new = {entry["name"]: entry for entry in after}
    issues = []
    for name in sorted(old.keys() | new.keys()):
        if name not in old or name not in new:
            issues.append(f"{name} container exists in only one inventory")
            continue
        for field in ("image_id", "compose_service", "ports"):
            if old[name][field] != new[name][field]:
                issues.append(f"{name} {field} changed since the recovery snapshot")
        before_mounts = sorted(old[name]["mounts"], key=lambda mount: mount["Destination"])
        after_mounts = sorted(new[name]["mounts"], key=lambda mount: mount["Destination"])
        if before_mounts != after_mounts:
            issues.append(f"{name} mounts changed since the recovery snapshot")
        if not new[name]["running"]:
            issues.append(f"{name} container is stopped")
    return issues


def check_arr_service(stack_root, name, previous):
    config = ET.parse(stack_root / "config" / name / "config.xml").getroot()
    port = int(config.findtext("Port"))
    base = (config.findtext("UrlBase") or "").strip("/")
    version = "v1" if name == "prowlarr" else "v3"
    api = f"http://127.0.0.1:{port}" + (f"/{base}" if base else "") + f"/api/{version}"
    headers = {"X-Api-Key": config.findtext("ApiKey")}
    health = read_json(api + "/health", headers)
    sources = {row.get("source") for row in health}
    issues = []
    if "IndexerProxyStatusCheck" in sources:
        issues.append(f"{name} reports unavailable indexer proxies")
    if sources & {"IndexerLongTermStatusCheck", "IndexerStatusCheck", "IndexerNoDefinitionCheck"}:
        issues.append(f"{name} reports indexer failures")
    if name == "prowlarr":
        return {}, issues

    now = time.time()
    waiting = {}
    page = 1
    while True:
        queue = read_json(api + f"/queue?page={page}&pageSize=100", headers)
        for item in queue["records"]:
            if item.get("trackedDownloadState") not in {"importPending", "importBlocked"}:
                continue
            key = str(item["id"])
            waiting[key] = previous.get(key, now)
        if page * queue["pageSize"] >= queue["totalRecords"] or not queue["records"]:
            break
        page += 1
    if any(now - first_seen >= 30 * 60 for first_seen in waiting.values()):
        issues.append(f"{name} has downloads waiting at least 30 minutes for import")
    return waiting, issues


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack-root", type=Path, default=Path("C:/arr-stack"))
    parser.add_argument("--data-root", type=Path, default=Path("D:/arr-stack/data"))
    parser.add_argument("--sab-port", type=int, default=8085)
    parser.add_argument("--null-seerr", default="http://127.0.0.1:5055")
    parser.add_argument("--jellyfin", default="http://127.0.0.1:8096")
    parser.add_argument("--public-null-seerr", help="Optional HTTPS URL checked independently")
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, help="Docker inventory to compare against")
    parser.add_argument("--state", type=Path, required=True)
    args = parser.parse_args()
    previous = json.loads(args.state.read_text(encoding="utf-8")) if args.state.is_file() else {}
    issues = []
    if not all((args.data_root / path).is_dir() for path in ("media", "torrents", "usenet")):
        issues.append("Expected media drive directories are missing")
    else:
        disk = shutil.disk_usage(args.data_root)
        if disk.free < 80 * 1024**3 or disk.free / disk.total < 0.10:
            issues.append("Media drive is below its free-space warning threshold")

    backup_inventory = args.backup / "docker-inventory.json"
    if not backup_inventory.is_file():
        issues.append("Recovery inventory is missing")
    else:
        if time.time() - backup_inventory.stat().st_mtime > 24 * 60 * 60:
            issues.append("Recovery snapshot is older than 24 hours")
    try:
        baseline = args.baseline or backup_inventory
        issues.extend(drift(json.loads(baseline.read_text(encoding="utf-8")), docker_inventory()))
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        issues.append(f"Docker inventory unavailable ({type(error).__name__})")

    try:
        current, sab_issues = read_sabnzbd(args.stack_root, args.sab_port, previous.get("sab", {}))
        issues.extend(sab_issues)
    except (OSError, ValueError, KeyError) as error:
        current = {}
        issues.append(f"SABnzbd check unavailable ({type(error).__name__})")

    imports = {}
    for name in ("radarr", "sonarr", "prowlarr"):
        try:
            state, service_issues = check_arr_service(args.stack_root, name, previous.get("imports", {}).get(name, {}))
            imports[name] = state
            issues.extend(service_issues)
        except (OSError, ValueError, TypeError, KeyError, ET.ParseError) as error:
            imports[name] = previous.get("imports", {}).get(name, {})
            issues.append(f"{name} check unavailable ({type(error).__name__})")

    web_probes = {
        "local Null-seerr": args.null_seerr.rstrip("/") + "/api/v1/status",
        "local Jellyfin": args.jellyfin.rstrip("/") + "/System/Info/Public",
    }
    if args.public_null_seerr:
        web_probes["public Null-seerr"] = args.public_null_seerr.rstrip("/") + "/api/v1/status"
    for label, url in web_probes.items():
        try:
            if not isinstance(read_json(url), dict):
                raise ValueError("Unexpected status response")
        except (OSError, ValueError) as error:
            issues.append(f"{label} check unavailable ({type(error).__name__})")

    earlier = set(previous.get("issues", []))
    pending = args.state.with_suffix(args.state.suffix + ".partial")
    pending.write_text(json.dumps({"sab": current, "imports": imports, "issues": issues}) + "\n", encoding="utf-8")
    pending.replace(args.state)
    print(json.dumps({
        "issues": issues,
        "new_issues": sorted(set(issues) - earlier),
        "recovered": sorted(earlier - set(issues)),
        "sab": current,
    }))
    return int(bool(issues))


if __name__ == "__main__":
    raise SystemExit(main())
