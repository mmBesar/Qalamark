# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 mmBesar
#
# Qalamark server + web app in one small image.
# Three stages: build the web app, build the server, then put both together.

# ---------- 1) the web app (HTML/JS/CSS) ----------
FROM node:24-slim AS web
WORKDIR /src
# The table engine is a local package the app depends on.
COPY packages/tables/package.json packages/tables/package-lock.json packages/tables/
COPY packages/tables/src packages/tables/src
COPY app/package.json app/package-lock.json app/
RUN cd app && npm ci --no-audit --no-fund
COPY app app
RUN cd app && npm run build

# ---------- 2) the server (Rust) ----------
FROM rust:1-slim-trixie AS server
WORKDIR /src
COPY server server
RUN cd server && cargo build --release --locked

# ---------- 3) the final image ----------
FROM debian:trixie-slim

# tzdata: the TZ variable works. util-linux: "setpriv" drops root (PUID/PGID).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tzdata util-linux \
 && rm -rf /var/lib/apt/lists/*

COPY --from=server /src/server/target/release/qalamark-server /usr/local/bin/qalamark-server
COPY --from=web /src/app/dist /app/web
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Settings (all can be changed with -e):
#   PUID / PGID  the user and group that own the files in /data
#   TZ           time zone, for example Africa/Cairo
#   QALAMARK_SIGNUP   "first" (only the first account is free; the admin adds others)
#                     or "open" (anyone can create an account)
ENV PUID=1000 \
    PGID=1000 \
    TZ=UTC \
    QALAMARK_DATA=/data \
    QALAMARK_WEB=/app/web \
    QALAMARK_ADDR=0.0.0.0:8080 \
    QALAMARK_SIGNUP=first

# Notes (.md files) and the small database live here.
# (Nothing is written here while building - the entrypoint prepares it.)
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["/usr/local/bin/qalamark-server", "--health"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/local/bin/qalamark-server"]
