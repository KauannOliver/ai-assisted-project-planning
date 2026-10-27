FROM node:20-slim AS base

WORKDIR /app

# Copy root package files
COPY package*.json ./

# Copy packages and apps configurations
COPY packages/database/package*.json ./packages/database/
COPY apps/worker/package*.json ./apps/worker/

# Install dependencies (workspaces resolved automatically)
RUN npm install

# Copy source codes
COPY packages/database ./packages/database
COPY apps/worker ./apps/worker

# Build worker
WORKDIR /app/apps/worker
RUN npm run build

# Runner stage
FROM node:20-slim AS runner
WORKDIR /app
COPY --from=base /app /app
CMD ["npm", "run", "start", "--workspace=apps/worker"]
