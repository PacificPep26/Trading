"""Fetch video list + transcripts of a YouTube channel into data/knowledge.db.

Usage: python service/scripts/fetch_transcripts.py [CHANNEL_URL] [--delay 2]
Resumable: videos already fetched (status ok/none) are skipped.
"""
import argparse
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

import yt_dlp
from youtube_transcript_api import YouTubeTranscriptApi

DB = Path(__file__).resolve().parents[2] / "data" / "knowledge.db"
DEFAULT_CHANNEL = "https://www.youtube.com/@NukidaTradingOfficial"

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, channel TEXT, tab TEXT, title TEXT, url TEXT,
    duration_s INTEGER, listed_at TEXT,
    transcript_status TEXT, transcript_lang TEXT, transcript_generated INTEGER,
    fetched_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS segments (
    video_id TEXT, idx INTEGER, start_s REAL, duration_s REAL, text TEXT,
    PRIMARY KEY (video_id, idx)
);
"""


def now():
    return datetime.now(timezone.utc).isoformat()


def list_videos(channel):
    out = []
    opts = {"extract_flat": True, "quiet": True, "skip_download": True}
    with yt_dlp.YoutubeDL(opts) as ydl:
        for tab in ("videos", "streams", "shorts"):
            try:
                info = ydl.extract_info(f"{channel}/{tab}", download=False)
            except yt_dlp.utils.DownloadError:
                continue
            for e in info.get("entries") or []:
                if e and e.get("id"):
                    out.append((e["id"], tab, e.get("title"), e.get("duration")))
    return out


def main():
    p = argparse.ArgumentParser()
    p.add_argument("channel", nargs="?", default=DEFAULT_CHANNEL)
    p.add_argument("--delay", type=float, default=2.0)
    a = p.parse_args()
    DB.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB)
    db.executescript(SCHEMA)

    vids = list_videos(a.channel)
    for vid, tab, title, dur in vids:
        db.execute(
            "INSERT OR IGNORE INTO videos (id, channel, tab, title, url, duration_s, listed_at) VALUES (?,?,?,?,?,?,?)",
            (vid, a.channel, tab, title, f"https://www.youtube.com/watch?v={vid}", dur, now()),
        )
    db.commit()
    print(f"listed {len(vids)} videos")

    api = YouTubeTranscriptApi()
    todo = db.execute(
        "SELECT id, title FROM videos WHERE transcript_status IS NULL OR transcript_status = 'error'"
    ).fetchall()
    for i, (vid, title) in enumerate(todo, 1):
        try:
            tlist = api.list(vid)
            try:
                t = tlist.find_manually_created_transcript(["vi"])
            except Exception:
                t = tlist.find_transcript(["vi", "en"])
            fetched = t.fetch()
            db.execute("DELETE FROM segments WHERE video_id = ?", (vid,))
            db.executemany(
                "INSERT INTO segments VALUES (?,?,?,?,?)",
                [(vid, j, s.start, s.duration, s.text) for j, s in enumerate(fetched)],
            )
            db.execute(
                "UPDATE videos SET transcript_status='ok', transcript_lang=?, transcript_generated=?, fetched_at=?, error=NULL WHERE id=?",
                (t.language_code, int(t.is_generated), now(), vid),
            )
            msg = f"ok {t.language_code}{' auto' if t.is_generated else ''} {len(fetched)} seg"
        except Exception as e:
            name = type(e).__name__
            status = "none" if name in ("TranscriptsDisabled", "NoTranscriptFound") else "error"
            db.execute(
                "UPDATE videos SET transcript_status=?, fetched_at=?, error=? WHERE id=?",
                (status, now(), f"{name}: {str(e)[:300]}", vid),
            )
            msg = f"{status} {name}"
        db.commit()
        print(f"[{i}/{len(todo)}] {vid} {msg}", flush=True)
        time.sleep(a.delay)


if __name__ == "__main__":
    main()
