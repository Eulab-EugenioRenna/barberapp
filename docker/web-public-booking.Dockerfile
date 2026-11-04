FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY vendor/eulab-connect-0.11.0-team-security.tgz ./vendor/eulab-connect-0.11.0-team-security.tgz
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 4201
CMD ["npm", "run", "serve:public"]
