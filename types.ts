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
