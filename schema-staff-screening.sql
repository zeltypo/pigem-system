BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS pigem_private;
REVOKE ALL ON SCHEMA pigem_private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS pigem_private.screening_staff (
  username text PRIMARY KEY CHECK (username = lower(username)),
  staff_id text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('agent', 'manager')),
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  attempts integer NOT NULL DEFAULT 0,
  attempt_window timestamptz NOT NULL DEFAULT now(),
  token_hash text,
  expires_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS screening_staff_token_hash
  ON pigem_private.screening_staff (token_hash) WHERE token_hash IS NOT NULL;

REVOKE ALL ON pigem_private.screening_staff FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_screening_sign_in(login_username text, login_password text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
  token text;
BEGIN
  IF login_username IS NULL OR login_password IS NULL OR
     length(login_username) NOT BETWEEN 3 AND 30 OR octet_length(login_password) NOT BETWEEN 1 AND 72 THEN
    RETURN NULL;
  END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff
    WHERE username = lower(login_username) AND active FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF staff.attempt_window < now() - interval '5 minutes' THEN
    staff.attempt_window := now();
    staff.attempts := 0;
  END IF;
  IF staff.attempts >= 5 THEN RETURN NULL; END IF;
  IF extensions.crypt(login_password, staff.password_hash) IS DISTINCT FROM staff.password_hash THEN
    UPDATE pigem_private.screening_staff SET attempts = staff.attempts + 1,
      attempt_window = staff.attempt_window WHERE username = staff.username;
    RETURN NULL;
  END IF;
  token := 'pigem_staff_' || encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE pigem_private.screening_staff SET attempts = 0, attempt_window = now(),
    token_hash = encode(extensions.digest(token, 'sha256'), 'hex'),
    expires_at = now() + interval '2 hours' WHERE username = staff.username;
  RETURN jsonb_build_object('token', token, 'staff_id', staff.staff_id, 'role', staff.role);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pigem_screening_session(session_token text, revoke_session boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
BEGIN
  IF session_token IS NULL OR session_token !~ '^pigem_staff_[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff
    WHERE token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex')
      AND active AND expires_at > now();
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF revoke_session THEN
    UPDATE pigem_private.screening_staff SET token_hash = NULL, expires_at = NULL
      WHERE username = staff.username AND token_hash = staff.token_hash;
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('id', staff.staff_id, 'role', staff.role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_screening_sign_in(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pigem_screening_session(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_screening_sign_in(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_screening_session(text, boolean) TO anon, authenticated;


ALTER TABLE pigem_private.screening_staff DROP CONSTRAINT IF EXISTS screening_staff_role_check;
ALTER TABLE pigem_private.screening_staff
  ADD CONSTRAINT screening_staff_role_check CHECK (role IN ('admin', 'agent', 'manager'));

CREATE OR REPLACE FUNCTION public.pigem_create_screening_staff(
  admin_token text, staff_username text, staff_name text, staff_password text, staff_role text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  new_id text;
BEGIN
  IF (public.pigem_screening_session(admin_token)->>'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Sign in with your verified Admin password to create staff.';
  END IF;
  IF staff_role IS NULL OR staff_role NOT IN ('agent', 'manager')
     OR staff_username IS NULL OR staff_username !~ '^[A-Za-z0-9_.-]{3,30}$'
     OR staff_name IS NULL OR length(trim(staff_name)) NOT BETWEEN 1 AND 200
     OR staff_password IS NULL OR octet_length(staff_password) NOT BETWEEN 8 AND 72 THEN
    RAISE EXCEPTION 'Check the staff details. Password must be 8 to 72 bytes.';
  END IF;
  new_id := gen_random_uuid()::text;
  INSERT INTO public.users (id, username, full_name, role, active, activated)
    VALUES (new_id, staff_username, trim(staff_name), staff_role, true, true);
  INSERT INTO pigem_private.screening_staff (staff_id, username, role, password_hash)
    VALUES (new_id, lower(staff_username), staff_role,
      extensions.crypt(staff_password, extensions.gen_salt('bf', 12)));
  RETURN jsonb_build_object('id', new_id, 'username', staff_username, 'role', staff_role);
END;
$function$;

REVOKE ALL ON FUNCTION public.pigem_create_screening_staff(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_create_screening_staff(text,text,text,text,text) TO anon, authenticated;

COMMIT;
