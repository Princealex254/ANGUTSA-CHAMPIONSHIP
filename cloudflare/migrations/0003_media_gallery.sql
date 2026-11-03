CREATE TABLE IF NOT EXISTS afc_media_items (
    id TEXT PRIMARY KEY,
    media_type TEXT NOT NULL CHECK (media_type IN ('image', 'video')),
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'unpublished')),
    file_path TEXT,
    video_url TEXT,
    added_on TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (media_type = 'image' AND video_url IS NULL AND file_path IS NOT NULL) OR
        (media_type = 'video' AND video_url IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS afc_media_items_public_idx
    ON afc_media_items(status, added_on DESC, created_at DESC);
