import { runSwarm } from '../agents/swarm.js';
import { autoDeploy } from '../deploy/autoDeploy.js';

export async function runLoop(task) {
  let iteration = 0;

  while (iteration < 3) {
    const app = await runSwarm(task);
    const deployed = await autoDeploy(app);

    if (deployed.status === 'deployed') {
      break;
    }

    iteration += 1;
  }

  return {
    success: true,
  };
}

export default {
  runLoop,
};
