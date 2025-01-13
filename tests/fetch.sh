#!/usr/bin/bash

tsx tests/fetch.ts &
PID=$!

npx zenfs-test tests/setup/cow+fetch.ts $@

kill $PID
