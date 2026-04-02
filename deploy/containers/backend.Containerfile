ARG NODE_IMAGE=docker.io/library/node:20-bookworm-slim
FROM ${NODE_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG DATABASE_URL=postgresql://user:password@localhost:5432/postgres?schema=public
ENV DATABASE_URL=${DATABASE_URL}

COPY packages/backend/package.json packages/backend/package-lock.json ./packages/backend/
RUN npm ci --prefix packages/backend

COPY packages/backend ./packages/backend
RUN npm run prisma:generate --prefix packages/backend \
 && npm run build --prefix packages/backend \
 && npm cache clean --force

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "packages/backend/dist/index.js"]
