CREATE TABLE IF NOT EXISTS afc_user_permissions (
    user_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid) ON DELETE CASCADE,
    permission_key TEXT NOT NULL,
    effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
    updated_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_uid, permission_key)
);

CREATE INDEX IF NOT EXISTS afc_user_permissions_actor_idx
    ON afc_user_permissions(user_uid, effect);
