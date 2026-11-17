WITH enrollment AS (
  SELECT id, lower(username) AS username, role,
         encode(extensions.gen_random_bytes(18), 'hex') AS new_password
  FROM public.users
  WHERE lower(username) = lower('PALITAN_NG_ADMIN_USERNAME')
    AND active IS TRUE
    AND role = 'admin'
),
saved AS (
  INSERT INTO pigem_private.screening_staff (staff_id, username, role, password_hash)
  SELECT id, username, role, extensions.crypt(new_password, extensions.gen_salt('bf', 12))
  FROM enrollment
  ON CONFLICT (staff_id) DO UPDATE
  SET username = excluded.username, role = excluded.role,
      password_hash = excluded.password_hash, active = true,
      attempts = 0, attempt_window = now(), token_hash = NULL, expires_at = NULL
  RETURNING staff_id, username
)
SELECT saved.username, enrollment.new_password
FROM saved JOIN enrollment ON enrollment.id = saved.staff_id;
