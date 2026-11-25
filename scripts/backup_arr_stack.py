"""Create a local recovery snapshot in an existing, access-controlled folder."""

import argparse
import datetime
import json
import shutil
import sqlite3
import subprocess
import tempfile
from contextlib import closing
from pathlib import Path


STATE = {
    "overseerr": ("*.json", "anime-list.xml", "db/db.sqlite3"),
    "radarr": ("config.xml", "radarr.db"),
    "sonarr": ("config.xml", "sonarr.db"),
    "prowlarr": ("config.xml", "prowlarr.db", "Definitions"),
    "bazarr": ("config", "db/bazarr.db"),
    "jellyfin": ("*.xml", "logging.default.json", "data/jellyfin.db", "data/data", "data/root", "plugins/configurations", "data/plugins/configurations"),
    "qbittorrent": (
        "qBittorrent/*.conf",
        "qBittorrent/*.json",
        "qBittorrent/BT_backup",
    ),
    "sabnzbd": ("sabnzbd.ini", "admin"),
    "jackett": ("Jackett/ServerConfig.json", "Jackett/Indexers", "Jackett/DataProtection"),
}


def snapshot_file(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix in {".db", ".sqlite", ".sqlite3"}:
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as live:
            with closing(sqlite3.connect(destination)) as saved:
                live.backup(saved)
                result = saved.execute("PRAGMA quick_check").fetchall()
                if result != [("ok",)]:
                    raise RuntimeError(f"SQLite verification failed for {source.name}")
    else:
        shutil.copy2(source, destination)


def snapshot_state(source_root, destination, paths):
    for pattern in paths:
        for match in source_root.glob(pattern):
            files = match.rglob("*") if match.is_dir() else (match,)
            for file in files:
                if file.is_file() and not file.is_symlink() and not file.name.endswith(
                    ("-wal", "-shm", "-journal", ".pid", ".lock")
                ):
                    snapshot_file(file, destination / file.relative_to(source_root))


def docker_inventory():
    names = [*STATE.keys(), "cloudflared"]
    names[names.index("overseerr")] = "null-seerr"
    data = json.loads(subprocess.check_output(["docker", "inspect", *names]))
    return [
        {
            "name": entry["Name"].lstrip("/"),
            "image": entry["Config"]["Image"],
            "image_id": entry["Image"],
            "revision": entry["Config"]["Labels"].get("org.opencontainers.image.revision"),
            "compose_service": entry["Config"]["Labels"].get("com.docker.compose.service"),
            "running": entry["State"]["Running"],
            "mounts": [
                {field: mount[field] for field in ("Type", "Source", "Destination", "RW")}
                for mount in entry["Mounts"]
            ],
            "ports": entry["HostConfig"]["PortBindings"],
        }
        for entry in data
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stack-root", type=Path, default=Path("C:/arr-stack"))
    parser.add_argument("--destination", type=Path, required=True)
    args = parser.parse_args()
    root = args.stack_root.resolve(strict=True)
    destination = args.destination.resolve(strict=True)
    if not destination.is_dir() or destination == root or destination.is_relative_to(root):
        parser.error("Destination must be an existing private directory outside the stack.")

    required = (
        "config/overseerr/db/db.sqlite3",
        "config/radarr/radarr.db",
        "config/sonarr/sonarr.db",
        "config/prowlarr/prowlarr.db",
        "config/jellyfin/data/jellyfin.db",
        "config/overseerr/settings.json",
        "docker-compose.yml",
    )
    missing = [path for path in required if not (root / path).is_file()]
    if missing:
        parser.error("Missing required recovery inputs: " + ", ".join(missing))

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    final = destination / f"arr-stack-{stamp}"
    with tempfile.TemporaryDirectory(prefix=".building-", dir=destination) as temporary:
        staged = Path(temporary) / "snapshot"
        for service, paths in STATE.items():
            relative = Path("config") / service
            snapshot_state(root / relative, staged / relative, paths)
        snapshot_state(
            root, staged,
            ("docker-compose.yml", "compose*.yml", "compose*.yaml", ".env",
             "wire_stack.py", "start-stack.bat", "stop-stack.bat")
        )
        (staged / "docker-inventory.json").write_text(
            json.dumps(docker_inventory(), indent=2) + "\n", encoding="utf-8"
        )
        staged.rename(final)
    print(final)


if __name__ == "__main__":
    main()
