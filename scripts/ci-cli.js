#!/usr/bin/env node
import { parseArgs } from 'node:util';
import * as ci from './ci.js';

const { values: options, positionals } = parseArgs({
	options: {
		create: { type: 'boolean', default: false },
		start: { type: 'boolean', default: false },
		complete: { type: 'string' },
		help: { short: 'h', type: 'boolean', default: false },
		exit: { short: 'e', type: 'boolean', default: false },
		run: { short: 'R', type: 'string' },
	},
	allowPositionals: true,
});

if (options.help) {
	console.log(`Usage: zenfs-ci [options] <check names...>

Options:
    -R, --run <command>  Run a command and use that for statuses. Implies --exit
    --create             Create check(s) in a queued state for all positional check names
    --start              Move check(s) from queued to in_progress
    --complete <status>  Complete the check(s) with a conclusion: success, failure, etc.
    -e, --exit           Set the exit code based on the status of --complete
    -h, --help           Show this help message`);
	process.exit();
}

for (const name of positionals) {
	if (options.create) await ci.createCheck(name);
	if (options.start) await ci.startCheck(name);
	if (options.complete) await ci.completeCheck(name, options.complete);
	if (options.complete && options.exit) process.exitCode = +(options.complete == 'failure');
	if (options.run) {
		await ci.startCheck(name);

		const result = spawnSync(options.run, { shell: true, stdio: 'inherit' });
		const exitCode = result.status;

		await ci.completeCheck(name, exitCode ? 'failure' : 'success');

		if (!exitCode) process.exitCode = exitCode;
	}
}
