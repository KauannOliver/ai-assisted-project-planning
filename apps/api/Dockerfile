FROM node:20-slim AS base

WORKDIR /app

# Install openssl for prisma query engine compatibilities
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package*.json ./

# Copy packages and apps configurations
COPY packages/database/package*.json ./packages/database/
COPY apps/api/package*.json ./apps/api/

# Install dependencies (workspaces resolved automatically)
RUN npm install

# Copy source codes
COPY packages/database ./packages/database
COPY apps/api ./apps/api

# Generate prisma client
WORKDIR /app/packages/database
RUN npx prisma generate

# Build NestJS api project
WORKDIR /app/apps/api
RUN npm run build

# Runner stage
FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=base /app /app
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy --schema packages/database/prisma/schema.prisma && npm run start:prod --workspace=apps/api"]
