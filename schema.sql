CREATE TABLE IF NOT EXISTS watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_identifier TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    source_name TEXT,
    vod_id TEXT,
    source_code TEXT,
    episode_index INTEGER DEFAULT 0,
    direct_video_url TEXT,
    url TEXT,
    playback_position REAL DEFAULT 0,
    duration REAL DEFAULT 0,
    episodes TEXT DEFAULT '[]',
    timestamp INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_watch_history_timestamp ON watch_history(timestamp DESC);
