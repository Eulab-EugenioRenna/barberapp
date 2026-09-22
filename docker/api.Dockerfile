FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install

FROM deps AS dev
RUN apk add --no-cache netcat-openbsd

FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build:api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl netcat-openbsd
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/api ./dist/apps/api
COPY --from=build /app/prisma ./prisma
COPY docker/api-entrypoint.sh ./docker/api-entrypoint.sh
RUN chmod +x ./docker/api-entrypoint.sh
EXPOSE 3000
CMD ["./docker/api-entrypoint.sh"]
