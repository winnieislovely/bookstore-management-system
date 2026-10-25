# Application images (TDD §12.2). `app` runs api, worker and migrate; `caddy` serves the staff app.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @bookstore/staff build

FROM node:24-slim AS app
ENV NODE_ENV=production TZ=Asia/Ho_Chi_Minh
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN rm -rf apps/staff/node_modules apps/staff/src
USER node
# Overridden per service in docker-compose.yml.
WORKDIR /app/apps/api
CMD ["node", "--import", "tsx", "src/main.ts"]

FROM caddy:2 AS caddy
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/staff/dist /srv/staff
