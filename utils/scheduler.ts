import { Student, RoomSlot, ScheduleResult, ProfPreference } from '../types';
import SchedulerWorker from './scheduler.worker?worker';

export type SolverMode = 'cp-sat' | 'legacy';

interface GenerateScheduleOptions {
  timeoutMs?: number;
  solverMode?: SolverMode;
}

interface SolverPayload {
  students: Student[];
  allRoomSlots: RoomSlot[];
  profAvailability: Record<string, string[]>;
  profPreferences: Record<string, ProfPreference>;
  timeoutMs?: number;
}

const toSafeAvailability = (profAvailability: Record<string, Set<string>>): Record<string, string[]> => {
  const safeAvailability: Record<string, string[]> = {};
  Object.entries(profAvailability).forEach(([professorId, slots]) => {
    safeAvailability[professorId] = Array.from(slots);
  });
  return safeAvailability;
};

const runLegacySolver = (payload: SolverPayload): Promise<ScheduleResult> => {
  return new Promise((resolve, reject) => {
    const worker = new SchedulerWorker();

    worker.onmessage = (event) => {
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data);
      }
      worker.terminate();
    };

    worker.onerror = (event) => {
      reject(new Error('Worker Error: ' + (event.message || 'Unknown')));
      worker.terminate();
    };

    worker.postMessage(payload);
  });
};

const runCpSatSolver = async (payload: SolverPayload): Promise<ScheduleResult> => {
  const response = await fetch('/api/solve-cp-sat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'CP-SAT 求解失敗');
  }

  return data as ScheduleResult;
};

export const generateSchedule = async (
  students: Student[],
  allRoomSlots: RoomSlot[],
  profAvailability: Record<string, Set<string>>,
  profPreferences?: Record<string, ProfPreference>,
  options?: GenerateScheduleOptions
): Promise<ScheduleResult> => {
  const payload: SolverPayload = {
    students,
    allRoomSlots,
    profAvailability: toSafeAvailability(profAvailability),
    profPreferences: profPreferences || {},
    timeoutMs: options?.timeoutMs,
  };

  if (options?.solverMode === 'legacy') {
    return runLegacySolver(payload);
  }

  try {
    return await runCpSatSolver(payload);
  } catch (error) {
    console.warn('CP-SAT solver unavailable, falling back to legacy worker.', error);
    return runLegacySolver(payload);
  }
};
