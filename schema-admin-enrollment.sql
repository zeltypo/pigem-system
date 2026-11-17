BEGIN;

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
