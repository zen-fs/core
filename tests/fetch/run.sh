#!/usr/bin/env bash

# Credit: Dave Dopson, https://stackoverflow.com/a/246128/17637456
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

node $SCRIPT_DIR/server.js &
PID=$!

echo -n "Waiting for server to start..."
if [ -n "$VERBOSE" ]; then echo; fi
until nc -z localhost 26514; do
  sleep 0.25
done

npx zenfs-test $SCRIPT_DIR/fetch.ts --preserve --force "$@"

kill $PID
