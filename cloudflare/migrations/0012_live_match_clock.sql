ALTER TABLE afc_matches
    ADD COLUMN live_minute INTEGER NOT NULL DEFAULT 0
    CHECK (live_minute BETWEEN 0 AND 150);
