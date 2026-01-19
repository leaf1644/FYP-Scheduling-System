import { Student, RoomSlot, ScheduleResult, ScheduleAssignment } from '../types';

// --- Worker State & Types ---

interface WorkerMessage {
  students: Student[];
  allRoomSlots: RoomSlot[];
  profAvailability: Record<string, string[]>;
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

// ...existing code...

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
    if (Date.now() - ctx.startTime > 1500) throw new Error("TIMEOUT");
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
  const maxIterations = 500;
  let remaining = [...unscheduledIndices];
  let iteration = 0;

  while (remaining.length > 0 && iteration < maxIterations) {
    iteration++;
    const currentIdx = remaining[0];
    const student = ctx.students[currentIdx].student;
    const domain = ctx.students[currentIdx].validRoomSlots;

    let fixed = false;

    for (const desiredSlot of domain) {
      // Check room conflict
      let roomOccupied = false;
      let occupantIdx = -1;
      
      for (let i = 0; i < ctx.assignments.length; i++) {
        const a = ctx.assignments[i];
        if (a && a.roomSlot.roomId === desiredSlot.roomId && a.roomSlot.slotId === desiredSlot.slotId) {
          roomOccupied = true;
          occupantIdx = i;
          break;
        }
      }

      // Check professor conflict
      let profConflict = false;
      for (const assignment of ctx.assignments) {
        if (assignment === null) continue;
        const otherStudent = ctx.students[assignment.studentIndex].student;
        if (assignment.roomSlot.slotId === desiredSlot.slotId) {
          if (student.supervisorId === otherStudent.supervisorId ||
              student.supervisorId === otherStudent.observerId ||
              student.observerId === otherStudent.supervisorId ||
              student.observerId === otherStudent.observerId) {
            profConflict = true;
            break;
          }
        }
      }

      if (profConflict) continue; // Skip this slot if prof conflicts

      if (!roomOccupied) {
        // Slot is free, just assign
        ctx.assignments[currentIdx] = { studentIndex: currentIdx, roomSlot: desiredSlot };
        fixed = true;
        break;
      } else if (occupantIdx !== -1) {
        // Try to swap with occupant
        const occupant = ctx.students[occupantIdx];
        const originalOccupantSlot = ctx.assignments[occupantIdx]!;

        ctx.assignments[occupantIdx] = null;

        // Check if current student can go to desired slot (now room is free)
        let canAssignCurrent = true;
        for (const assignment of ctx.assignments) {
          if (assignment === null) continue;
          const otherStudent = ctx.students[assignment.studentIndex].student;
          if (assignment.roomSlot.slotId === desiredSlot.slotId) {
            if (student.supervisorId === otherStudent.supervisorId ||
                student.supervisorId === otherStudent.observerId ||
                student.observerId === otherStudent.supervisorId ||
                student.observerId === otherStudent.observerId) {
              canAssignCurrent = false;
              break;
            }
          }
        }

        if (canAssignCurrent) {
          // Find alternative slot for occupant
          const occupantMoves = occupant.validRoomSlots.filter(s => {
            // Check room conflict
            for (const assignment of ctx.assignments) {
              if (assignment !== null && assignment.roomSlot.roomId === s.roomId && assignment.roomSlot.slotId === s.slotId) {
                return false;
              }
            }
            // Check prof conflict
            for (const assignment of ctx.assignments) {
              if (assignment === null) continue;
              const other = ctx.students[assignment.studentIndex].student;
              if (assignment.roomSlot.slotId === s.slotId) {
                if (occupant.student.supervisorId === other.supervisorId ||
                    occupant.student.supervisorId === other.observerId ||
                    occupant.student.observerId === other.supervisorId ||
                    occupant.student.observerId === other.observerId) {
                  return false;
                }
              }
            }
            return true;
          });
          
          if (occupantMoves.length > 0) {
            ctx.assignments[currentIdx] = { studentIndex: currentIdx, roomSlot: desiredSlot };
            ctx.assignments[occupantIdx] = { studentIndex: occupantIdx, roomSlot: occupantMoves[0] };
            fixed = true;
            break;
          }
        }

        ctx.assignments[occupantIdx] = originalOccupantSlot;
      }
    }

    if (fixed) {
      remaining.shift();
    } else {
      const skipped = remaining.shift()!;
      if (iteration < 100) remaining.push(skipped);
    }
  }

  return remaining;
}

// ...existing code...

// --- Main Worker Handler ---

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { students, allRoomSlots, profAvailability } = e.data;

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
      startTime: Date.now()
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
      
      // Phase 3: Iterative Repair (Optimization) - DISABLED until fixed
      // Only run optimization if it doesn't violate constraints
      // if (unscheduledIndices.length > 0) {
      //   unscheduledIndices = optimizeSchedule(ctx, unscheduledIndices);
      // }
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

    self.postMessage({
      success: unscheduledList.length === 0,
      assignments,
      unscheduled: unscheduledList
    });

  } catch (error: any) {
    self.postMessage({ error: error.message });
  }
};