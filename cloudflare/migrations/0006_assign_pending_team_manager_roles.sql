UPDATE afc_users
SET role = 'team_manager',
    updated_at = CURRENT_TIMESTAMP
WHERE role IS NULL
  AND requested_account_type = 'team-manager'
  AND status = 'pending';
