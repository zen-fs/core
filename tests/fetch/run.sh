#!/usr/bin/bash

# Credit: Dave Dopson, https://stackoverflow.com/a/246128/17637456
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )

tsx $SCRIPT_DIR/server.ts &
PID=$!

npx zenfs-test $SCRIPT_DIR/setup.ts --preserve-coverage $@

kill $PID
