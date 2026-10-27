FROM node:20-slim AS base

WORKDIR /app

# Install openssl for prisma client generation during build
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package*.json ./

# Copy packages and apps configurations
COPY packages/database/package*.json ./packages/database/
COPY apps/web/package*.json ./apps/web/

# Install dependencies (workspaces resolved automatically)
RUN npm install

# Copy source codes
COPY packages/database ./packages/database
COPY apps/web ./apps/web

# Generate prisma client
WORKDIR /app/packages/database
RUN npx prisma generate

# Build Next.js web application. Browser calls use /backend-api and the Next.js
# server forwards them through Docker's internal network.
WORKDIR /app/apps/web
ARG INTERNAL_API_URL=http://api:4000
ENV INTERNAL_API_URL=$INTERNAL_API_URL
RUN npm run build

# Runner stage
FROM node:20-slim AS runner
WORKDIR /app
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=base /app /app
EXPOSE 3100
CMD ["npm", "run", "start", "--workspace=apps/web"]
