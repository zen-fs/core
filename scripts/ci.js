import { Octokit } from '@octokit/action';

const octokit = new Octokit();

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
const head_sha = process.env.GITHUB_SHA;

let check_run_id;

/** Create a new GitHub check run */
export async function createCheck(name) {
	const response = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
		owner,
		repo,
		name,
		head_sha,
		status: 'in_progress',
		started_at: new Date().toISOString(),
	});

	check_run_id = response.data.id;
}

/** Complete a check run */
export async function completeCheck(conclusion, title = '', summary = '') {
	await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
		owner,
		repo,
		check_run_id,
		status: 'completed',
		completed_at: new Date().toISOString(),
		conclusion,
		output: { title, summary },
	});
}
