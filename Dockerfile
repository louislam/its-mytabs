# Build dist
FROM denoland/deno:debian-2.4.4 AS builder
WORKDIR /app

RUN mkdir -p /app/dist && chown -R deno:deno /app/dist
USER deno
COPY --chown=deno:deno ./frontend /app/frontend
COPY --chown=deno:deno ./backend/common.ts /app/backend/common.ts
WORKDIR /app/frontend
RUN deno install && \
    deno task build

FROM denoland/deno:debian-2.4.4
WORKDIR /app

RUN mkdir -p /app/data && chown -R deno:deno /app/data

USER deno
COPY --chown=deno:deno ./backend /app/backend
COPY --chown=deno:deno --from=builder /app/dist /app/dist
COPY --chown=deno:deno ./extra /app/extra
COPY --chown=deno:deno ./deno.jsonc /app/deno.jsonc
RUN deno install

CMD ["task", "start"]
