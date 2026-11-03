ALTER TABLE afc_matches ADD COLUMN tie_break_method TEXT NOT NULL DEFAULT ''
    CHECK (tie_break_method IN ('', 'extra-time', 'penalties'));
ALTER TABLE afc_matches ADD COLUMN home_extra_time_score INTEGER
    CHECK (home_extra_time_score IS NULL OR home_extra_time_score >= 0);
ALTER TABLE afc_matches ADD COLUMN away_extra_time_score INTEGER
    CHECK (away_extra_time_score IS NULL OR away_extra_time_score >= 0);
ALTER TABLE afc_matches ADD COLUMN home_penalties_score INTEGER
    CHECK (home_penalties_score IS NULL OR home_penalties_score >= 0);
ALTER TABLE afc_matches ADD COLUMN away_penalties_score INTEGER
    CHECK (away_penalties_score IS NULL OR away_penalties_score >= 0);

DROP TRIGGER IF EXISTS afc_tournament_stage_completion_requires_results;

CREATE TRIGGER afc_tournament_stage_completion_requires_results
BEFORE UPDATE OF status ON afc_tournament_stages
WHEN NEW.status = 'completed'
 AND (
    NOT EXISTS (SELECT 1 FROM afc_matches m WHERE m.stage_id = NEW.id)
    OR EXISTS (
        SELECT 1 FROM afc_matches m
        WHERE m.stage_id = NEW.id
          AND (
              m.published <> 1 OR m.status <> 'completed'
              OR m.home_score IS NULL OR m.away_score IS NULL
              OR (NEW.stage_type NOT IN ('group', 'league') AND m.home_score = m.away_score
                  AND NOT (
                      (m.tie_break_method = 'extra-time'
                       AND m.home_extra_time_score IS NOT NULL
                       AND m.away_extra_time_score IS NOT NULL
                       AND m.home_extra_time_score >= m.home_score
                       AND m.away_extra_time_score >= m.away_score
                       AND m.home_extra_time_score <> m.away_extra_time_score)
                      OR
                      (m.tie_break_method = 'penalties'
                       AND m.home_extra_time_score IS NOT NULL
                       AND m.away_extra_time_score IS NOT NULL
                       AND m.home_extra_time_score = m.away_extra_time_score
                       AND m.home_extra_time_score >= m.home_score
                       AND m.away_extra_time_score >= m.away_score
                       AND m.home_penalties_score IS NOT NULL
                       AND m.away_penalties_score IS NOT NULL
                       AND m.home_penalties_score <> m.away_penalties_score)
                  ))
          )
    )
 )
BEGIN
    SELECT RAISE(ABORT, 'stage completion requires resolved published results');
END;
