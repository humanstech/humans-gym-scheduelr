-- Based on Supabase self-hosted/v0.8.2; only roles used by this stack.
-- Initialization images enable statement logging: suppress it before setting passwords.
SET log_statement = 'none';
SET log_min_error_statement = 'panic';
\set pgpass `echo "$POSTGRES_PASSWORD"`
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_admin WITH PASSWORD :'pgpass';
