import { ScheduleAssignment, ScheduleResult, UnscheduledStudent } from '../types';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const ensureArray = <T>(value: unknown, errorCode: string): T[] => {
  if (!Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value as T[];
};

export const normalizeScheduleResult = (
  rawResult: unknown,
  expectedStudentCount: number
): ScheduleResult => {
  if (!isPlainObject(rawResult)) {
    throw new Error('SCHEDULE_MALFORMED_RESULT');
  }

  const assignments = ensureArray<ScheduleAssignment>(rawResult.assignments, 'SCHEDULE_MALFORMED_RESULT');
  const unscheduled = ensureArray<UnscheduledStudent>(rawResult.unscheduled, 'SCHEDULE_MALFORMED_RESULT');
  const totalHandledStudents = assignments.length + unscheduled.length;

  if (expectedStudentCount > 0 && totalHandledStudents === 0) {
    throw new Error('SCHEDULE_EMPTY_RESULT');
  }

  if (expectedStudentCount > 0 && totalHandledStudents !== expectedStudentCount) {
    throw new Error('SCHEDULE_INCOMPLETE_RESULT');
  }

  return {
    success: unscheduled.length === 0,
    assignments,
    unscheduled,
    softConstraintCost: typeof rawResult.softConstraintCost === 'number' ? rawResult.softConstraintCost : undefined,
  };
};