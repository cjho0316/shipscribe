# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript -> dist/ ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage: production deps + compiled JS only ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ShipScribe shells out to `git` to read commits/diffs, so git must be present.
RUN apk add --no-cache git && git config --global --add safe.directory /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY web ./web
# Ship the repo's own history so the deployed demo can describe itself live.
COPY .git ./.git

# Node 20 here satisfies @azure/identity (keyless Entra ID) at runtime.
ENV PORT=5173
ENV SHIPSCRIBE_REPO=/app
EXPOSE 5173

# In Azure, DefaultAzureCredential uses the container's managed identity (keyless).
CMD ["node", "dist/server.js"]
