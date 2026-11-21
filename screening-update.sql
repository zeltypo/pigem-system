-- Non-destructive update for the previous rebuilt PIGEM schema only.
-- Back up data first and apply before deploying the matching source.
BEGIN;

CREATE OR REPLACE FUNCTION public.pigem_validate_status()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status='Pending Review' AND NEW.status='Under Agent Review') OR
    (OLD.status='Pending Review' AND NEW.status='Needs Correction' AND current_user IN ('postgres','service_role') AND NEW.screening->>'auto_correction_sent'='true') OR
    (OLD.status='Under Agent Review' AND NEW.status IN ('Encoding','Needs Correction')) OR
    (OLD.status='Encoding' AND NEW.status IN ('Approved','Rejected','Needs Correction')) OR
    (OLD.status='Needs Correction' AND NEW.status IN ('Pending Review','Under Agent Review','Rejected'))
  ) THEN RAISE EXCEPTION 'Invalid application status change: % to %',OLD.status,NEW.status; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pigem_private.queue_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  rev text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.corrected_copy IS NOT DISTINCT FROM OLD.corrected_copy THEN RETURN NEW; END IF;
  END IF;
  IF NEW.status NOT IN ('Pending Review','Under Agent Review') THEN RETURN NEW; END IF;
  rev := pigem_private.application_revision(NEW);
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE id='main' AND ai_enabled) THEN
    NEW.screening := COALESCE(NEW.screening,'{}'::jsonb) || '{"state":"manual_fallback","background_state":"failed","manual_fallback":true,"summary":"Review documents manually."}'::jsonb;
    RETURN NEW;
  END IF;
  NEW.screening := COALESCE(NEW.screening,'{}'::jsonb) - 'background_findings' - 'browser_check' - 'background_revision' - 'auto_correction_sent' - 'openai_response_id' - 'manual_fallback' - 'correction_photo_sides' - 'started_at' - 'deadline_at' - 'finished_at' - 'triage' - 'summary' - 'final_recommendation';
  NEW.screening := NEW.screening || jsonb_build_object('state','queued','background_state','queued','queued_at',now(),'phase','Waiting for document check','revision',rev,'eta_seconds',0);
  NEW.ai_result := NULL;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pigem_claim_screening()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  job pigem_private.screening_jobs%ROWTYPE;
  a public.applications%ROWTYPE;
  c jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(92163018);
  UPDATE pigem_private.screening_jobs SET state='failed',finished_at=now()
  WHERE state='queued' AND created_at<now()-interval '20 minutes';
  UPDATE pigem_private.screening_jobs SET state='failed',finished_at=now()
  WHERE state='running' AND attempts>=2 AND started_at<now()-interval '6 minutes';
  UPDATE public.applications a0 SET screening = a0.screening || jsonb_build_object(
    'state','manual_fallback','background_state','failed','manual_fallback',true,
    'summary','Document check could not finish. Review manually.','eta_seconds',0)
  FROM pigem_private.screening_jobs j WHERE j.application_id=a0.id
    AND j.revision=pigem_private.application_revision(a0) AND j.state='failed'
    AND a0.screening->>'background_state' IN ('running','queued');
  IF NOT EXISTS (SELECT 1 FROM public.system_settings WHERE id='main' AND ai_enabled) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM pigem_private.screening_jobs WHERE state='running' AND started_at>=now()-interval '6 minutes') THEN RETURN NULL; END IF;
  SELECT j.* INTO job FROM pigem_private.screening_jobs j
  JOIN public.applications a0 ON a0.id=j.application_id
  WHERE j.revision=pigem_private.application_revision(a0)
    AND a0.status IN ('Pending Review','Under Agent Review')
    AND (j.state='queued' OR (j.state='running' AND j.attempts<2 AND j.started_at<now()-interval '6 minutes'))
  ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE pigem_private.screening_jobs SET state='running',attempts=attempts+1,started_at=now()
  WHERE id=job.id RETURNING * INTO job;
  SELECT * INTO a FROM public.applications WHERE id=job.application_id;
  c := COALESCE(a.corrected_copy,'{}'::jsonb);
  UPDATE public.applications SET screening=screening || jsonb_build_object(
    'background_state','running','state','layer1_running','phase','Checking documents',
    'started_at',job.started_at,'deadline_at',job.started_at+interval '6 minutes','eta_seconds',0), updated_at=now()
  WHERE id=a.id;
  RETURN jsonb_build_object('id',job.id,'application_id',a.id,'attempt',job.attempts,'revision',job.revision,
    'customer_email',COALESCE(NULLIF(c->>'contact_email',''),a.email),'reference_no',a.ref_no,
    'payload',jsonb_build_object(
      'front',COALESCE(NULLIF(c->>'id_image_url',''),NULLIF(c->>'id_front_path',''),a.id_image_url,a.id_front_path),
      'back',COALESCE(NULLIF(c->>'id_back_image_url',''),NULLIF(c->>'id_back_path',''),a.id_back_image_url,a.id_back_path),
      'full_name',COALESCE(c->>'full_name',a.full_name),'birth_date',COALESCE(c->>'birth_date',a.birth_date),
      'id_number',COALESCE(c->>'id_number',a.id_number),'id_type',COALESCE(c->>'id_type',a.id_type)));
