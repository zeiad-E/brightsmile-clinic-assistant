# Backend API + LLM engine in one container (fits a single free web service).
# The engine listens only on 127.0.0.1 inside the container; the backend is the
# only public surface. Build context: repository root.
FROM ghcr.io/tashfeenahmed/freellmapi:v0.16.7

# Public port for the backend (Render injects PORT; 10000 is its default).
ENV PORT=10000 \
    NODE_ENV=production

WORKDIR /srv/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend/src ./src

COPY infra/render/start.sh /usr/local/bin/start.sh
RUN chmod 755 /usr/local/bin/start.sh && chown -R node:node /srv/backend

WORKDIR /app
EXPOSE 10000

# The base image's entrypoint drops privileges to the `node` user, then runs this.
CMD ["/usr/local/bin/start.sh"]
