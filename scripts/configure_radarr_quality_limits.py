#!/usr/bin/env python3
"""
Radarr Quality Limits and Swarm Scoring Optimizer
Enforces realistic file size limits on 1080p Bluray/Remux qualities (capping to ~3.5 GB)
and balances Custom Format scores (Multi/Dual Audio from +1000 down to +200)
so that healthy swarms with hundreds of seeds are not bypassed for dying 3-seed swarms.
"""

import json
import urllib.request
import urllib.parse
import sys

RADARR_URL = "http://localhost:7878"
API_KEY = "c51db4e7cdd948b4bb7fd112082e7db8"


def api_request(endpoint: str, data=None, method=None):
    url = f"{RADARR_URL.rstrip('/')}{endpoint}"
    encoded_data = json.dumps(data).encode("utf-8") if data is not None else None
    headers = {"X-Api-Key": API_KEY}
    if encoded_data:
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    with urllib.request.urlopen(req) as resp:
        content = resp.read().decode("utf-8")
        return json.loads(content) if content else None


def optimize_quality_definitions():
    print("=== 1. Optimizing Radarr Quality Definitions (Size Caps) ===")
    qdefs = api_request("/api/v3/qualitydefinition")
    updated = False

    for q in qdefs:
        name = q.get("quality", {}).get("name", "")
        # Cap high-bitrate Bluray and Remux 1080p to prevent 15-40 GB uncompressed files
        if name in ["Bluray-1080p", "Remux-1080p"]:
            current_max = q.get("maxSize")
            current_pref = q.get("preferredSize")
            if current_max != 80 or current_pref != 50:
                q["maxSize"] = 80       # ~3.6 GB for a 2-hour movie
                q["preferredSize"] = 50 # ~2.2 GB for a 2-hour movie
                updated = True
                print(f"[+] Capped {name}: maxSize=80 MB/hr (~3.6 GB), preferredSize=50 MB/hr (~2.2 GB)")
            else:
                print(f"[=] {name} is already properly capped at maxSize=80 MB/hr")

    if updated:
        api_request("/api/v3/qualitydefinition/update", data=qdefs, method="PUT")
        print("[OK] Successfully updated quality definitions in Radarr!")
    else:
        print("[OK] Quality definitions are already up-to-date.")


def balance_custom_format_scores():
    print("\n=== 2. Balancing Custom Format Scores ===")
    profiles = api_request("/api/v3/qualityprofile")
    total_profiles_updated = 0

    for qp in profiles:
        qp_id = qp.get("id")
        qp_name = qp.get("name")
        format_items = qp.get("formatItems", [])
        profile_modified = False

        for fi in format_items:
            # Rebalance Multi / Dual Audio so it doesn't eclipse active swarms
            if fi.get("name") == "Multi / Dual Audio" and fi.get("score") == 1000:
                fi["score"] = 200
                profile_modified = True
                print(f"[+] [{qp_name}] Adjusted 'Multi / Dual Audio' score from +1000 to +200")

        if profile_modified:
            api_request(f"/api/v3/qualityprofile/{qp_id}", data=qp, method="PUT")
            total_profiles_updated += 1

    if total_profiles_updated > 0:
        print(f"[OK] Successfully balanced custom format scores across {total_profiles_updated} profile(s)!")
    else:
        print("[OK] Custom format scores are already balanced.")


if __name__ == "__main__":
    try:
        optimize_quality_definitions()
        balance_custom_format_scores()
        print("\nAll Radarr quality limits and scoring optimizations have been successfully applied.")
    except Exception as exc:
        print(f"[ERROR] Failed to apply Radarr optimizations: {exc}", file=sys.stderr)
        sys.exit(1)