END $$;

CREATE OR REPLACE FUNCTION public.pigem_screening_progress(job_id uuid, job_attempt integer, stage text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE phase_label text;
BEGIN
  phase_label := CASE stage WHEN 'quality_done' THEN 'Photo assessment completed'
    WHEN 'photo_preparation' THEN 'Preparing ID photos' WHEN 'extraction' THEN 'Reading ID details'
    WHEN 'comparison' THEN 'Comparing application details' WHEN 'recommendation' THEN 'Preparing recommendation' ELSE NULL END;
  IF phase_label IS NULL THEN RETURN false; END IF;
  UPDATE public.applications a SET screening=a.screening||jsonb_build_object('phase',phase_label)
  FROM pigem_private.screening_jobs j WHERE j.id=job_id AND j.attempts=job_attempt AND j.state='running'
    AND j.application_id=a.id AND j.revision=pigem_private.application_revision(a)
    AND a.status IN ('Pending Review','Under Agent Review');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.pigem_finish_screening(job_id uuid, job_attempt integer, findings jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  job pigem_private.screening_jobs%ROWTYPE;
  a public.applications%ROWTYPE;
  result_state text;
  triage text;
  auto_correction boolean;
  correction_message text;
  correction_sides jsonb;
BEGIN
  SELECT * INTO job FROM pigem_private.screening_jobs WHERE id=job_id FOR UPDATE;
  IF NOT FOUND OR job.state<>'running' OR job.attempts<>job_attempt THEN RETURN false; END IF;
  SELECT * INTO a FROM public.applications WHERE id=job.application_id FOR UPDATE;
  IF NOT FOUND OR pigem_private.application_revision(a)<>job.revision OR a.status NOT IN ('Pending Review','Under Agent Review') THEN
    UPDATE pigem_private.screening_jobs SET state='superseded',finished_at=now() WHERE id=job_id;
    RETURN false;
  END IF;
  result_state := CASE WHEN findings IS NULL THEN 'failed' ELSE 'completed' END;
  triage := COALESCE(findings->>'triage','yellow');
  auto_correction := COALESCE(triage='red' AND findings->>'autoNeedsCorrection'='true' AND jsonb_array_length(COALESCE(findings->'confirmedDefects','[]'::jsonb))>0, false);
  correction_message := COALESCE(NULLIF(findings->>'suggestedPoliteRemark',''),'Please replace the affected ID photo in My Account with a clear photo of the correct side.');
  correction_sides := COALESCE(findings->'correctionPhotoSides','[]'::jsonb);
  UPDATE pigem_private.screening_jobs SET state=result_state,finished_at=now() WHERE id=job_id;
  UPDATE public.applications SET
    screening=screening || jsonb_build_object(
      'background_state',result_state,'state',CASE WHEN findings IS NULL THEN 'manual_fallback' ELSE 'completed' END,
      'manual_fallback',findings IS NULL OR COALESCE(findings->>'manualFallback'='true',false),'background_revision',job.revision,'background_findings',findings,
      'phase',CASE WHEN findings IS NULL THEN 'Manual review needed' WHEN auto_correction THEN 'Correction requested' ELSE 'Ready for agent review' END,
      'auto_correction_sent',auto_correction,'auto_correction_type',CASE WHEN auto_correction THEN 'pigem_screening' ELSE '' END,
      'correction_photo_sides',CASE WHEN auto_correction THEN correction_sides ELSE '[]'::jsonb END,
      'finished_at',now(),'eta_seconds',0,'triage',triage,'route',COALESCE(findings->>'route',''),
      'summary',COALESCE(findings->>'queueSummary','Document check unavailable. Review manually.'),
      'final_recommendation',COALESCE(findings->>'finalRecommendation','Review original documents manually.'),
      'review_recommended',triage<>'green','overall_match',triage='green',
      'Suggested_remark',COALESCE(findings->>'suggestedPoliteRemark',''),
      'browser_check',jsonb_build_object('reader_version',5,'revision',COALESCE(a.corrected_copy->>'submitted_at',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'findings',findings)),
    updated_at=now(), status=CASE WHEN auto_correction THEN 'Needs Correction' ELSE a.status END,
    correction_fields=CASE WHEN auto_correction THEN '["id_photo"]'::jsonb ELSE a.correction_fields END,
    correction_note=CASE WHEN auto_correction THEN correction_message ELSE a.correction_note END,
    customer_instruction=CASE WHEN auto_correction THEN correction_message ELSE a.customer_instruction END,
    agent_remarks=CASE WHEN auto_correction THEN correction_message ELSE a.agent_remarks END,
    correction_declined=CASE WHEN auto_correction THEN false ELSE a.correction_declined END,
    ai_result=jsonb_build_object('overall_status',CASE WHEN triage='green' THEN 'Verified' WHEN auto_correction THEN 'Needs Correction' ELSE 'Needs Review' END,'triage',triage,'route',findings->>'route',
      'name_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='name' AND f->>'status'='match'),
      'birth_date_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='birth_date' AND f->>'status'='match'),
      'id_number_match',EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(findings->'fields','[]'::jsonb)) f WHERE f->>'key'='id_number' AND f->>'status'='match'),
      'issues',COALESCE(findings->'aiFindings','[]'::jsonb)||COALESCE(findings->'tamperingFlags','[]'::jsonb)),
    id_cropped_url=COALESCE(findings#>>'{stages,photoPreparation,front,preview_data_url}',''),
    id_back_cropped_url=COALESCE(findings#>>'{stages,photoPreparation,back,preview_data_url}',''),
    ai_log=COALESCE(ai_log,'[]'::jsonb)||jsonb_build_array(jsonb_build_object('at',now(),'who','Document check','text',COALESCE(findings->>'queueSummary','Manual review needed.'))),
    original_copy=CASE WHEN a.corrected_copy IS NULL AND findings IS NOT NULL THEN COALESCE(original_copy,'{}'::jsonb)||jsonb_build_object('screening_findings',findings) ELSE original_copy END,
    original_submission=CASE WHEN a.corrected_copy IS NULL AND findings IS NOT NULL THEN COALESCE(original_submission,'{}'::jsonb)||jsonb_build_object('screening_findings',findings) ELSE original_submission END
  WHERE id=job.application_id;
  IF auto_correction THEN
    INSERT INTO public.notifications(user_id,email,role,title,message,target_tab,target_id)
    VALUES (a.customer_id,COALESCE(a.corrected_copy->>'contact_email',a.email),'customer',
      'Update needed for application '||a.ref_no,correction_message,'tab-apps',a.id);
  END IF;
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.pigem_screening_progress(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_screening_progress(uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.pigem_claim_screening(),public.pigem_finish_screening(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pigem_claim_screening(),public.pigem_finish_screening(uuid,integer,jsonb) TO service_role;
COMMIT;

