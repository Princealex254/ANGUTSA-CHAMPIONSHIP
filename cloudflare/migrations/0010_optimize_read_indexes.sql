CREATE INDEX IF NOT EXISTS afc_registrations_status_team_tournament_idx
    ON afc_team_registrations(status, team_id, tournament_id);

CREATE INDEX IF NOT EXISTS afc_registrations_manager_team_idx
    ON afc_team_registrations(manager_uid, team_id);

CREATE INDEX IF NOT EXISTS afc_players_registration_name_idx
    ON afc_players(registration_id, name);

CREATE INDEX IF NOT EXISTS afc_match_events_match_type_minute_idx
    ON afc_match_events(match_id, event_type, minute);
