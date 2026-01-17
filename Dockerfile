# Build dist
# Extremely slow on multi-arch builds
FROM denoland/deno:debian-2.4.4 AS builder
WORKDIR /app

RUN mkdir -p /app/data && chown -R deno:deno /app/data
RUN mkdir -p /app/dist && chown -R deno:deno /app/dist

USER deno
COPY --chown=deno:deno ./frontend /app/frontend
COPY --chown=deno:deno ./backend/common.ts /app/backend/common.ts
WORKDIR /app/frontend
RUN deno install && \
    deno task build

# Main image
FROM denoland/deno:debian-2.4.4 AS release
WORKDIR /app

EXPOSE 47777

RUN mkdir -p /app/data && chown -R deno:deno /app/data

RUN apt update && \
    apt --yes --no-install-recommends install gosu && \
    rm -rf /var/lib/apt/lists/*

USER deno

COPY --chown=deno:deno ./extra /app/extra
COPY --chown=deno:deno ./backend /app/backend
COPY --chown=deno:deno ./deno.jsonc /app/deno.jsonc

# Extremely slow on multi-arch builds, copy from host instead
#COPY --chown=deno:deno --from=builder /app/dist /app/dist
COPY --chown=deno:deno ./dist /app/dist

# Install and cache dependencies
RUN deno install && \
    deno cache ./backend/main.ts && \
    timeout 10s deno -A main.ts || exit 0

# Switch back to root, I found that it will cause permission issues if the user does not set permissions correctly
# Use PUID / PGID to switch back to `deno` user instead
USER root

RUN chmod +x /app/extra/docker-entrypoint.sh

ENTRYPOINT ["/app/extra/docker-entrypoint.sh"]
CMD ["deno", "task", "start"]
