import { Student, RoomSlot, ScheduleResult, ScheduleAssignment } from '../types';

export interface ProfPreference {
  type: 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD';
  target?: number;
  weight: number;
}

interface WorkerMessage {
  students: Student[];
  allRoomSlots: RoomSlot[];
  profAvailability: Record<string, string[]>;
  profPreferences?: Record<string, ProfPreference>;
  timeoutMs?: number;
}

interface Assignment {
  studentIndex: number;
  roomSlot: RoomSlot;
}

interface StudentDomain {
  studentIndex: number;
  student: Student;
  validRoomSlots: RoomSlot[];
}

interface SchedulerContext {
  students: StudentDomain[];
  assignments: (Assignment | null)[];
  conflictGraph: number[][];
  slotDemand: Record<string, number>;
  startTime: number;
  profPreferences: Record<string, ProfPreference>;
  timeoutMs: number;
}

interface BeamState {
  assignments: (Assignment | null)[];
  scheduledCount: number;
  unscheduledIndices: number[];
}

type UnscheduledReason = 'NO_COMMON_TIME' | 'NO_ROOM_AVAILABLE' | 'PROF_BUSY' | 'UNKNOWN';

function getStaticDomain(
  student: Student,
  allRoomSlots: RoomSlot[],
  profAvailability: Record<string, string[]>
): RoomSlot[] {
  const supSlots = new Set(profAvailability[student.supervisorId] || []);
  const obsSlots = new Set(profAvailability[student.observerId] || []);
  return allRoomSlots.filter((roomSlot) => supSlots.has(roomSlot.slotId) && obsSlots.has(roomSlot.slotId));
}

function getDateFromSlot(slot: RoomSlot): string {
  const normalized = slot.timeLabel.replace(/[–—]/g, '-').trim();
  const rangeMatch = normalized.match(
    /^(.*?)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)$/i
  );
  if (rangeMatch?.[1]?.trim()) return rangeMatch[1].trim();

  const dayMatch = normalized.match(/Day\s+\d+/i);
  if (dayMatch) return dayMatch[0];

  return normalized;
}

function calculateCost(
  assignments: (Assignment | null)[],
  students: StudentDomain[],
  profPreferences: Record<string, ProfPreference>
): number {
  let totalCost = 0;
  const profStats: Record<string, { days: Set<string>; dailyLoad: Record<string, number> }> = {};

  assignments.forEach((assignment) => {
    if (!assignment) return;

    const student = students[assignment.studentIndex].student;
    const day = getDateFromSlot(assignment.roomSlot);

    [student.supervisorId, student.observerId].forEach((professorId) => {
      if (!profStats[professorId]) {
        profStats[professorId] = { days: new Set(), dailyLoad: {} };
      }

      profStats[professorId].days.add(day);
      profStats[professorId].dailyLoad[day] = (profStats[professorId].dailyLoad[day] || 0) + 1;
    });
  });

  Object.entries(profStats).forEach(([professorId, stats]) => {
    const pref = profPreferences[professorId] || { type: 'CONCENTRATE', weight: 10 };

    if (pref.type === 'CONCENTRATE') {
      if (stats.days.size > 1) {
        totalCost += (stats.days.size - 1) * pref.weight;
      }
      return;
    }

    if (pref.type === 'MAX_PER_DAY') {
      const limit = pref.target || 3;
      Object.values(stats.dailyLoad).forEach((load) => {
        if (load > limit) totalCost += (load - limit) * pref.weight;
      });
      return;
    }

    const totalLoad = Object.values(stats.dailyLoad).reduce((sum, load) => sum + load, 0);
    const idealDays = Math.ceil(totalLoad / 2);
    if (stats.days.size < idealDays) {
      totalCost += (idealDays - stats.days.size) * pref.weight;
    }
  });

  return totalCost;
}

function hasTimedOut(ctx: SchedulerContext): boolean {
  return Date.now() - ctx.startTime > ctx.timeoutMs;
}

function cloneAssignments(assignments: (Assignment | null)[]): (Assignment | null)[] {
  return assignments.map((assignment) => (assignment ? { ...assignment } : null));
}

