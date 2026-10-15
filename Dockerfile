FROM node:22.23.3-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG RELEASE_SHA=local
# Local-only quick login: set exclusively by deploy/local.yml; vite.config.ts rejects it off localhost.
ARG VITE_DEV_LOGIN
ARG VITE_DEV_LOGIN_PASSWORD
RUN npm run build && printf '{"sha":"%s"}\n' "$RELEASE_SHA" > dist/version.json

FROM caddy:2.10.2-alpine
COPY --from=build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
