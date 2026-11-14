#!/bin/sh
# Apply migrations, then start the server (web or worker: JOBS_ENABLED picks
# whether instrumentation.ts starts pg-boss). migrate deploy is idempotent and
# takes an advisory lock, so both Deployments can run it; a failure stops the
# container before it serves traffic.
set -eu

node node_modules/prisma/build/index.js migrate deploy

exec node server.js
