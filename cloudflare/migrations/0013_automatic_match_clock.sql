ALTER TABLE afc_matches
    ADD COLUMN live_clock_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (live_clock_mode IN ('automatic', 'paused', 'manual', 'finished'));

ALTER TABLE afc_matches
    ADD COLUMN live_clock_started_at TEXT;

ALTER TABLE afc_matches
    ADD COLUMN live_clock_elapsed_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (live_clock_elapsed_seconds >= 0);

ALTER TABLE afc_matches
    ADD COLUMN live_extra_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (live_extra_minutes BETWEEN 0 AND 30);

UPDATE afc_matches
SET live_clock_mode = CASE
    WHEN status = 'live' THEN 'manual'
    WHEN status = 'completed' THEN 'finished'
    ELSE 'automatic'
END;

UPDATE afc_matches
SET live_clock_elapsed_seconds = CASE
    WHEN live_minute <= 45 THEN live_minute * 60
    ELSE 3600 + (live_minute - 46) * 60
END
WHERE status = 'live';

UPDATE afc_matches
SET live_extra_minutes = MIN(30, MAX(0, live_minute - 90))
WHERE status = 'live';