function getBlockingStudentIndicesForAssignments(
  ctx: SchedulerContext,
  assignments: (Assignment | null)[],
  studentIndex: number,
  candidate: RoomSlot
): number[] {
  const blockers = new Set<number>();
  const student = ctx.students[studentIndex].student;

  assignments.forEach((assignment, assignedIndex) => {
    if (!assignment || assignedIndex === studentIndex) return;

    const otherStudent = ctx.students[assignment.studentIndex].student;

    if (assignment.roomSlot.roomId === candidate.roomId && assignment.roomSlot.slotId === candidate.slotId) {
      blockers.add(assignedIndex);
    }

    if (assignment.roomSlot.slotId !== candidate.slotId) return;

    if (
      student.supervisorId === otherStudent.supervisorId ||
      student.supervisorId === otherStudent.observerId ||
      student.observerId === otherStudent.supervisorId ||
      student.observerId === otherStudent.observerId
    ) {
      blockers.add(assignedIndex);
    }
  });

  return Array.from(blockers);
}

function getBlockingStudentIndices(
  ctx: SchedulerContext,
  studentIndex: number,
  candidate: RoomSlot
): number[] {
  return getBlockingStudentIndicesForAssignments(ctx, ctx.assignments, studentIndex, candidate);
}

function isValidMove(ctx: SchedulerContext, studentIndex: number, candidate: RoomSlot): boolean {
  return getBlockingStudentIndices(ctx, studentIndex, candidate).length === 0;
}

function isValidMoveForAssignments(
  ctx: SchedulerContext,
  assignments: (Assignment | null)[],
  studentIndex: number,
  candidate: RoomSlot
): boolean {
  return getBlockingStudentIndicesForAssignments(ctx, assignments, studentIndex, candidate).length === 0;
}

function compareCandidateSlots(
  ctx: SchedulerContext,
  assignments: (Assignment | null)[],
  studentIndex: number,
  left: RoomSlot,
  right: RoomSlot,
  randomize = false
): number {
  const leftBlockers = getBlockingStudentIndicesForAssignments(ctx, assignments, studentIndex, left).length;
  const rightBlockers = getBlockingStudentIndicesForAssignments(ctx, assignments, studentIndex, right).length;
  if (leftBlockers !== rightBlockers) return leftBlockers - rightBlockers;

  const leftDemand = ctx.slotDemand[left.slotId] || 0;
  const rightDemand = ctx.slotDemand[right.slotId] || 0;
  if (leftDemand !== rightDemand) return leftDemand - rightDemand;

  if (randomize) return Math.random() - 0.5;
  return left.timeLabel.localeCompare(right.timeLabel) || left.roomName.localeCompare(right.roomName);
}

function forwardCheck(ctx: SchedulerContext, currentStudentIndex: number, candidate: RoomSlot): boolean {
  const neighbors = ctx.conflictGraph[currentStudentIndex];
  const currentStudent = ctx.students[currentStudentIndex].student;

  for (const neighborIdx of neighbors) {
    if (ctx.assignments[neighborIdx] !== null) continue;

    const neighbor = ctx.students[neighborIdx];
    const hasViableOption = neighbor.validRoomSlots.some((option) => {
      if (option.roomId === candidate.roomId && option.slotId === candidate.slotId) return false;
      if (
        option.slotId === candidate.slotId &&
        (
          neighbor.student.supervisorId === currentStudent.supervisorId ||
          neighbor.student.supervisorId === currentStudent.observerId ||
          neighbor.student.observerId === currentStudent.supervisorId ||
          neighbor.student.observerId === currentStudent.observerId
        )
      ) {
        return false;
      }
      return isValidMoveForAssignments(ctx, ctx.assignments, neighborIdx, option);
    });

    if (!hasViableOption) return false;
  }

  return true;
}

async function solveStrict(ctx: SchedulerContext, studentOrder: number[], depth: number): Promise<boolean> {
  if (depth % 40 === 0 && hasTimedOut(ctx)) {
    throw new Error('TIMEOUT');
  }

  if (depth === studentOrder.length) return true;

  const currentIdx = studentOrder[depth];
  const domain = ctx.students[currentIdx];
  const orderedSlots = [...domain.validRoomSlots].sort((left, right) =>
    compareCandidateSlots(ctx, ctx.assignments, currentIdx, left, right)
  );

  for (const slot of orderedSlots) {
    if (!isValidMove(ctx, currentIdx, slot)) continue;
    if (!forwardCheck(ctx, currentIdx, slot)) continue;

    ctx.assignments[currentIdx] = { studentIndex: currentIdx, roomSlot: slot };
    const success = await solveStrict(ctx, studentOrder, depth + 1);
    if (success) return true;
    ctx.assignments[currentIdx] = null;
  }

  return false;
}

