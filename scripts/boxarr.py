import os
import sys
import json
import logging
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [Boxarr] %(message)s')

SEERR_URL = os.environ.get("SEERR_URL", "http://localhost:5055")
RADARR_URL = os.environ.get("RADARR_URL", "http://localhost:7878")

ARR_DIR = os.environ.get("STACK_ROOT", "/opt/arr-stack" if sys.platform != "win32" else r"C:\arr-stack")
CONFIG_ROOT = os.environ.get("CONFIG_ROOT", os.path.join(ARR_DIR, "config") if not os.path.exists("/config") else "/config")

def get_xml_api_key(config_path):
    if not os.path.exists(config_path):
        return None
    try:
        tree = ET.parse(config_path)
        root = tree.getroot()
        api_elem = root.find("ApiKey")
        if api_elem is not None and api_elem.text:
            return api_elem.text.strip()
    except Exception:
        pass
    return None

def get_seerr_api_key(settings_path):
    if not os.path.exists(settings_path):
        return None
    try:
        with open(settings_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("main", {}).get("apiKey")
    except Exception:
        pass
    return None

RADARR_XML = os.path.join(CONFIG_ROOT, "radarr", "config.xml")
SEERR_JSON = os.path.join(CONFIG_ROOT, "overseerr", "settings.json")

RADARR_API_KEY = os.environ.get("RADARR_API_KEY") or get_xml_api_key(RADARR_XML) or ""
SEERR_API_KEY = os.environ.get("SEERR_API_KEY") or get_seerr_api_key(SEERR_JSON) or ""

def validate_api_keys():
    """Validates that required API keys are available before sending requests"""
    missing = []
    if not RADARR_API_KEY:
        missing.append("Radarr API Key (RADARR_API_KEY or config/radarr/config.xml)")
    if not SEERR_API_KEY:
        missing.append("Null-seerr API Key (SEERR_API_KEY or config/overseerr/settings.json)")
    if missing:
        logging.error(f"Missing required API credentials: {', '.join(missing)}.")
        logging.error("Please ensure the media stack has been initialized via wire_stack.py or provide keys via environment variables.")
        sys.exit(1)

def get_top_box_office_movies(limit=10):
    """Fetch the top popular and box-office movies from Null-seerr / TMDB"""
    url = f"{SEERR_URL}/api/v1/discover/movies?sortBy=popularity.desc"
    req = urllib.request.Request(url, headers={"X-Api-Key": SEERR_API_KEY})
    try:
        data = json.loads(urllib.request.urlopen(req).read())
        results = data.get("results", [])
        return results[:limit]
    except Exception as e:
        logging.error(f"Failed to fetch discover movies: {e}")
        return []

def get_radarr_movies():
    """Fetch existing movies in Radarr to avoid duplicate adds"""
    url = f"{RADARR_URL}/api/v3/movie"
    req = urllib.request.Request(url, headers={"X-Api-Key": RADARR_API_KEY})
    try:
        data = json.loads(urllib.request.urlopen(req).read())
        return {m.get("tmdbId"): m for m in data}
    except Exception as e:
        logging.error(f"Failed to fetch Radarr movies: {e}")
        return {}

def add_movie_to_radarr(movie):
    """Add a discovered box-office movie to Radarr"""
    tmdb_id = movie.get("id")
    title = movie.get("title")
    year = int(movie.get("releaseDate", "2026")[:4]) if movie.get("releaseDate") else 2026
    
    # Lookup details from Radarr
    lookup_url = f"{RADARR_URL}/api/v3/movie/lookup/tmdb?tmdbId={tmdb_id}"
    req = urllib.request.Request(lookup_url, headers={"X-Api-Key": RADARR_API_KEY})
    try:
        details = json.loads(urllib.request.urlopen(req).read())
    except Exception as e:
        logging.warning(f"Could not look up {title} in Radarr: {e}")
        details = {
            "title": title,
            "tmdbId": tmdb_id,
            "year": year,
            "titleSlug": title.lower().replace(" ", "-"),
            "images": []
        }
        
    details["qualityProfileId"] = 4 # HD-1080p
    details["rootFolderPath"] = "/data/media/movies"
    details["monitored"] = True
    details["minimumAvailability"] = "released"
    details["addOptions"] = {
        "searchForMovie": True
    }
    
    post_url = f"{RADARR_URL}/api/v3/movie"
    post_req = urllib.request.Request(
        post_url,
        data=json.dumps(details).encode("utf-8"),
        headers={"X-Api-Key": RADARR_API_KEY, "Content-Type": "application/json"},
        method="POST"
    )
    try:
        res = urllib.request.urlopen(post_req)
        logging.info(f"Successfully added to Radarr: {title} ({year})")
        return True
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8")
        logging.warning(f"Radarr add returned {e.code} for {title}: {err_msg}")
        return False
    except Exception as e:
        logging.error(f"Error adding {title}: {e}")
        return False

def run_boxarr_autopilot(limit=10):
    validate_api_keys()
    logging.info("Starting Boxarr Box Office -> Radarr Autopilot sync...")
    existing = get_radarr_movies()
    top_movies = get_top_box_office_movies(limit)
    
    added_count = 0
    for movie in top_movies:
        tmdb_id = movie.get("id")
        title = movie.get("title")
        if tmdb_id in existing:
            logging.info(f"Already monitored in Radarr: {title}")
        else:
            logging.info(f"New Box Office Hit Found: {title} (TMDB ID: {tmdb_id}) -> Adding to Radarr...")
            if add_movie_to_radarr(movie):
                added_count += 1
                
    logging.info(f"Boxarr Autopilot complete! Added {added_count} new box-office movies to Radarr.")

if __name__ == "__main__":
    run_boxarr_autopilot(limit=10)
