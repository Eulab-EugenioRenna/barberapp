FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
COPY vendor ./vendor
RUN npm ci --no-audit --no-fund

COPY . .

EXPOSE 4201
CMD ["npm", "run", "serve:public"]
