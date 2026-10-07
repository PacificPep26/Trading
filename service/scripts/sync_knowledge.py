"""Copy data/knowledge.db (videos + transcript segments) into Postgres.

Usage: DATABASE_URL=... python -m service.scripts.sync_knowledge
Idempotent: upserts videos, replaces segments per video.
"""
import os
import sqlite3
from pathlib import Path

import psycopg

DB = Path(__file__).resolve().parents[2] / "data" / "knowledge.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY, channel TEXT, tab TEXT, title TEXT, url TEXT,
    duration_s INTEGER, listed_at TEXT,
    transcript_status TEXT, transcript_lang TEXT, transcript_generated INTEGER,
    fetched_at TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS segments (
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE, idx INTEGER,
    start_s REAL, duration_s REAL, text TEXT,
    PRIMARY KEY (video_id, idx)
);
CREATE INDEX IF NOT EXISTS segments_text_idx ON segments USING gin (to_tsvector('simple', text));
"""

VIDEO_COLS = ["id", "channel", "tab", "title", "url", "duration_s", "listed_at",
              "transcript_status", "transcript_lang", "transcript_generated", "fetched_at", "error"]


def main():
    src = sqlite3.connect(DB)
    with psycopg.connect(os.environ["DATABASE_URL"]) as pg, pg.cursor() as cur:
        cur.execute(SCHEMA)
        videos = src.execute(f"SELECT {', '.join(VIDEO_COLS)} FROM videos").fetchall()
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in VIDEO_COLS[1:])
        cur.executemany(
            f"INSERT INTO videos ({', '.join(VIDEO_COLS)}) VALUES ({', '.join(['%s'] * len(VIDEO_COLS))}) "
            f"ON CONFLICT (id) DO UPDATE SET {updates}",
            videos,
        )
        ok = [v[0] for v in videos if v[7] == "ok"]
        n = 0
        for vid in ok:
            segs = src.execute("SELECT video_id, idx, start_s, duration_s, text FROM segments WHERE video_id = ?", (vid,)).fetchall()
            cur.execute("DELETE FROM segments WHERE video_id = %s", (vid,))
            with cur.copy("COPY segments (video_id, idx, start_s, duration_s, text) FROM STDIN") as cp:
                for s in segs:
                    cp.write_row(s)
            n += len(segs)
        pg.commit()
        cur.execute("SELECT count(*) FROM videos")
        nv = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM segments")
        ns = cur.fetchone()[0]
    print(f"synced {len(videos)} videos ({len(ok)} with transcript), {n} segments; postgres now has {nv} videos, {ns} segments")


if __name__ == "__main__":
    main()
