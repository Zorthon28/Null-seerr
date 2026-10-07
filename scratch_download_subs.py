import urllib.request
import sqlite3
import time
import json

BAZARR_URL = "http://localhost:6767"
API_KEY = "da287fbb7aac9e9341cb93353d1656e9"
DB_PATH = r"C:\arr-stack\config\bazarr\db\bazarr.db"

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()
cur.execute('''
    SELECT sonarrEpisodeId, season, episode, title 
    FROM table_episodes 
    WHERE sonarrSeriesId=9 AND season IN (7, 8, 9) AND missing_subtitles LIKE '%es%'
    ORDER BY season, episode
''')
episodes = cur.fetchall()
conn.close()

print(f"Starting Spanish subtitle download for {len(episodes)} episodes...")

for idx, (ep_id, season, ep_num, title) in enumerate(episodes, 1):
    print(f"[{idx}/{len(episodes)}] Requesting ES subtitle for S{season:02d}E{ep_num:02d}: {title} (ID: {ep_id})...")
    url = f"{BAZARR_URL}/api/episodes/subtitles?seriesid=9&episodeid={ep_id}&language=es&forced=False&hi=False"
    req = urllib.request.Request(url, method='PATCH', headers={'X-Api-Key': API_KEY})
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        print(f"  -> Dispatched (HTTP {resp.status})")
    except Exception as e:
        print(f"  -> Error: {e}")
    
    # Delay between requests to let Bazarr search and download without hammering providers
    time.sleep(4)

print("\nAll download requests dispatched! Waiting 30 seconds for background jobs to settle...")
time.sleep(30)

# Check final status
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()
cur.execute('''
    SELECT season, 
           COUNT(*) as total,
           SUM(CASE WHEN missing_subtitles LIKE '%es%' THEN 1 ELSE 0 END) as missing_es,
           SUM(CASE WHEN missing_subtitles LIKE '%en%' THEN 1 ELSE 0 END) as missing_en
    FROM table_episodes 
    WHERE sonarrSeriesId=9 AND season IN (7, 8, 9) 
    GROUP BY season
''')
print("\n--- Final Subtitle Status ---")
for row in cur.fetchall():
    print(f"Season {row[0]}: Total {row[1]} episodes | Missing ES: {row[2]} | Missing EN: {row[3]}")
conn.close()
