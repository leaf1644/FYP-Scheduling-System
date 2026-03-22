import { Student, RoomSlot, ScheduleResult, ProfPreference } from '../types';
import SchedulerWorker from './scheduler.worker?worker';
import { normalizeScheduleResult } from './scheduleResult';

export type SolverMode = 'cp-sat' | 'pulp-ilp' | 'legacy-python';

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
    // Workers and HTTP payloads need plain arrays instead of Set objects.
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
        try {
          // Normalize worker output so malformed results surface as errors instead of blank dashboards.
          resolve(normalizeScheduleResult(event.data, payload.students.length));
        } catch (error) {
          reject(error);
        }
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

  return normalizeScheduleResult(data, payload.students.length);
};

const runPulpSolver = async (payload: SolverPayload): Promise<ScheduleResult> => {
  const response = await fetch('/api/solve-pulp-ilp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'PuLP ILP 求解失敗');
  }

  return normalizeScheduleResult(data, payload.students.length);
};

const runLegacyPythonSolver = async (payload: SolverPayload): Promise<ScheduleResult> => {
  const response = await fetch('/api/solve-legacy-python', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Legacy Python 求解失敗');
  }

  return normalizeScheduleResult(data, payload.students.length);
};

export const generateSchedule = async (
  students: Student[],
  allRoomSlots: RoomSlot[],
  profAvailability: Record<string, Set<string>>,
  profPreferences?: Record<string, ProfPreference>,
  options?: GenerateScheduleOptions
): Promise<ScheduleResult> => {
  // Every solver receives the same normalized payload shape so the UI can swap modes safely.
  const payload: SolverPayload = {
    students,
    allRoomSlots,
    profAvailability: toSafeAvailability(profAvailability),
    profPreferences: profPreferences || {},
    timeoutMs: options?.timeoutMs,
  };

  switch (options?.solverMode) {
    case 'legacy-python':
      return runLegacyPythonSolver(payload);
    case 'pulp-ilp':
      return runPulpSolver(payload);
    case 'cp-sat':
    default:
      try {
        return await runCpSatSolver(payload);
      } catch (error) {
        // When the Python API is unavailable, fall back to the in-browser worker to keep the app usable.
        console.warn('Selected Python solver unavailable, falling back to legacy worker.', error);
        try {
          return await runLegacySolver(payload);
        } catch (workerError) {
          const primaryMessage = error instanceof Error ? error.message : 'CP-SAT 求解失敗';
          const fallbackMessage = workerError instanceof Error ? workerError.message : 'Unknown worker error';
          throw new Error(`${primaryMessage}; legacy fallback failed: ${fallbackMessage}`);
        }
      }
  }
};
