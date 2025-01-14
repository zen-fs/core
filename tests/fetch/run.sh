#!/usr/bin/bash

# Credit: Dave Dopson, https://stackoverflow.com/a/246128/17637456
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

npx tsx $SCRIPT_DIR/server.ts &
PID=$!

echo "Waiting for server to start..."
until nc -z localhost 26514; do
  sleep 0.5
done

npx zenfs-test $SCRIPT_DIR/setup.ts --preserve --force $@

kill $PID
