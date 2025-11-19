#!/bin/sh

# Exit on error
set -e

if [ "$1" = "keygen" ]; then
  shift
  exec node ace generate:key --show "$@"
  exit 0
fi

echo "Running database migrations..."
node ace migration:run --force

echo "Starting server..."
dumb-init -- node bin/server.js