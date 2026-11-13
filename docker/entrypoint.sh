#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 mmBesar
#
# Starts Qalamark as the user PUID:PGID (so the .md files on your disk belong
# to you, not to root), then hands over to the server.

set -eu

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

# Make sure the data folder exists and belongs to the chosen user.
mkdir -p "${QALAMARK_DATA}/notes"
chown "${PUID}:${PGID}" "${QALAMARK_DATA}" "${QALAMARK_DATA}/notes"

# Running as root: switch to PUID:PGID. Already not root: just run.
if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid="${PUID}" --regid="${PGID}" --clear-groups "$@"
fi
exec "$@"
