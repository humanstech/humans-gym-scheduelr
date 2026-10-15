-- Isolated PostgreSQL only: minimal Supabase identity contract for fast CI tests.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  raw_user_meta_data jsonb DEFAULT '{}',
  last_sign_in_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (auth.jwt()->>'sub')::uuid;
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
