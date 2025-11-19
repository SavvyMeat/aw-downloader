ARG NODE_IMAGE=node:20-alpine

FROM $NODE_IMAGE AS base
RUN apk --no-cache add dumb-init
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node
RUN mkdir tmp storage

# ============================================
# Backend Stage
FROM base AS dependencies
COPY --chown=node:node ./backend/package*.json ./
RUN npm ci
COPY --chown=node:node ./backend/ ./

FROM dependencies AS build
RUN node ace build

# ============================================
# Frontend Stage
FROM $NODE_IMAGE AS dependencies_frontend
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node ./frontend/package*.json ./
RUN npm ci
COPY --chown=node:node ./frontend/ ./

FROM dependencies_frontend AS build_frontend
RUN npm run build

FROM base AS production
ENV NODE_ENV=production
ENV PORT=6547
ENV HOST=0.0.0.0
ENV LOG_LEVEL=info
ENV APP_KEY=X84YyWpm45JJgmvYsv2szdbDsBl45SSn
COPY --chown=node:node ./backend/package*.json ./
RUN npm ci --production
COPY --chown=node:node --from=build /app/build .
COPY --chown=node:node --from=build_frontend /app/build/ ./public/
COPY --chown=node:node entrypoint.sh .
RUN chmod +x entrypoint.sh
EXPOSE 6547
ENTRYPOINT ["/app/entrypoint.sh"]
