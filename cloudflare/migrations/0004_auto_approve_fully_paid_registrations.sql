UPDATE afc_team_registrations
SET status = 'approved',
    review_note = 'Automatically approved after full registration fee confirmation.',
    reviewed_at = CURRENT_TIMESTAMP
WHERE status = 'pending_review'
  AND EXISTS (
      SELECT 1
      FROM afc_payments p
      WHERE p.registration_id = afc_team_registrations.id
        AND p.status IN ('confirmed', 'partial')
  )
  AND fee_amount <= COALESCE((
      SELECT SUM(p.amount)
      FROM afc_payments p
      WHERE p.registration_id = afc_team_registrations.id
        AND p.status IN ('confirmed', 'partial')
  ), 0);

UPDATE afc_users
SET role = 'team_manager',
    status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE role IS NULL
  AND requested_account_type = 'team-manager'
  AND status = 'pending'
  AND EXISTS (
      SELECT 1
      FROM afc_team_registrations r
      WHERE r.manager_uid = afc_users.firebase_uid
        AND r.status = 'approved'
        AND r.review_note = 'Automatically approved after full registration fee confirmation.'
        AND EXISTS (
            SELECT 1
            FROM afc_payments p
            WHERE p.registration_id = r.id
              AND p.status IN ('confirmed', 'partial')
        )
        AND r.fee_amount <= COALESCE((
            SELECT SUM(p.amount)
            FROM afc_payments p
            WHERE p.registration_id = r.id
              AND p.status IN ('confirmed', 'partial')
        ), 0)
  );

INSERT OR IGNORE INTO afc_notifications(id, user_uid, category, title, body, target_path)
SELECT 'NTF-AUTO-APPROVED-' || r.id,
       r.manager_uid,
       'Registration',
       'Registration approved',
       'Your team, ' || tm.name ||
           ', was automatically approved after the full registration fee was confirmed. ' ||
           'You can now sign in and register your team players.',
       '#/squad'
FROM afc_team_registrations r
JOIN afc_teams tm ON tm.id = r.team_id
WHERE r.status = 'approved'
  AND r.review_note = 'Automatically approved after full registration fee confirmation.'
  AND EXISTS (
      SELECT 1
      FROM afc_payments p
      WHERE p.registration_id = r.id
        AND p.status IN ('confirmed', 'partial')
  )
  AND r.fee_amount <= COALESCE((
      SELECT SUM(p.amount)
      FROM afc_payments p
      WHERE p.registration_id = r.id
        AND p.status IN ('confirmed', 'partial')
  ), 0);

INSERT OR IGNORE INTO afc_audit_log(id, actor_uid, action, entity_type, entity_id)
SELECT 'AUD-AUTO-APPROVED-' || r.id,
       NULL,
       'auto_approve_paid_team_registration',
       'team_registration',
       r.id
FROM afc_team_registrations r
WHERE r.status = 'approved'
  AND r.review_note = 'Automatically approved after full registration fee confirmation.'
  AND EXISTS (
      SELECT 1
      FROM afc_payments p
      WHERE p.registration_id = r.id
        AND p.status IN ('confirmed', 'partial')
  )
  AND r.fee_amount <= COALESCE((
      SELECT SUM(p.amount)
      FROM afc_payments p
      WHERE p.registration_id = r.id
        AND p.status IN ('confirmed', 'partial')
  ), 0);
