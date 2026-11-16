-- Appended after the pg_dump stream and run in the same transaction
-- (see copy-render-to-supabase.sh). Moves what the dump created in public
-- into first_five, with row level security on and no policies.
CREATE SCHEMA first_five;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','p') LOOP
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA first_five', r.relname);
    EXECUTE format('ALTER TABLE first_five.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE public.%I SET SCHEMA first_five', r.typname);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA first_five FROM anon, authenticated;
