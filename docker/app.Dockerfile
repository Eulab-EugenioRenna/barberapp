# syntax=docker/dockerfile:1

# Shared by every build target. Source edits do not invalidate node_modules.
FROM node:22.23.4-alpine3.24 AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=barber-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund

FROM deps AS source
COPY tsconfig.base.json angular.json tailwind.config.js postcss.config.js ./
COPY libs ./libs
# Tailwind scans the workspace's apps in both host and container builds.
COPY apps ./apps

# Prisma generation is cached independently from API source changes.
FROM deps AS api-deps
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN npm run prisma:generate

FROM api-deps AS api-build
COPY tsconfig.base.json ./
COPY libs ./libs
COPY apps/api ./apps/api
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm run build:api -- --path apps/api/tsconfig.runtime.json && test -f dist/apps/api/main.js

# Development dependencies and sources exist only in these build stages.
FROM api-build AS api-production-deps
COPY docker/prepare-api-runtime.cjs ./docker/prepare-api-runtime.cjs
RUN node docker/prepare-api-runtime.cjs \
 && npm prune --omit=dev --ignore-scripts --no-audit --no-fund --offline \
 && node docker/prepare-api-runtime.cjs --verify
COPY --from=api-deps /app/node_modules/.prisma ./node_modules/.prisma
RUN node scripts/prune-runtime-deps.mjs /app/node_modules

FROM source AS admin-build
RUN npm run build:admin

FROM source AS booking-build
RUN npm run build:public

FROM alpine:3.24 AS api-runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libstdc++ openssl netcat-openbsd
COPY --from=deps /usr/local/bin/node /usr/local/bin/node
COPY --from=api-production-deps /app/node_modules ./node_modules
COPY --from=api-production-deps /app/package.json ./package.json
COPY --from=api-build /app/dist/apps/api ./dist/apps/api
COPY --from=api-production-deps /app/dist/scripts/create-demo-account.js ./dist/scripts/create-demo-account.js
COPY --from=api-build /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=api-build /app/prisma/migrations ./prisma/migrations
COPY --from=api-build /app/scripts/prisma-bootstrap.js ./scripts/prisma-bootstrap.js
COPY --chmod=755 docker/api-entrypoint.sh ./docker/api-entrypoint.sh
EXPOSE 3000
CMD ["./docker/api-entrypoint.sh"]

FROM nginx:1.27-alpine AS admin-runtime
RUN rm -f /usr/share/nginx/html/50x.html /usr/share/nginx/html/index.html
COPY docker/static.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /app/dist/apps/web-admin/browser /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.27-alpine AS booking-runtime
RUN rm -f /usr/share/nginx/html/50x.html /usr/share/nginx/html/index.html
COPY docker/static.conf /etc/nginx/conf.d/default.conf
COPY --from=booking-build /app/dist/apps/web-public-booking/browser /usr/share/nginx/html
EXPOSE 80

# Landing commerciale: file statici, nessuna build.
FROM nginx:1.27-alpine AS landing-runtime
RUN rm -f /usr/share/nginx/html/50x.html /usr/share/nginx/html/index.html
COPY docker/landing.conf /etc/nginx/conf.d/default.conf
COPY apps/landing/index.html apps/landing/styles.css apps/landing/main.js /usr/share/nginx/html/
COPY apps/landing/assets /usr/share/nginx/html/assets
EXPOSE 80
