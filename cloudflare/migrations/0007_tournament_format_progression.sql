CREATE TABLE IF NOT EXISTS afc_tournament_stages (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id),
    name TEXT NOT NULL,
    stage_type TEXT NOT NULL CHECK (
        stage_type IN (
            'league', 'group', 'preliminary', 'round-of-16',
            'quarter-finals', 'semi-finals', 'third-place-playoff', 'final'
        )
    ),
    position INTEGER NOT NULL CHECK (position >= 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (
        status IN ('draft', 'awaiting_approval', 'approved', 'published',
            'in_progress', 'completed', 'skipped', 'locked')
    ),
    participant_source TEXT NOT NULL CHECK (
        participant_source IN (
            'approved_teams', 'group_positions', 'overall_standings',
            'match_winners', 'match_losers', 'manual'
        )
    ),
    qualification_json TEXT NOT NULL DEFAULT '{}',
    pairing_json TEXT NOT NULL DEFAULT '{}',
    settings_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_by TEXT REFERENCES afc_users(firebase_uid),
    updated_by TEXT REFERENCES afc_users(firebase_uid),
    approved_by TEXT REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TEXT,
    UNIQUE(tournament_id, position)
);

ALTER TABLE afc_matches ADD COLUMN stage_id TEXT REFERENCES afc_tournament_stages(id);
ALTER TABLE afc_matches ADD COLUMN stage_fixture_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS afc_matches_stage_fixture_key_idx
    ON afc_matches(stage_fixture_key) WHERE stage_fixture_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS afc_stage_fixture_requires_approval
BEFORE INSERT ON afc_matches
WHEN NEW.stage_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1 FROM afc_tournament_stages s
    WHERE s.id = NEW.stage_id
      AND s.tournament_id = NEW.tournament_id
      AND s.status = 'approved'
)
BEGIN
    SELECT RAISE(ABORT, 'stage fixtures require current approval');
END;

CREATE INDEX IF NOT EXISTS afc_tournament_stages_tournament_idx
    ON afc_tournament_stages(tournament_id, position);

CREATE TABLE IF NOT EXISTS afc_stage_participants (
    stage_id TEXT NOT NULL REFERENCES afc_tournament_stages(id),
    team_id TEXT NOT NULL REFERENCES afc_teams(id),
    source TEXT NOT NULL DEFAULT 'manual',
    seed INTEGER CHECK (seed IS NULL OR seed > 0),
    selected_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(stage_id, team_id),
    UNIQUE(stage_id, seed)
);

CREATE INDEX IF NOT EXISTS afc_stage_participants_team_idx
    ON afc_stage_participants(team_id, stage_id);

CREATE TABLE IF NOT EXISTS afc_stage_approvals (
    stage_id TEXT NOT NULL REFERENCES afc_tournament_stages(id),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    actor_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(stage_id, revision)
);

CREATE TRIGGER IF NOT EXISTS afc_stage_approvals_require_current_draft
BEFORE INSERT ON afc_stage_approvals
WHEN NOT EXISTS (
    SELECT 1 FROM afc_tournament_stages s
    WHERE s.id = NEW.stage_id
      AND s.revision = NEW.revision
      AND s.status IN ('draft', 'awaiting_approval')
)
BEGIN
    SELECT RAISE(ABORT, 'stage approval is stale or no longer pending');
END;

CREATE TRIGGER IF NOT EXISTS afc_tournament_stage_completion_requires_results
BEFORE UPDATE OF status ON afc_tournament_stages
WHEN NEW.status = 'completed'
 AND (
    NOT EXISTS (SELECT 1 FROM afc_matches m WHERE m.stage_id = NEW.id)
    OR EXISTS (
        SELECT 1 FROM afc_matches m
        WHERE m.stage_id = NEW.id
          AND (m.published <> 1 OR m.status <> 'completed'
               OR m.home_score IS NULL OR m.away_score IS NULL
               OR (NEW.stage_type <> 'group' AND m.home_score = m.away_score))
    )
 )
BEGIN
    SELECT RAISE(ABORT, 'stage completion requires resolved published results');
END;
