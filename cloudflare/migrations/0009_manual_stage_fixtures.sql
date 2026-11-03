DROP TRIGGER IF EXISTS afc_stage_fixture_requires_approval;

CREATE TRIGGER afc_stage_fixture_requires_approval
BEFORE INSERT ON afc_matches
WHEN NEW.stage_id IS NOT NULL
 AND NOT EXISTS (
    SELECT 1 FROM afc_tournament_stages s
    WHERE s.id = NEW.stage_id
      AND s.tournament_id = NEW.tournament_id
      AND s.status IN ('approved', 'published', 'in_progress')
)
BEGIN
    SELECT RAISE(ABORT, 'stage fixtures require an active approved stage');
END;
