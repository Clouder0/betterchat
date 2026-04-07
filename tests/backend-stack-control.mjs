import { spawnSync } from 'node:child_process';

const composeScriptUrl = new URL('../scripts/compose.sh', import.meta.url);
const composeFileUrl = new URL('./integration/podman-compose.yml', import.meta.url);

const restartErrorOutputFrom = (result) =>
	[result.stdout, result.stderr]
		.filter((value) => typeof value === 'string' && value.trim().length > 0)
		.join('\n')
		.trim();

export const betterChatBackendServiceName =
	process.env.BETTERCHAT_TEST_BACKEND_SERVICE_NAME ?? 'betterchat-backend';

export const restartBetterChatBackendService = () => {
	const result = spawnSync(
		'bash',
		[composeScriptUrl.pathname, '-f', composeFileUrl.pathname, 'restart', betterChatBackendServiceName],
		{ encoding: 'utf8' },
	);
	if (result.status !== 0) {
		const output = restartErrorOutputFrom(result);
		throw new Error(
			`Failed to restart BetterChat backend compose service ${betterChatBackendServiceName}: ${output || 'unknown error'}`,
		);
	}
};
