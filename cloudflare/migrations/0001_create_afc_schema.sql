PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS afc_users (
    firebase_uid TEXT PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    full_name TEXT NOT NULL,
    phone TEXT,
    role TEXT CHECK (role IS NULL OR role IN ('platform_owner', 'tournament_admin', 'team_manager')),
    requested_account_type TEXT CHECK (
        requested_account_type IS NULL OR
        requested_account_type IN ('team-manager', 'player', 'official', 'supporter')
    ),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'disabled', 'suspended')),
    email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_users_role_status_idx ON afc_users(role, status);

CREATE TABLE IF NOT EXISTS afc_categories (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    age_group TEXT NOT NULL,
    age_min INTEGER,
    age_max INTEGER,
    gender TEXT NOT NULL CHECK (gender IN ('Men', 'Women', 'Boys', 'Girls', 'Mixed')),
    guardian_consent_required INTEGER NOT NULL DEFAULT 0
        CHECK (guardian_consent_required IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (age_min IS NULL OR age_min >= 0),
    CHECK (age_max IS NULL OR age_max >= age_min)
);

CREATE TABLE IF NOT EXISTS afc_tournaments (
    id TEXT PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    season INTEGER NOT NULL CHECK (season BETWEEN 1900 AND 2200),
    category_id TEXT NOT NULL REFERENCES afc_categories(id),
    format TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'upcoming', 'active', 'completed', 'archived')),
    venue TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL,
    end_date TEXT,
    registration_opens TEXT NOT NULL,
    registration_closes TEXT,
    team_limit INTEGER CHECK (team_limit IS NULL OR team_limit BETWEEN 2 AND 256),
    registration_fee INTEGER NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
    banner TEXT NOT NULL DEFAULT '',
    featured INTEGER NOT NULL DEFAULT 1 CHECK (featured IN (0, 1)),
    standings_available INTEGER NOT NULL DEFAULT 0 CHECK (standings_available IN (0, 1)),
    overview TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_tournaments_public_idx
    ON afc_tournaments(status, featured, start_date);
CREATE INDEX IF NOT EXISTS afc_tournaments_category_idx
    ON afc_tournaments(category_id, season);

CREATE TABLE IF NOT EXISTS afc_teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    short_code TEXT NOT NULL UNIQUE,
    category_id TEXT NOT NULL REFERENCES afc_categories(id),
    manager_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    location TEXT NOT NULL DEFAULT '',
    logo_key TEXT,
    accent TEXT NOT NULL DEFAULT '#5B4BBD',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_teams_manager_idx ON afc_teams(manager_uid);

CREATE TABLE IF NOT EXISTS afc_team_registrations (
    id TEXT PRIMARY KEY,
    public_reference TEXT NOT NULL UNIQUE,
    team_id TEXT NOT NULL REFERENCES afc_teams(id),
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id),
    category_id TEXT NOT NULL REFERENCES afc_categories(id),
    manager_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK (status IN ('pending_review', 'approved', 'rejected', 'correction_requested')),
    manager_public INTEGER NOT NULL DEFAULT 0 CHECK (manager_public IN (0, 1)),
    fee_amount INTEGER NOT NULL CHECK (fee_amount >= 0),
    review_note TEXT NOT NULL DEFAULT '',
    reviewed_by TEXT REFERENCES afc_users(firebase_uid),
    submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    request_key TEXT NOT NULL,
    UNIQUE(manager_uid, request_key),
    UNIQUE(team_id, tournament_id)
);

CREATE INDEX IF NOT EXISTS afc_registrations_manager_idx
    ON afc_team_registrations(manager_uid, submitted_at);
CREATE INDEX IF NOT EXISTS afc_registrations_tournament_status_idx
    ON afc_team_registrations(tournament_id, status);

CREATE TABLE IF NOT EXISTS afc_tournament_admin_scopes (
    user_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid) ON DELETE CASCADE,
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id) ON DELETE CASCADE,
    granted_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_uid, tournament_id)
);

CREATE TABLE IF NOT EXISTS afc_tournament_groups (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(tournament_id, name),
    UNIQUE(tournament_id, position)
);

