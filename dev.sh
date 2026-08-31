#!/bin/bash

# Start all development servers for sitegeist and its dependencies
# Usage: ./dev.sh

set -e

echo "Starting development servers..."
echo ""

# Kill all child processes on exit
trap 'echo ""; echo "Stopping all dev servers..."; kill 0' EXIT INT TERM

# Start dev servers
echo "Starting sitegeist dev server..."
npm run dev &
SITEGEIST_PID=$!

echo "Starting sitegeist site dev server..."
(cd site && ./run.sh dev) &
SITE_PID=$!

echo ""
echo "All dev services started"
echo "  sitegeist: watching"
echo "  site backend: http://localhost:3000"
echo "  site frontend: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all background jobs
wait
