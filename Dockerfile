FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=4173

COPY package*.json ./
COPY shared ./shared
COPY server ./server
COPY src ./src
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data/local && chown -R node:node /app

USER node
EXPOSE 4173

CMD ["sh", "-c", "node server/index.ts"]
