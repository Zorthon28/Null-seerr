"""Estimate library bytes released by removing selected files without changing them."""

import argparse
import json
import stat
from collections import defaultdict
from pathlib import Path


def preview(media_root, selected):
    root = media_root.resolve(strict=True)
    categories = {
        (root / name).resolve(strict=True) for name in ("movies", "tv", "anime")
        if (root / name).is_dir() and not (root / name).is_symlink()
    }
    paths = [candidate.resolve(strict=True) for candidate in selected]
    for path in paths:
        if not any(path != base and path.is_relative_to(base) and base.parent == root for base in categories):
            raise ValueError("Selection must be inside a movie, TV, or anime library, below its root.")

    unique_paths = set()
    groups = defaultdict(list)
    skipped = 0
    device = root.stat().st_dev
    pending = paths.copy()
    while pending:
        file = pending.pop()
        if file in unique_paths:
            continue
        unique_paths.add(file)
        metadata = file.lstat()
        reparse = getattr(metadata, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
        if stat.S_ISLNK(metadata.st_mode) or reparse or metadata.st_dev != device:
            skipped += 1
        elif stat.S_ISDIR(metadata.st_mode):
            pending.extend(file.iterdir())
        elif stat.S_ISREG(metadata.st_mode):
            groups[(metadata.st_dev, metadata.st_ino or file)].append(metadata)

    return {
        "selected": [str(path) for path in paths],
        "files": sum(map(len, groups.values())),
        "apparent_bytes": sum(info.st_size for entries in groups.values() for info in entries),
        "logical_bytes_estimated_reclaimable": sum(
            entries[0].st_size for entries in groups.values()
            if entries[0].st_nlink == len(entries)
        ),
        "files_with_links_outside_selection": sum(
            len(entries) for entries in groups.values()
            if entries[0].st_nlink > len(entries)
        ),
        "skipped_links_or_mounts": skipped,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--media-root", type=Path, default=Path("D:/arr-stack/data/media"))
    parser.add_argument("paths", type=Path, nargs="+")
    args = parser.parse_args()
    try:
        print(json.dumps(preview(args.media_root, args.paths), indent=2))
    except (OSError, ValueError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
