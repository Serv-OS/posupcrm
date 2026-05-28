-- v0.3: features table, item images, project default item type
-- Safe to re-run (idempotent via IF NOT EXISTS / DO blocks).

-- ── 1. features table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.features (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#E8743C',
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_features_project ON public.features(project_id, name);

ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY features_read ON public.features FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY features_write ON public.features FOR ALL TO authenticated
    USING (public.current_user_role() IN ('editor','owner'))
    WITH CHECK (public.current_user_role() IN ('editor','owner'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. items.feature_id foreign key ─────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.items ADD COLUMN feature_id uuid REFERENCES public.features(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_items_feature ON public.items(feature_id);

-- ── 3. items.images (array of URLs from Supabase storage) ──────────────
DO $$ BEGIN
  ALTER TABLE public.items ADD COLUMN images text[] DEFAULT '{}';
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 4. projects.default_item_type ───────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE public.projects ADD COLUMN default_item_type text NOT NULL DEFAULT 'task'
    CHECK (default_item_type IN ('feature','bug','task','chore'));
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 5. Realtime for features ────────────────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.features;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 6. Storage bucket for item images ───────────────────────────────────
-- NOTE: Run this in the Supabase dashboard SQL editor or via the Storage API:
--   1. Create a public bucket named "item-images"
--   2. Set the bucket to public (or add an RLS policy for authenticated reads)
--   3. Add a storage policy allowing authenticated users to upload to items/*

-- ── 7. Verify ───────────────────────────────────────────────────────────
SELECT 'features table' AS check, EXISTS (
  SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='features'
) AS ok
UNION ALL SELECT 'items.feature_id column',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='feature_id')
UNION ALL SELECT 'items.images column',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='items' AND column_name='images')
UNION ALL SELECT 'projects.default_item_type column',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='default_item_type');
