-- Power Sense authenticated ownership. Legacy anonymous records and files
-- were explicitly removed before applying this migration, so user_id can be
-- required immediately without attributing old data to an account.

ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.bills
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.bills
  DROP CONSTRAINT IF EXISTS bills_source_file_path_check;

ALTER TABLE public.bills
  ADD CONSTRAINT bills_source_file_path_user_check
  CHECK (
    source_file_path IS NULL
    OR split_part(source_file_path, '/', 1) = user_id::text
  );

DROP POLICY IF EXISTS "session can read own bills" ON public.bills;
DROP POLICY IF EXISTS "session can insert own bills" ON public.bills;
DROP POLICY IF EXISTS "session can update own bills" ON public.bills;
DROP POLICY IF EXISTS "session can delete own bills" ON public.bills;
DROP POLICY IF EXISTS "users can read own bills" ON public.bills;
DROP POLICY IF EXISTS "users can insert own bills" ON public.bills;
DROP POLICY IF EXISTS "users can update own bills" ON public.bills;
DROP POLICY IF EXISTS "users can delete own bills" ON public.bills;

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own bills"
  ON public.bills FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "users can insert own bills"
  ON public.bills FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "users can update own bills"
  ON public.bills FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "users can delete own bills"
  ON public.bills FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.bills FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bills TO authenticated;

DROP POLICY IF EXISTS "session can upload bill files" ON storage.objects;
DROP POLICY IF EXISTS "session can read bill files" ON storage.objects;
DROP POLICY IF EXISTS "session can delete bill files" ON storage.objects;
DROP POLICY IF EXISTS "users can upload own bill files" ON storage.objects;
DROP POLICY IF EXISTS "users can read own bill files" ON storage.objects;
DROP POLICY IF EXISTS "users can delete own bill files" ON storage.objects;

CREATE POLICY "users can upload own bill files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'electricity-bills'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

CREATE POLICY "users can read own bill files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'electricity-bills'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

CREATE POLICY "users can delete own bill files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'electricity-bills'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP INDEX IF EXISTS public.bills_session_id_idx;
CREATE INDEX IF NOT EXISTS bills_user_id_idx ON public.bills(user_id);

ALTER TABLE public.bills DROP COLUMN IF EXISTS session_id;
DROP FUNCTION IF EXISTS public.power_sense_session_id();
