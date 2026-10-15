# Supabase runtime

Minimal self-hosted stack: PostgreSQL, Auth, PostgREST, Realtime and Kong.
Storage, Edge Functions, Studio, analytics and Supavisor are not used by this application.
Only Caddy publishes ports; API paths are explicitly allowlisted.

Initialization SQL derives from the Apache-2.0-licensed Supabase repository,
self-hosted/v0.8.2, commit `564eab8ad7840b13324f68b1bfac074ef8d51c21`:
https://github.com/supabase/supabase/tree/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker

`roles.sql` is adapted to the roles actually used, and disables statement logging
before changing passwords. `realtime.sql` and `jwt.sql` retain upstream behavior.
Runtime images are independently pinned in `compose.yml`. Treat changes to image
versions as a separate, tested infrastructure upgrade; do not automatically pull
floating tags. Test startup, Auth, Realtime and backup restore together.

Supabase license: https://github.com/supabase/supabase/blob/564eab8ad7840b13324f68b1bfac074ef8d51c21/LICENSE
