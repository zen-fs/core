import { Octokit } from '@octokit/action';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path/posix';
import { JSONFileMap } from 'utilium/fs.js';

const octokit = new Octokit();

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const head_sha = process.env.GITHUB_SHA;

mkdirSync(join(import.meta.dirname, '../tmp'), { recursive: true });

const checks = new JSONFileMap(join(import.meta.dirname, '../tmp/checks.json'));

/** Maps test names and shortcuts to full check names */
export const checkNames = {
	// Basic ones
	format: 'Formatting',
	lint: 'Linting',
	build: 'Build',
	// Tests
	'Common tests': 'Unit tests (common)',
	memory: 'Unit tests (InMemory)',
	context: 'Unit tests (contexts)',
	index: 'Unit tests (Index)',
	port: 'Unit tests (Port)',
	'cow+fetch': 'Unit tests (Overlay, Fetch)',
};

/** Create a new GitHub check run */
export async function createCheck(id, name) {
	const response = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
		owner,
		repo,
		name,
		head_sha,
		status: 'queued',
		started_at: new Date().toISOString(),
	});

	checks.set(id, { id: response.data.id, completed: false });
}

/**
 * Move an existing check run from "queued" to "in_progress".
 */
export async function startCheck(id) {
	const check = checks.get(id);

	await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
		owner,
		repo,
		check_run_id: check.id,
		status: 'in_progress',
		started_at: new Date().toISOString(),
	});
}

/** Complete a check run */
export async function completeCheck(id, conclusion, title = '', summary = '') {
	const check = checks.get(id);
	if (check.completed) return;

	await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
		owner,
		repo,
		check_run_id: check.id,
		status: 'completed',
		completed_at: new Date().toISOString(),
		conclusion,
		output: { title, summary },
	});
	check.completed = true;
	checks.set(id, check);
}
