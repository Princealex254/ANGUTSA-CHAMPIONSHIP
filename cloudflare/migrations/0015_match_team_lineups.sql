CREATE TABLE IF NOT EXISTS afc_match_lineups (
    match_id TEXT NOT NULL REFERENCES afc_matches(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES afc_teams(id) ON DELETE CASCADE,
    manager_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    starters_json TEXT NOT NULL DEFAULT '[]',
    substitutes_json TEXT NOT NULL DEFAULT '[]',
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (match_id, team_id)
);

CREATE INDEX IF NOT EXISTS afc_match_lineups_manager_idx
    ON afc_match_lineups(manager_uid, match_id);
