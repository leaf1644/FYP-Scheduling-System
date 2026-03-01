import { Student, RoomSlot, ScheduleResult, ScheduleAssignment } from '../types';

// --- Worker State & Types ---

// Professor Preference Definition
export interface ProfPreference {
  type: 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD';
  target?: number; // e.g., max presentations per day
  weight: number; // How important this preference is
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

interface SchedulerContext {
  students: StudentDomain[];
  assignments: (Assignment | null)[];
  occupiedRoomSlots: Set<string>;
  occupiedProfSlots: Set<string>; // "ProfID::SlotID"
  conflictGraph: number[][];
  startTime: number;
  profPreferences: Record<string, ProfPreference>;
  timeoutMs: number;
}

interface StudentDomain {
  studentIndex: number;
  student: Student;
  validRoomSlots: RoomSlot[];
}

// --- Logic Helpers ---

function getStaticDomain(
  student: Student,
  allRoomSlots: RoomSlot[],
  profAvailability: Record<string, string[]>
): RoomSlot[] {
  const supSlots = profAvailability[student.supervisorId] || [];
  const obsSlots = profAvailability[student.observerId] || [];
  
  // Intersection of Supervisor, Observer, and Slot existence
  return allRoomSlots.filter(rs => 
    supSlots.includes(rs.slotId) && obsSlots.includes(rs.slotId)
  );
}

// --- Soft Constraint Scoring Engine ---

function getDateFromSlot(slot: RoomSlot): string {
  // Extract day from format like "Slot 01 (Day 1 9:00)"
  const match = slot.timeLabel.match(/Day (\d+)/);
  return match ? `Day ${match[1]}` : slot.timeLabel;
}

function calculateCost(
  assignments: (Assignment | null)[],
  students: StudentDomain[],
  profPreferences: Record<string, ProfPreference>
): number {
  let totalCost = 0;
  
  // Collect professor statistics
  const profStats: Record<string, { days: Set<string>, dailyLoad: Record<string, number> }> = {};

  assignments.forEach(a => {
    if (!a) return;
    const student = students[a.studentIndex].student;
    const day = getDateFromSlot(a.roomSlot);

    [student.supervisorId, student.observerId].forEach(pid => {
      if (!profStats[pid]) {
        profStats[pid] = { days: new Set(), dailyLoad: {} };
      }
      profStats[pid].days.add(day);
      profStats[pid].dailyLoad[day] = (profStats[pid].dailyLoad[day] || 0) + 1;
    });
  });

  // Calculate cost based on preferences
  Object.keys(profStats).forEach(pid => {
    const stats = profStats[pid];
    const pref = profPreferences[pid] || { type: 'CONCENTRATE', weight: 10 };

    if (pref.type === 'CONCENTRATE') {
      // Prefer fewer days (all presentations on one day)
      if (stats.days.size > 1) {
        totalCost += (stats.days.size - 1) * pref.weight;
      }
    } else if (pref.type === 'MAX_PER_DAY') {
      // Limit presentations per day (e.g., max 3 per day)
      const limit = pref.target || 3;
      Object.values(stats.dailyLoad).forEach(load => {
        if (load > limit) {
          totalCost += (load - limit) * pref.weight;
        }
      });
    } else if (pref.type === 'SPREAD') {
      // Prefer more days (spread presentations)
      const idealDays = Math.ceil(Object.values(stats.dailyLoad).reduce((a, b) => a + b, 0) / 2);
      if (stats.days.size < idealDays) {
        totalCost += (idealDays - stats.days.size) * pref.weight;
      }
    }
  });

  return totalCost;
}

// ... existing code...

function isValidMove(
  ctx: SchedulerContext,
  student: Student,
  candidate: RoomSlot,
  ignoreStudentIndex: number = -1
): boolean {
  // 1. Room Conflict - Check by roomId + slotId
  for (const assignment of ctx.assignments) {
    if (assignment !== null && assignment.roomSlot.roomId === candidate.roomId && assignment.roomSlot.slotId === candidate.slotId) {
      return false;
    }
  }

  // 2. Professor Conflict - Check both supervisor AND observer against ALL assignments
  for (const assignment of ctx.assignments) {
    if (assignment === null) continue;
    
    const otherStudent = ctx.students[assignment.studentIndex].student;
    const otherSlot = assignment.roomSlot;
    
    // Check if this slot already has the same supervisor or observer
    if (otherSlot.slotId === candidate.slotId) {
      // Current student's supervisors can't overlap with other student's supervisors/observers
      if (student.supervisorId === otherStudent.supervisorId) return false;
      if (student.supervisorId === otherStudent.observerId) return false;
      if (student.observerId === otherStudent.supervisorId) return false;
      if (student.observerId === otherStudent.observerId) return false;
    }
  }

  return true;
}

function forwardCheck(
  ctx: SchedulerContext,
  currentStudentIndex: number,
  candidate: RoomSlot
): boolean {
  const neighbors = ctx.conflictGraph[currentStudentIndex];
  for (const neighborIdx of neighbors) {
    if (ctx.assignments[neighborIdx] !== null) continue;

    const neighborDomain = ctx.students[neighborIdx];
    let hasViableOption = false;

     for (const option of neighborDomain.validRoomSlots) {
      // FIXED: Check against candidate (current attempt)
      if (option.roomId === candidate.roomId && 
          option.slotId === candidate.slotId) {
        continue; // This option conflicts with candidate, skip it
      }

      let isValid = true;
      
      // Check room conflict
      for (const assignment of ctx.assignments) {
        if (assignment !== null && 
            assignment.roomSlot.roomId === option.roomId && 
            assignment.roomSlot.slotId === option.slotId) {
          isValid = false;
          break;
        }
      }
      
      if (!isValid) continue;

      // Check professor conflicts
      let profConflict = false;
      for (const assignment of ctx.assignments) {
        if (assignment === null) continue;
        const otherStudent = ctx.students[assignment.studentIndex].student;
        if (assignment.roomSlot.slotId === option.slotId) {
          if (otherStudent.supervisorId === neighborDomain.student.supervisorId ||
              otherStudent.observerId === neighborDomain.student.supervisorId ||
              otherStudent.supervisorId === neighborDomain.student.observerId ||
              otherStudent.observerId === neighborDomain.student.observerId) {
            profConflict = true;
            break;
          }
        }
      }
      
      if (!profConflict) {
        hasViableOption = true;
        break;
      }
    }
    
    if (!hasViableOption) return false;
  }
  return true;
}

async function solveStrict(
  ctx: SchedulerContext,
  studentOrder: number[],
  depth: number
): Promise<boolean> {
  if (depth % 50 === 0) {
    if (Date.now() - ctx.startTime > ctx.timeoutMs) throw new Error("TIMEOUT");
  }

  if (depth === studentOrder.length) return true;

  const currentIdx = studentOrder[depth];
  const domainObj = ctx.students[currentIdx];

  for (const slot of domainObj.validRoomSlots) {
    if (!isValidMove(ctx, domainObj.student, slot)) continue;
    if (!forwardCheck(ctx, currentIdx, slot)) continue;

    // Apply
    ctx.assignments[currentIdx] = { studentIndex: currentIdx, roomSlot: slot };

    const success = await solveStrict(ctx, studentOrder, depth + 1);
    if (success) return true;

    // Backtrack
    ctx.assignments[currentIdx] = null;
  }
  return false;
}

function solveGreedy(ctx: SchedulerContext, studentOrder: number[]) {
  ctx.assignments.fill(null);
  console.log(`[Greedy] Starting fresh with ${studentOrder.length} students`);

  const unscheduledIndices: number[] = [];

  for (const idx of studentOrder) {
    const domainObj = ctx.students[idx];
    const student = domainObj.student;
    
    // Filter slots that don't conflict with any existing assignment
    const possibleSlots = domainObj.validRoomSlots.filter(s => {
      // 1. Check room occupancy
      for (const assignment of ctx.assignments) {
        if (assignment !== null && assignment.roomSlot.roomId === s.roomId && assignment.roomSlot.slotId === s.slotId) {
          return false;
        }
      }
      
      // 2. Check professor availability in this slot
      for (const assignment of ctx.assignments) {
        if (assignment === null) continue;
        const otherStudent = ctx.students[assignment.studentIndex].student;
        
        if (assignment.roomSlot.slotId === s.slotId) {
          // Check all four professor conflict scenarios
          if (student.supervisorId === otherStudent.supervisorId) return false;
          if (student.supervisorId === otherStudent.observerId) return false;
          if (student.observerId === otherStudent.supervisorId) return false;
          if (student.observerId === otherStudent.observerId) return false;
        }
      }
      
      return true;
    });

    if (possibleSlots.length > 0) {
      const bestSlot = possibleSlots[0];
      ctx.assignments[idx] = { studentIndex: idx, roomSlot: bestSlot };
      console.log(`[Greedy] ${student.name} scheduled to ${bestSlot.roomName} ${bestSlot.timeLabel}`);
    } else {
      unscheduledIndices.push(idx);
      console.log(`[Greedy] ${student.name} has NO valid slots (domain size was ${domainObj.validRoomSlots.length})`);
    }
  }
  
  console.log(`[Greedy] Done. Unscheduled: ${unscheduledIndices.map(i => ctx.students[i].student.name).join(', ')}`);
  return unscheduledIndices;
}

function optimizeSchedule(ctx: SchedulerContext, unscheduledIndices: number[]) {
  console.log(`[Optimization] Starting with cost-based optimization...`);
  
  let currentCost = calculateCost(ctx.assignments, ctx.students, ctx.profPreferences);
  console.log(`[Optimization] Initial cost: ${currentCost}`);
  
  const maxIterations = 3000;
  let improvements = 0;

  for (let i = 0; i < maxIterations; i++) {
    // Pick random student and slot
    const randomIdx = Math.floor(Math.random() * ctx.assignments.length);
    const currentAssign = ctx.assignments[randomIdx];
    
    if (!currentAssign) continue;

    const domain = ctx.students[randomIdx].validRoomSlots;
    if (domain.length <= 1) continue;

    const randomSlot = domain[Math.floor(Math.random() * domain.length)];
    if (randomSlot.id === currentAssign.roomSlot.id) continue;

    // Check hard constraints (must be valid)
    let isHardValid = true;
    
    // Check room conflict
    for (const assignment of ctx.assignments) {
      if (assignment && assignment.studentIndex !== randomIdx &&
          assignment.roomSlot.roomId === randomSlot.roomId && 
          assignment.roomSlot.slotId === randomSlot.slotId) {
        isHardValid = false;
        break;
      }
    }

    // Check professor conflict
    if (isHardValid) {
      const student = ctx.students[randomIdx].student;
      for (const assignment of ctx.assignments) {
        if (assignment && assignment.studentIndex !== randomIdx &&
            assignment.roomSlot.slotId === randomSlot.slotId) {
          const otherStudent = ctx.students[assignment.studentIndex].student;
          if (student.supervisorId === otherStudent.supervisorId ||
              student.supervisorId === otherStudent.observerId ||
              student.observerId === otherStudent.supervisorId ||
              student.observerId === otherStudent.observerId) {
            isHardValid = false;
            break;
          }
        }
      }
    }

    if (!isHardValid) continue;

    // Try the move
    ctx.assignments[randomIdx] = { studentIndex: randomIdx, roomSlot: randomSlot };
    const newCost = calculateCost(ctx.assignments, ctx.students, ctx.profPreferences);

    if (newCost < currentCost) {
      currentCost = newCost;
      improvements++;
      console.log(`[Optimization] Improvement ${improvements}: cost ${newCost}`);
    } else {
      // Revert
      ctx.assignments[randomIdx] = currentAssign;
    }
  }

  console.log(`[Optimization] Done. Made ${improvements} improvements. Final cost: ${currentCost}`);
  return unscheduledIndices;
}



// --- Main Worker Handler ---

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { students, allRoomSlots, profAvailability, profPreferences, timeoutMs } = e.data;

