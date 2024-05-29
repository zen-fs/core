#!/bin/bash

if [ ! -d dist ]; then
	>&2 echo -e '\e[1;31mError\e[0m: You must do \e[0;36mnpm run build\e[0m before running unit tests'
else
	cross-env NODE_OPTIONS=--experimental-vm-modules npx jest
fi