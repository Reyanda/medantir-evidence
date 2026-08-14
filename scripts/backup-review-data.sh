#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.production.yml}"
VOLUME="${REVIEW_DATA_VOLUME:-medantir-evidence_review_data}"
DESTINATION="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="medantir-review-data-${STAMP}.tgz"

mkdir -p "$DESTINATION"
docker compose -f "$COMPOSE_FILE" stop review
trap 'docker compose -f "$COMPOSE_FILE" start review >/dev/null 2>&1 || true' EXIT

docker run --rm \
  -v "${VOLUME}:/data:ro" \
  -v "$(cd "$DESTINATION" && pwd):/backup" \
  alpine:3.21 \
  sh -c "tar -czf /backup/${ARCHIVE} -C /data ."

sha256sum "$DESTINATION/$ARCHIVE" > "$DESTINATION/$ARCHIVE.sha256"
docker compose -f "$COMPOSE_FILE" start review
trap - EXIT
printf 'Created %s\n' "$DESTINATION/$ARCHIVE"