CREATE TABLE IF NOT EXISTS afc_group_teams (
    group_id TEXT NOT NULL REFERENCES afc_tournament_groups(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES afc_teams(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES afc_team_registrations(id) ON DELETE CASCADE,
    PRIMARY KEY(group_id, registration_id),
    UNIQUE(registration_id)
);

CREATE TABLE IF NOT EXISTS afc_registration_permissions (
    registration_id TEXT PRIMARY KEY REFERENCES afc_team_registrations(id) ON DELETE CASCADE,
    early_player_registration INTEGER NOT NULL DEFAULT 0
        CHECK (early_player_registration IN (0, 1)),
    roster_changes_after_start INTEGER NOT NULL DEFAULT 0
        CHECK (roster_changes_after_start IN (0, 1)),
    updated_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afc_players (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES afc_teams(id) ON DELETE CASCADE,
    registration_id TEXT NOT NULL REFERENCES afc_team_registrations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    nickname TEXT,
    date_of_birth TEXT,
    position TEXT NOT NULL DEFAULT '',
    shirt_number INTEGER CHECK (shirt_number IS NULL OR shirt_number BETWEEN 1 AND 99),
    classification TEXT NOT NULL DEFAULT 'Senior',
    guardian_consent_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK (guardian_consent_status IN ('not_required', 'pending', 'on_file')),
    public_profile TEXT NOT NULL DEFAULT 'hidden'
        CHECK (public_profile IN ('full', 'limited', 'hidden')),
    status TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'inactive')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, shirt_number)
);

CREATE INDEX IF NOT EXISTS afc_players_team_idx ON afc_players(team_id, status);

CREATE TABLE IF NOT EXISTS afc_matches (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id),
    category_id TEXT NOT NULL REFERENCES afc_categories(id),
    group_id TEXT REFERENCES afc_tournament_groups(id),
    stage TEXT NOT NULL,
    round TEXT NOT NULL DEFAULT '',
    home_team_id TEXT REFERENCES afc_teams(id),
    away_team_id TEXT REFERENCES afc_teams(id),
    kickoff TEXT NOT NULL,
    venue TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('draft', 'scheduled', 'live', 'postponed', 'cancelled', 'completed')),
    home_score INTEGER CHECK (home_score IS NULL OR home_score >= 0),
    away_score INTEGER CHECK (away_score IS NULL OR away_score >= 0),
    note TEXT NOT NULL DEFAULT '',
    published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0, 1)),
    created_by TEXT REFERENCES afc_users(firebase_uid),
    updated_by TEXT REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id)
);

CREATE INDEX IF NOT EXISTS afc_matches_tournament_date_idx
    ON afc_matches(tournament_id, kickoff);
CREATE INDEX IF NOT EXISTS afc_matches_public_idx
    ON afc_matches(published, status, kickoff);

CREATE TABLE IF NOT EXISTS afc_match_events (
    id TEXT PRIMARY KEY,
    match_id TEXT NOT NULL REFERENCES afc_matches(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES afc_teams(id),
    player_id TEXT REFERENCES afc_players(id),
    event_type TEXT NOT NULL CHECK (event_type IN ('goal', 'own_goal', 'yellow_card', 'red_card')),
    minute INTEGER CHECK (minute IS NULL OR minute BETWEEN 0 AND 150),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afc_match_officials (
    match_id TEXT NOT NULL REFERENCES afc_matches(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Match Official',
    PRIMARY KEY(match_id, name, role)
);

CREATE TABLE IF NOT EXISTS afc_payments (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    registration_id TEXT NOT NULL REFERENCES afc_team_registrations(id),
    team_id TEXT NOT NULL REFERENCES afc_teams(id),
    tournament_id TEXT NOT NULL REFERENCES afc_tournaments(id),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'KES',
    method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'partial', 'rejected', 'refunded')),
    recorded_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    idempotency_key TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    review_note TEXT NOT NULL DEFAULT '',
    UNIQUE(recorded_by, idempotency_key)
);

CREATE INDEX IF NOT EXISTS afc_payments_registration_idx
    ON afc_payments(registration_id, recorded_at);

CREATE TABLE IF NOT EXISTS afc_rules (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES afc_categories(id),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
    updated_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category_id, title)
);

CREATE TABLE IF NOT EXISTS afc_news_articles (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    author TEXT NOT NULL,
    image_key TEXT,
    excerpt TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
    published_at TEXT,
    created_by TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_news_public_idx
    ON afc_news_articles(status, featured, published_at);

CREATE TABLE IF NOT EXISTS afc_faqs (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 1 CHECK (published IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_faqs_public_idx
    ON afc_faqs(published, position);

CREATE TABLE IF NOT EXISTS afc_notifications (
    id TEXT PRIMARY KEY,
    user_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid) ON DELETE CASCADE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    target_path TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_notifications_user_idx
    ON afc_notifications(user_uid, read_at, created_at);

CREATE TABLE IF NOT EXISTS afc_media (
    object_key TEXT PRIMARY KEY,
    owner_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid),
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afc_app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_by TEXT REFERENCES afc_users(firebase_uid),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS afc_email_events (
    id TEXT PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    recipient_uid TEXT REFERENCES afc_users(firebase_uid),
    event_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'failed')),
    provider_message_id TEXT,
    attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS afc_api_idempotency (
    user_uid TEXT NOT NULL REFERENCES afc_users(firebase_uid) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    route TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_uid, idempotency_key, route)
);

CREATE TABLE IF NOT EXISTS afc_rate_limits (
    rate_key TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL CHECK (request_count >= 0),
    PRIMARY KEY(rate_key, window_start)
);

CREATE TABLE IF NOT EXISTS afc_audit_log (
    id TEXT PRIMARY KEY,
    actor_uid TEXT REFERENCES afc_users(firebase_uid),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS afc_audit_log_created_idx
    ON afc_audit_log(created_at);