  try {
    // 1. Data Prep
    const domainObjects: StudentDomain[] = students.map((s, i) => ({
      studentIndex: i,
      student: s,
      validRoomSlots: getStaticDomain(s, allRoomSlots, profAvailability)
    }));

    // 2. Conflict Graph
    const conflictGraph = Array.from({ length: students.length }, () => [] as number[]);
    for (let i = 0; i < students.length; i++) {
      for (let j = i + 1; j < students.length; j++) {
         const s1 = students[i];
         const s2 = students[j];
         if (s1.supervisorId === s2.supervisorId || s1.supervisorId === s2.observerId ||
             s1.observerId === s2.supervisorId || s1.observerId === s2.observerId) {
           conflictGraph[i].push(j);
           conflictGraph[j].push(i);
         }
      }
    }

    // 3. Sort (MRV + Degree)
    const studentIndices = domainObjects.map(d => d.studentIndex);
    studentIndices.sort((a, b) => {
      const dA = domainObjects[a].validRoomSlots.length;
      const dB = domainObjects[b].validRoomSlots.length;
      if (dA !== dB) return dA - dB;
      return conflictGraph[b].length - conflictGraph[a].length;
    });

    const ctx: SchedulerContext = {
      students: domainObjects,
      assignments: new Array(students.length).fill(null),
      occupiedRoomSlots: new Set(),
      occupiedProfSlots: new Set(),
      conflictGraph,
      startTime: Date.now(),
      profPreferences: profPreferences || {},
      timeoutMs: Math.max(500, timeoutMs ?? 1500)
    };

    // 4. Execution Strategy
    let success = false;
    try {
      success = await solveStrict(ctx, studentIndices, 0);
    } catch (err) {
      success = false; 
    }

    let unscheduledIndices: number[] = [];

    // ALWAYS try greedy after strict to get unscheduled list for reporting
    if (!success) {
      // Phase 2: Greedy
      unscheduledIndices = solveGreedy(ctx, studentIndices);
    } else {
      // Even if strict solved all, verify the solution
      const actualUnscheduled: number[] = [];
      for (let i = 0; i < ctx.assignments.length; i++) {
        if (ctx.assignments[i] === null) {
          actualUnscheduled.push(i);
        }
      }
      unscheduledIndices = actualUnscheduled;
    }

    // Phase 3: Iterative Repair (Optimization) - ALWAYS run if preferences exist
    // This optimizes soft constraints even if all students are already scheduled
    if (Object.keys(ctx.profPreferences).length > 0) {
      console.log(`[Solver] Soft constraints detected. Running optimization phase...`);
      optimizeSchedule(ctx, unscheduledIndices);
    }

    // 5. Final Report Construction
    const assignments: ScheduleAssignment[] = [];
    const scheduledIndices: number[] = [];
    
    ctx.assignments.forEach((assignment, i) => {
      if (assignment) {
        const student = ctx.students[assignment.studentIndex].student;
        const slot = assignment.roomSlot;
        assignments.push({ student, roomSlot: slot });
        scheduledIndices.push(assignment.studentIndex);
        console.log(`Scheduled: ${student.name} → ${slot.roomName} ${slot.timeLabel} (${student.supervisorId}, ${student.observerId})`);
      }
    });
    
    console.log(`Total scheduled: ${scheduledIndices.length}/${students.length}`);
    console.log(`Unscheduled indices: ${unscheduledIndices.map(i => ctx.students[i].student.name).join(', ')}`);

    // Detailed Reason Analysis for Unscheduled
    const unscheduledList = unscheduledIndices.map(idx => {
      const d = domainObjects[idx];
      let reason: 'NO_COMMON_TIME' | 'PROF_BUSY' = 'PROF_BUSY';
      let details = '資源 (教授或房間) 被佔用，嘗試交換無效。';

      if (d.validRoomSlots.length === 0) {
        reason = 'NO_COMMON_TIME';
        details = '導師與觀察員沒有共同空閒時間。';
      }

      return {
        student: d.student,
        reason,
        details
      };
    });

    console.log(`Final unscheduled count: ${unscheduledList.length}`);

    // Calculate and report soft constraint cost if preferences exist
    const softConstraintCost = Object.keys(ctx.profPreferences).length > 0 
      ? calculateCost(ctx.assignments, ctx.students, ctx.profPreferences)
      : undefined;

    if (softConstraintCost !== undefined) {
      console.log(`[Final] Soft constraint cost: ${softConstraintCost}`);
    }

    self.postMessage({
      success: unscheduledList.length === 0,
      assignments,
      unscheduled: unscheduledList,
      softConstraintCost
    });

  } catch (error: any) {
    self.postMessage({ error: error.message });
  }
};
