-- PIGEM dashboard refinement. Run once in the existing database, before deploying.
-- No tables or storage objects are dropped. Existing applications and documents remain.
BEGIN;

CREATE OR REPLACE FUNCTION public.pigem_screening_sign_in(
  login_username text,
  login_password text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $function$
DECLARE
  staff pigem_private.screening_staff%ROWTYPE;
  token text;
BEGIN
  IF login_username IS NULL OR length(login_username) NOT BETWEEN 3 AND 30 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO staff
  FROM pigem_private.screening_staff
  WHERE username = lower(login_username)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF NOT staff.active THEN
    RETURN jsonb_build_object('enrolled', true, 'reason', 'disabled');
  END IF;

  IF staff.attempt_window < now() - interval '30 minutes' THEN
    staff.attempt_window := now();
    staff.attempts := 0;
  END IF;

  IF staff.attempts >= 5 THEN
    RETURN jsonb_build_object('enrolled', true, 'reason', 'locked', 'locked_until', staff.attempt_window + interval '30 minutes');
  END IF;

  IF login_password IS NULL
     OR octet_length(login_password) NOT BETWEEN 1 AND 72
     OR extensions.crypt(login_password, staff.password_hash) IS DISTINCT FROM staff.password_hash THEN
    UPDATE pigem_private.screening_staff
    SET attempts       = staff.attempts + 1,
        attempt_window = CASE WHEN staff.attempts + 1 >= 5 THEN now() ELSE staff.attempt_window END
    WHERE username = staff.username;

    IF staff.attempts + 1 >= 5 THEN
      RETURN jsonb_build_object('enrolled', true, 'reason', 'locked', 'locked_until', now() + interval '30 minutes');
    END IF;
    RETURN jsonb_build_object('enrolled', true, 'reason', 'wrong_password');
  END IF;

  token := 'pigem_staff_' || encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE pigem_private.screening_staff
  SET attempts       = 0,
      attempt_window = now(),
      token_hash     = encode(extensions.digest(token, 'sha256'), 'hex'),
      expires_at     = now() + interval '2 hours'
  WHERE username = staff.username;

  RETURN jsonb_build_object(
    'token',    token,
    'staff_id', staff.staff_id,
    'role',     staff.role
  );
END;
$function$;

-- Resolve an approved referral without returning personal profile records.
CREATE OR REPLACE FUNCTION public.pigem_resolve_referral(referral_code text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object('code', l.code, 'agent_id', u.id,
    'assigned_agent', CASE WHEN coalesce(u.username,'')<>'' THEN '@'||ltrim(u.username,'@') ELSE u.email END)
  FROM public.agent_links l
  JOIN public.users u ON (l.agent_id=u.id OR (coalesce(u.username,'')<>'' AND lower(ltrim(coalesce(l.agent_email,''),'@'))=lower(ltrim(u.username,'@')))
    OR lower(l.agent_email)=lower(u.email))
  WHERE l.code=upper(trim(referral_code)) AND l.code LIKE 'REF-%' AND l.active
    AND u.role='agent' AND u.active IS DISTINCT FROM false
    AND NOT (l.code='REF-CAV01' AND coalesce(l.agent_email,'')='agent@demo.test')
  ORDER BY l.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.pigem_resolve_referral(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_resolve_referral(text) TO anon, authenticated;

-- Protect referral writes using the same active staff sessions as the rest of PIGEM.
-- Legacy staff can use their current portal session until migrated to verified staff credentials.
CREATE OR REPLACE FUNCTION public.pigem_referral_actor(verified_token text, portal_token text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; actor_id text;
BEGIN
  actor := public.pigem_screening_session(verified_token, false);
  IF actor IS NOT NULL THEN RETURN actor->>'id'; END IF;
  IF coalesce(portal_token,'')='' THEN RETURN NULL; END IF;
  SELECT u.id INTO actor_id FROM public.users u
  WHERE u.session_token=portal_token AND u.active AND u.role IN ('agent','manager')
    AND NOT EXISTS (SELECT 1 FROM pigem_private.screening_staff s WHERE s.staff_id=u.id);
  RETURN actor_id;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_referral_actor(text,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pigem_request_referral(verified_token text, portal_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE agent public.users%ROWTYPE; link public.agent_links%ROWTYPE; new_code text;
BEGIN
  SELECT * INTO agent FROM public.users WHERE id=public.pigem_referral_actor(verified_token,portal_token) AND active AND role='agent' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sign in as an agent to request a link'; END IF;
  SELECT * INTO link FROM public.agent_links WHERE code LIKE 'REF-%' AND
    (agent_id=agent.id OR lower(ltrim(coalesce(agent_email,''),'@'))=lower(ltrim(agent.username,'@')) OR lower(agent_email)=lower(agent.email))
    ORDER BY active DESC, created_at ASC LIMIT 1;
  IF FOUND THEN RETURN to_jsonb(link); END IF;
  new_code := 'REF-'||upper(substr(encode(extensions.digest(agent.id,'sha256'),'hex'),1,24));
  INSERT INTO public.agent_links(code,agent_id,agent_email,agent_name,active,note)
  VALUES(new_code,agent.id,'@'||ltrim(agent.username,'@'),agent.full_name,false,'Requested') RETURNING * INTO link;
  RETURN to_jsonb(link);
END;
$$;
CREATE OR REPLACE FUNCTION public.pigem_approve_referral(referral_code text, verified_token text, portal_token text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id=public.pigem_referral_actor(verified_token,portal_token) AND active AND role='manager') THEN
    RAISE EXCEPTION 'Sign in as a manager to approve a link';
  END IF;
  UPDATE public.agent_links SET active=true,note='Approved' WHERE code=referral_code AND code LIKE 'REF-%' AND NOT active;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_request_referral(text,text), public.pigem_approve_referral(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_request_referral(text,text), public.pigem_approve_referral(text,text,text) TO anon, authenticated;

-- Existing one-time registration invitations remain compatible; referral changes use the RPCs.
DROP POLICY IF EXISTS "Allow all on agent_links" ON public.agent_links;
DROP POLICY IF EXISTS "Read agent links" ON public.agent_links;
DROP POLICY IF EXISTS "Manage registration invitations" ON public.agent_links;
CREATE POLICY "Read agent links" ON public.agent_links FOR SELECT USING (true);
CREATE POLICY "Manage registration invitations" ON public.agent_links FOR ALL
USING (code LIKE 'INV-%') WITH CHECK (code LIKE 'INV-%');

CREATE OR REPLACE FUNCTION public.pigem_assign_referral()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE referral jsonb;
BEGIN
  IF coalesce(NEW.agent_link_code, '') <> '' THEN
    referral := public.pigem_resolve_referral(NEW.agent_link_code);
    IF referral IS NULL THEN RAISE EXCEPTION 'Application link is unavailable'; END IF;
    NEW.agent_link_code := referral->>'code';
    NEW.agent_id := referral->>'agent_id';
    NEW.assigned_agent := referral->>'assigned_agent';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS pigem_assign_referral ON public.applications;
CREATE TRIGGER pigem_assign_referral BEFORE INSERT ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.pigem_assign_referral();

-- Remove only the known sample referral if it has no linked application.
DELETE FROM public.agent_links l WHERE l.code='REF-CAV01' AND l.agent_email='agent@demo.test'
AND NOT EXISTS (SELECT 1 FROM public.applications a WHERE a.agent_link_code=l.code);

CREATE OR REPLACE FUNCTION public.pigem_change_verified_password(verified_token text, current_password text, new_password text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor jsonb; staff pigem_private.screening_staff%ROWTYPE;
BEGIN
  actor := public.pigem_screening_session(verified_token,false);
  IF actor IS NULL THEN RAISE EXCEPTION 'Sign in again to change your password'; END IF;
  SELECT * INTO staff FROM pigem_private.screening_staff WHERE staff_id=actor->>'id' AND active FOR UPDATE;
  IF NOT FOUND OR current_password IS NULL OR octet_length(current_password) NOT BETWEEN 1 AND 72
    OR extensions.crypt(current_password,staff.password_hash) IS DISTINCT FROM staff.password_hash
    THEN RAISE EXCEPTION 'Current password is incorrect'; END IF;
  IF new_password IS NULL OR length(new_password)<8 OR octet_length(new_password)>72
     OR new_password !~ '[A-Z]' OR new_password !~ '[a-z]' OR new_password !~ '[0-9]' OR new_password !~ '[^A-Za-z0-9]'
    THEN RAISE EXCEPTION 'New password does not meet the password requirements'; END IF;
  IF new_password=current_password THEN RAISE EXCEPTION 'Choose a different password'; END IF;
  UPDATE pigem_private.screening_staff SET password_hash=extensions.crypt(new_password,extensions.gen_salt('bf',12))
    WHERE staff_id=staff.staff_id;
  UPDATE public.users SET password_changed_at=now() WHERE id=staff.staff_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.pigem_change_verified_password(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pigem_change_verified_password(text,text,text) TO anon, authenticated;

COMMIT;
