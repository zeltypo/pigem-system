-- Add the columns used by the current portal to an existing PIGEM database.
-- This does not replace policies or change existing accounts and application rows.
BEGIN;

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS id_cropped_url TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS id_back_cropped_url TEXT DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_admin
  ON public.users (role) WHERE role = 'admin';

COMMIT;