function solveGreedyPass(ctx: SchedulerContext, studentOrder: number[], randomize: boolean): number[] {
  ctx.assignments = new Array(ctx.students.length).fill(null);
  const unscheduledIndices: number[] = [];

  for (const idx of studentOrder) {
    const domain = ctx.students[idx];
    const sortedSlots = [...domain.validRoomSlots].sort((left, right) =>
      compareCandidateSlots(ctx, ctx.assignments, idx, left, right, randomize)
    );

    const chosen = sortedSlots.find((slot) => isValidMove(ctx, idx, slot));
    if (chosen) {
      ctx.assignments[idx] = { studentIndex: idx, roomSlot: chosen };
    } else {
      unscheduledIndices.push(idx);
    }
  }

  return unscheduledIndices;
}

function perturbStudentOrder(ctx: SchedulerContext, baseOrder: number[]): number[] {
  const shuffled = [...baseOrder];

  for (let i = shuffled.length - 1; i > 0; i--) {
    if (Math.random() > 0.35) continue;
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  shuffled.sort((left, right) => {
    const leftDomain = ctx.students[left].validRoomSlots.length;
    const rightDomain = ctx.students[right].validRoomSlots.length;
    if (leftDomain !== rightDomain) return leftDomain - rightDomain;
    return (ctx.conflictGraph[right].length - ctx.conflictGraph[left].length) + (Math.random() - 0.5) * 2;
  });

  return shuffled;
}

function scoreBeamState(ctx: SchedulerContext, state: BeamState): number {
  const scarceSlotPenalty = state.assignments.reduce((sum, assignment) => {
    if (!assignment) return sum;
    return sum + (ctx.slotDemand[assignment.roomSlot.slotId] || 0);
  }, 0);

  return state.scheduledCount * 100000 - state.unscheduledIndices.length * 1000 - scarceSlotPenalty;
}

function solveBeamSearch(ctx: SchedulerContext, studentOrder: number[]): number[] {
  const beamWidth = studentOrder.length > 140 ? 18 : 24;
  const maxCandidatesPerStudent = 5;
  let beam: BeamState[] = [{
    assignments: new Array(ctx.students.length).fill(null),
    scheduledCount: 0,
    unscheduledIndices: [],
  }];

  let processed = 0;
  for (; processed < studentOrder.length; processed++) {
    if (hasTimedOut(ctx)) break;

    const studentIndex = studentOrder[processed];
    const nextBeam: BeamState[] = [];

    beam.forEach((state) => {
      const candidates = [...ctx.students[studentIndex].validRoomSlots]
        .filter((slot) => isValidMoveForAssignments(ctx, state.assignments, studentIndex, slot))
        .sort((left, right) => compareCandidateSlots(ctx, state.assignments, studentIndex, left, right))
        .slice(0, maxCandidatesPerStudent);

      candidates.forEach((slot) => {
        const assignments = cloneAssignments(state.assignments);
        assignments[studentIndex] = { studentIndex, roomSlot: slot };
        nextBeam.push({
          assignments,
          scheduledCount: state.scheduledCount + 1,
          unscheduledIndices: [...state.unscheduledIndices],
        });
      });

      nextBeam.push({
        assignments: cloneAssignments(state.assignments),
        scheduledCount: state.scheduledCount,
        unscheduledIndices: [...state.unscheduledIndices, studentIndex],
      });
    });

    nextBeam.sort((left, right) => scoreBeamState(ctx, right) - scoreBeamState(ctx, left));
    beam = nextBeam.slice(0, beamWidth);
  }

  const bestState = [...beam].sort((left, right) => scoreBeamState(ctx, right) - scoreBeamState(ctx, left))[0];
  ctx.assignments = cloneAssignments(bestState.assignments);

  const unscheduled = [...bestState.unscheduledIndices];
  for (let i = processed; i < studentOrder.length; i++) {
    const studentIndex = studentOrder[i];
    const candidates = [...ctx.students[studentIndex].validRoomSlots].sort((left, right) =>
      compareCandidateSlots(ctx, ctx.assignments, studentIndex, left, right)
    );
    const chosen = candidates.find((slot) => isValidMove(ctx, studentIndex, slot));
    if (chosen) {
      ctx.assignments[studentIndex] = { studentIndex, roomSlot: chosen };
    } else {
      unscheduled.push(studentIndex);
    }
  }

  return unscheduled;
}

function tryRepairPlacement(
  ctx: SchedulerContext,
  studentIndex: number,
  depthRemaining: number,
  visitingStudents: Set<number>,
  reservedSlotIds: Set<string>
): boolean {
  if (hasTimedOut(ctx) || depthRemaining < 0 || visitingStudents.has(studentIndex)) return false;

  visitingStudents.add(studentIndex);
  const currentAssignment = ctx.assignments[studentIndex];
  const candidates = [...ctx.students[studentIndex].validRoomSlots]
    .filter((slot) => !reservedSlotIds.has(slot.id))
    .sort((left, right) => compareCandidateSlots(ctx, ctx.assignments, studentIndex, left, right));

  for (const candidate of candidates) {
    if (currentAssignment?.roomSlot.id === candidate.id) {
      visitingStudents.delete(studentIndex);
      return true;
    }

    const blockers = getBlockingStudentIndices(ctx, studentIndex, candidate);
    if (blockers.length > 0 && depthRemaining === 0) continue;

    const snapshot = cloneAssignments(ctx.assignments);
    ctx.assignments[studentIndex] = null;
    blockers.forEach((blockerIndex) => {
      ctx.assignments[blockerIndex] = null;
    });

    const nextReserved = new Set(reservedSlotIds);
    nextReserved.add(candidate.id);
    const orderedBlockers = [...blockers].sort(
      (left, right) => ctx.students[left].validRoomSlots.length - ctx.students[right].validRoomSlots.length
    );

    let repaired = true;
    for (const blockerIndex of orderedBlockers) {
      if (!tryRepairPlacement(ctx, blockerIndex, depthRemaining - 1, visitingStudents, new Set(nextReserved))) {
        repaired = false;
        break;
      }
    }

    if (repaired && isValidMove(ctx, studentIndex, candidate)) {
      ctx.assignments[studentIndex] = { studentIndex, roomSlot: candidate };
      visitingStudents.delete(studentIndex);
      return true;
    }

    ctx.assignments = snapshot;
  }

  visitingStudents.delete(studentIndex);
  return false;
}

function repairSchedule(ctx: SchedulerContext, unscheduledIndices: number[]): number[] {
  let remaining = [...unscheduledIndices];
  let madeProgress = true;

  while (madeProgress && remaining.length > 0 && !hasTimedOut(ctx)) {
    madeProgress = false;

    const orderedUnscheduled = [...remaining].sort((left, right) => {
      const leftDomain = ctx.students[left].validRoomSlots.length;
      const rightDomain = ctx.students[right].validRoomSlots.length;
      if (leftDomain !== rightDomain) return leftDomain - rightDomain;
      return ctx.conflictGraph[right].length - ctx.conflictGraph[left].length;
    });

    for (const studentIndex of orderedUnscheduled) {
      const domainSize = ctx.students[studentIndex].validRoomSlots.length;
      if (domainSize === 0) continue;

      const depthLimit = domainSize <= 4 ? 4 : domainSize <= 12 ? 3 : 2;
      const repaired = tryRepairPlacement(ctx, studentIndex, depthLimit, new Set<number>(), new Set<string>());
      if (!repaired) continue;

      remaining = remaining.filter((idx) => idx !== studentIndex);
      madeProgress = true;
    }
  }

  return remaining;
}

function isBetterSolution(
  ctx: SchedulerContext,
  candidateUnscheduled: number[],
  bestUnscheduled: number[],
  candidateAssignments: (Assignment | null)[],
  bestAssignments: (Assignment | null)[]
): boolean {
  if (candidateUnscheduled.length !== bestUnscheduled.length) {
    return candidateUnscheduled.length < bestUnscheduled.length;
  }

  if (Object.keys(ctx.profPreferences).length > 0) {
    const candidateCost = calculateCost(candidateAssignments, ctx.students, ctx.profPreferences);
    const bestCost = calculateCost(bestAssignments, ctx.students, ctx.profPreferences);
    if (candidateCost !== bestCost) return candidateCost < bestCost;
  }

  return false;
}

function solveMultiStart(ctx: SchedulerContext, baseOrder: number[]): number[] {
  let bestAssignments = cloneAssignments(ctx.assignments);
  let bestUnscheduled = solveGreedyPass(ctx, baseOrder, false);
  bestUnscheduled = repairSchedule(ctx, bestUnscheduled);
  bestAssignments = cloneAssignments(ctx.assignments);

  let iteration = 0;
  const maxIterations = 200;

  while (!hasTimedOut(ctx) && iteration < maxIterations && bestUnscheduled.length > 0) {
    const trialOrder = perturbStudentOrder(ctx, baseOrder);
    let trialUnscheduled = solveGreedyPass(ctx, trialOrder, true);
    if (trialUnscheduled.length > 0) {
      trialUnscheduled = repairSchedule(ctx, trialUnscheduled);
    }

    if (isBetterSolution(ctx, trialUnscheduled, bestUnscheduled, ctx.assignments, bestAssignments)) {
      bestAssignments = cloneAssignments(ctx.assignments);
      bestUnscheduled = [...trialUnscheduled];
    }

    iteration += 1;
  }

  ctx.assignments = bestAssignments;
  return bestUnscheduled;
}

function optimizeSchedule(ctx: SchedulerContext): void {
  let currentCost = calculateCost(ctx.assignments, ctx.students, ctx.profPreferences);
  const maxIterations = 3000;

  for (let i = 0; i < maxIterations; i++) {
    if (hasTimedOut(ctx)) return;

    const randomIdx = Math.floor(Math.random() * ctx.assignments.length);
    const currentAssignment = ctx.assignments[randomIdx];
    if (!currentAssignment) continue;

    const domain = ctx.students[randomIdx].validRoomSlots;
    if (domain.length <= 1) continue;

    const randomSlot = domain[Math.floor(Math.random() * domain.length)];
    if (randomSlot.id === currentAssignment.roomSlot.id) continue;
    if (!isValidMove(ctx, randomIdx, randomSlot)) continue;

    ctx.assignments[randomIdx] = { studentIndex: randomIdx, roomSlot: randomSlot };
    const newCost = calculateCost(ctx.assignments, ctx.students, ctx.profPreferences);

    if (newCost <= currentCost) {
      currentCost = newCost;
    } else {
      ctx.assignments[randomIdx] = currentAssignment;
    }
  }
}

function summarizeUnscheduled(
  ctx: SchedulerContext,
  studentIndex: number
): { reason: UnscheduledReason; details: string } {
  const domain = ctx.students[studentIndex];
  if (domain.validRoomSlots.length === 0) {
    return {
      reason: 'NO_COMMON_TIME',
      details: '指導教授與口試教授沒有任何共同可用時段。',
    };
  }

  const blockerSummary: Record<string, number> = {};

  domain.validRoomSlots.forEach((slot) => {
    const blockers = getBlockingStudentIndices(ctx, studentIndex, slot);
    if (blockers.length === 0) return;

    blockers.forEach((blockerIndex) => {
      const blocker = ctx.students[blockerIndex].student;
      if (ctx.assignments[blockerIndex]?.roomSlot.roomId === slot.roomId) {
        const key = `房間 ${slot.roomName} 在 ${slot.timeLabel} 已被 ${blocker.name} 使用`;
        blockerSummary[key] = (blockerSummary[key] || 0) + 1;
        return;
      }

      const student = domain.student;
      if (
        student.supervisorId === blocker.supervisorId ||
        student.supervisorId === blocker.observerId
      ) {
        const key = `教授 ${student.supervisorId} 在部分候選時段與其他學生衝堂`;
        blockerSummary[key] = (blockerSummary[key] || 0) + 1;
      } else {
        const key = `教授 ${student.observerId} 在部分候選時段與其他學生衝堂`;
        blockerSummary[key] = (blockerSummary[key] || 0) + 1;
      }
    });
  });

  const topReason = Object.entries(blockerSummary).sort((left, right) => right[1] - left[1])[0]?.[0];
  return {
    reason: 'PROF_BUSY',
    details: topReason || '可用時段已被其他安排占用，無法找到符合硬限制的位置。',
  };
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { students, allRoomSlots, profAvailability, profPreferences, timeoutMs } = event.data;

  try {
    const domainObjects: StudentDomain[] = students.map((student, index) => ({
      studentIndex: index,
      student,
      validRoomSlots: getStaticDomain(student, allRoomSlots, profAvailability),
    }));

    const conflictGraph = Array.from({ length: students.length }, () => [] as number[]);
    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
        const left = students[i];
        const right = students[j];
        if (
          left.supervisorId === right.supervisorId ||
          left.supervisorId === right.observerId ||
          left.observerId === right.supervisorId ||
          left.observerId === right.observerId
        ) {
          conflictGraph[i].push(j);
          conflictGraph[j].push(i);
        }
      }
    }

    const studentOrder = domainObjects.map((domain) => domain.studentIndex);
    studentOrder.sort((left, right) => {
      const leftDomain = domainObjects[left].validRoomSlots.length;
      const rightDomain = domainObjects[right].validRoomSlots.length;
      if (leftDomain !== rightDomain) return leftDomain - rightDomain;
      return conflictGraph[right].length - conflictGraph[left].length;
    });

    const ctx: SchedulerContext = {
      students: domainObjects,
      assignments: new Array(students.length).fill(null),
      conflictGraph,
      slotDemand: domainObjects.reduce<Record<string, number>>((acc, domain) => {
        const uniqueSlotIds = new Set(domain.validRoomSlots.map((roomSlot) => roomSlot.slotId));
        uniqueSlotIds.forEach((slotId) => {
          acc[slotId] = (acc[slotId] || 0) + 1;
        });
        return acc;
      }, {}),
      startTime: Date.now(),
      profPreferences: profPreferences || {},
      timeoutMs: Math.max(500, timeoutMs ?? 1500),
    };

    const totalBudget = ctx.timeoutMs;
    const strictBudget = Math.min(4000, Math.max(1000, Math.floor(totalBudget * 0.25)));

    let solvedStrictly = false;
    try {
      ctx.startTime = Date.now();
      ctx.timeoutMs = strictBudget;
      solvedStrictly = await solveStrict(ctx, studentOrder, 0);
    } catch {
      solvedStrictly = false;
    }

    let unscheduledIndices: number[] = [];
    if (!solvedStrictly) {
      const heuristicBudget = Math.max(1000, totalBudget - strictBudget);
      const beamBudget = Math.max(600, Math.floor(heuristicBudget * 0.35));
      const multiStartBudget = Math.max(600, heuristicBudget - beamBudget);

      let bestAssignments = cloneAssignments(ctx.assignments);
      let bestUnscheduled = [...studentOrder];

      ctx.startTime = Date.now();
      ctx.timeoutMs = beamBudget;
      const beamUnscheduled = repairSchedule(ctx, solveBeamSearch(ctx, studentOrder));
      bestAssignments = cloneAssignments(ctx.assignments);
      bestUnscheduled = [...beamUnscheduled];

      ctx.startTime = Date.now();
      ctx.timeoutMs = multiStartBudget;
      const multiStartUnscheduled = solveMultiStart(ctx, studentOrder);
      if (isBetterSolution(ctx, multiStartUnscheduled, bestUnscheduled, ctx.assignments, bestAssignments)) {
        bestAssignments = cloneAssignments(ctx.assignments);
        bestUnscheduled = [...multiStartUnscheduled];
      }

      ctx.assignments = bestAssignments;
      unscheduledIndices = bestUnscheduled;
    } else {
      unscheduledIndices = ctx.assignments
        .map((assignment, index) => (assignment === null ? index : -1))
        .filter((index) => index >= 0);
    }

    if (Object.keys(ctx.profPreferences).length > 0) {
      ctx.startTime = Date.now();
      ctx.timeoutMs = Math.max(500, Math.floor(totalBudget * 0.2));
      optimizeSchedule(ctx);
    }

    const assignments: ScheduleAssignment[] = [];
    ctx.assignments.forEach((assignment) => {
      if (!assignment) return;
      assignments.push({
        student: ctx.students[assignment.studentIndex].student,
        roomSlot: assignment.roomSlot,
      });
    });

    const unscheduled = unscheduledIndices.map((studentIndex) => {
      const student = ctx.students[studentIndex].student;
      const reason = summarizeUnscheduled(ctx, studentIndex);
      return {
        student,
        reason: reason.reason,
        details: reason.details,
      };
    });

    const result: ScheduleResult = {
      success: unscheduled.length === 0,
      assignments,
      unscheduled,
      softConstraintCost:
        Object.keys(ctx.profPreferences).length > 0
          ? calculateCost(ctx.assignments, ctx.students, ctx.profPreferences)
          : undefined,
    };

    self.postMessage(result);
  } catch (error: any) {
    self.postMessage({ error: error?.message || 'Unknown worker error' });
  }
};
