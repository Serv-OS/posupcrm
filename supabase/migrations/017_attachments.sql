-- Migration 017: File attachments
-- A private storage bucket + a polymorphic attachments table so files can be
-- attached to tickets (and any other record type later).

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('attachments', 'attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Bucket access: any authenticated user can read/upload/delete in this bucket
DO $$ BEGIN
  CREATE POLICY attachments_read ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY attachments_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY attachments_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'attachments');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Metadata table
CREATE TABLE IF NOT EXISTS public.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL,           -- ticket | company | contact | deal | ...
  subject_id   uuid NOT NULL,
  activity_id  uuid REFERENCES public.crm_activities(id) ON DELETE SET NULL,
  file_name    text NOT NULL,
  file_path    text NOT NULL,           -- path within the attachments bucket
  mime_type    text,
  size_bytes   bigint,
  source       text NOT NULL DEFAULT 'upload',  -- upload | inbound_email
  uploaded_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_subject ON public.attachments(subject_type, subject_id, created_at DESC);

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY attachments_meta_read ON public.attachments FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY attachments_meta_write ON public.attachments FOR ALL TO authenticated
    USING (public.current_user_role() IN ('editor','owner'))
    WITH CHECK (public.current_user_role() IN ('editor','owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
