CREATE TABLE IF NOT EXISTS afc_rules_acknowledgment_reminders (
    id TEXT PRIMARY KEY,
    rules_id TEXT NOT NULL REFERENCES afc_rules(id) ON DELETE CASCADE,
    manager_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    sent_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_rules_acknowledgment_reminders_lookup_idx
    ON afc_rules_acknowledgment_reminders(rules_id, manager_uid, sent_at);
