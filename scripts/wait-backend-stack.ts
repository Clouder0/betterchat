import { getIntegrationEnv, waitForBetterChat, waitForRocketChat } from '../packages/test-utils/src';

const env = getIntegrationEnv();

await waitForRocketChat(env.upstreamUrl);
await waitForBetterChat(env.backendUrl);

console.log(`Rocket.Chat ready at ${env.upstreamUrl}`);
console.log(`BetterChat backend ready at ${env.backendUrl}`);
