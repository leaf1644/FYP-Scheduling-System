export interface Student {
  id: string;
  name: string;
  supervisorId: string;
  observerId: string;
}

export interface Slot {
  id: string;
  timeLabel: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  availableSlotIds: string[];
}

export interface RoomSlot {
  id: string;
  roomId: string;
  roomName: string;
  slotId: string;
  timeLabel: string;
}

export interface ScheduleAssignment {
  student: Student;
  roomSlot: RoomSlot;
}

// Professor Preferences for Soft Constraints
export interface ProfPreference {
  type: 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD';
  target?: number; // e.g., max presentations per day (for MAX_PER_DAY)
  weight: number; // How important this preference is (1-10 recommended)
}

// Enhanced Unscheduled Type
export interface UnscheduledStudent {
  student: Student;
  reason: 'NO_COMMON_TIME' | 'NO_ROOM_AVAILABLE' | 'PROF_BUSY' | 'UNKNOWN';
  details: string;
}

export interface ScheduleResult {
  success: boolean;
  assignments: ScheduleAssignment[];
  unscheduled: UnscheduledStudent[];
  softConstraintCost?: number; // Optional: cost of soft constraint violations (lower is better)
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
}

export type SolvingStatus = 'idle' | 'parsing' | 'validating' | 'solving' | 'success' | 'partial' | 'failed' | 'error';
