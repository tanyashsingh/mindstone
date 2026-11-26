# Mindstone sync server (and the web app for phones).
# Build from the repository root after `npm run build:web`:
#   docker build -f server/Dockerfile -t mindstone-sync .
#   docker run -d -p 8787:8787 -v mindstone-sync-data:/data mindstone-sync
FROM node:24-alpine
WORKDIR /app
COPY server/sync-server.mjs ./
COPY dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
CMD ["node", "sync-server.mjs", "--port", "8787", "--data", "/data", "--static", "./dist"]
