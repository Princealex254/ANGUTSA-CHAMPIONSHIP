CREATE TABLE IF NOT EXISTS afc_deleted_manager_email_blocks (
    email_sha256 TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afc_rules_acknowledgements (
    registration_id TEXT NOT NULL REFERENCES afc_team_registrations(id) ON DELETE CASCADE,
    rules_id TEXT NOT NULL REFERENCES afc_rules(id) ON DELETE CASCADE,
    acknowledged_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    acknowledged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(registration_id, rules_id)
);
