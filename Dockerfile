FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=4173

COPY package*.json ./
COPY vite.config.ts ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/local && chown -R node:node /app

USER node
EXPOSE 4173

CMD ["sh", "-c", "npm run preview -- --host ${HOST} --port ${PORT}"]
