import { Octokit } from '@octokit/action';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path/posix';
import { JSONFileMap } from 'utilium/fs.js';

const octokit = new Octokit();

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const head_sha = process.env.GITHUB_SHA;

mkdirSync(join(import.meta.dirname, '../tmp'), { recursive: true });

const runIDs = new JSONFileMap(join(import.meta.dirname, '../tmp/checks.json'));

/** Create a new GitHub check run */
export async function createCheck(name) {
	const response = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
		owner,
		repo,
		name,
		head_sha,
		status: 'queued',
		started_at: new Date().toISOString(),
	});

	runIDs.set(name, response.data.id);
}

/**
 * Move an existing check run from "queued" to "in_progress".
 */
export async function startCheck(name) {
	await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
		owner,
		repo,
		check_run_id: runIDs.get(name),
		status: 'in_progress',
		started_at: new Date().toISOString(),
	});
}

/** Complete a check run */
export async function completeCheck(name, conclusion, title = '', summary = '') {
	await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
		owner,
		repo,
		check_run_id: runIDs.get(name),
		status: 'completed',
		completed_at: new Date().toISOString(),
		conclusion,
		output: { title, summary },
	});
}
