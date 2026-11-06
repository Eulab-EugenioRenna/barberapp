# syntax=docker/dockerfile:1

# Shared by every build target. Source edits do not invalidate node_modules.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=barber-npm,target=/root/.npm,sharing=locked npm ci --no-audit --no-fund

FROM deps AS source
COPY tsconfig.base.json angular.json tailwind.config.js postcss.config.js ./
COPY libs ./libs

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
RUN npm run build:api

FROM source AS admin-build
COPY apps/web-admin ./apps/web-admin
RUN npm run build:admin

FROM source AS booking-build
COPY apps/web-public-booking ./apps/web-public-booking
RUN npm run build:public

FROM node:22-alpine AS api-runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl netcat-openbsd
COPY --from=api-deps /app/node_modules ./node_modules
COPY --from=api-build /app/package.json /app/package-lock.json ./
COPY --from=api-build /app/dist/apps/api ./dist/apps/api
COPY --from=api-build /app/prisma ./prisma
COPY --from=api-build /app/scripts/prisma-bootstrap.js ./scripts/prisma-bootstrap.js
COPY --from=api-build /app/scripts/create-demo-account.ts ./scripts/create-demo-account.ts
COPY --chmod=755 docker/api-entrypoint.sh ./docker/api-entrypoint.sh
EXPOSE 3000
CMD ["./docker/api-entrypoint.sh"]

FROM nginx:1.27-alpine AS admin-runtime
COPY docker/static.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /app/dist/apps/web-admin/browser /usr/share/nginx/html
EXPOSE 80

FROM nginx:1.27-alpine AS booking-runtime
COPY docker/static.conf /etc/nginx/conf.d/default.conf
COPY --from=booking-build /app/dist/apps/web-public-booking/browser /usr/share/nginx/html
EXPOSE 80
