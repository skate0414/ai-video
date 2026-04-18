# ---- Stage 1: Build frontend ----
FROM node:20-slim AS ui-build
WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json* ./
RUN npm ci
COPY ui/ ./
COPY shared/ /app/shared/
RUN npm run build

# ---- Stage 2: Runtime ----
FROM node:20-slim
WORKDIR /app

# Install FFmpeg + Chromium for pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Copy backend
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY shared/ ./shared/
COPY tsconfig.json ./

# Copy built frontend (serve as static if needed)
COPY --from=ui-build /app/ui/dist ./ui/dist

# Copy static data
COPY data/ ./data/

# Create data directory and set ownership
RUN mkdir -p /data && chown -R node:node /app /data

# Run as non-root user
USER node

VOLUME ["/data"]

EXPOSE 3220

ENV NODE_ENV=production
ENV PORT=3220

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3220/health').then(r=>{if(!r.ok)throw r.status}).catch(()=>process.exit(1))"

CMD ["node", "--import", "tsx", "src/server.ts"]
