import { LegacySolverPayload, solveLegacySchedule } from '../server/legacy_solver';

self.onmessage = async (event: MessageEvent<LegacySolverPayload>) => {
  try {
    const result = await solveLegacySchedule(event.data);
    self.postMessage(result);
  } catch (error: any) {
    self.postMessage({ error: error?.message || 'Unknown worker error' });
  }
};
