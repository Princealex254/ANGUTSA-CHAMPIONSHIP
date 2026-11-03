CREATE INDEX IF NOT EXISTS afc_matches_stage_public_status_idx
    ON afc_matches(stage_id, published, status, kickoff);
