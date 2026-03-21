import { describe, expect, it } from 'vitest';
import { normalizeScheduleResult } from './scheduleResult';
import { validateData } from './csvHelper';
import { Room, RoomSlot, Slot, Student, UnscheduledStudent } from '../types';

const sampleStudent: Student = {
  id: 'S001',
  name: 'Alice Chan',
  supervisorId: 'P01',
  observerId: 'P02',
  supervisorName: 'Prof. A',
  observerName: 'Prof. B',
};

const sampleSlot: Slot = {
  id: 'T1',
  timeLabel: 'Apr 01 09:00 - 10:00',
};

const sampleRoom: Room = {
  id: 'R1',
  name: 'Room 101',
  capacity: 1,
  availableSlotIds: ['T1'],
};

const sampleRoomSlot: RoomSlot = {
  id: 'R1::T1',
  roomId: 'R1',
  roomName: 'Room 101',
  slotId: 'T1',
  timeLabel: 'Apr 01 09:00 - 10:00',
};

const sampleUnscheduled: UnscheduledStudent = {
  student: sampleStudent,
  reason: 'NO_ROOM_AVAILABLE',
  details: 'No room left',
};

describe('normalizeScheduleResult', () => {
  it('rejects an empty solver result when students were submitted', () => {
    expect(() =>
      normalizeScheduleResult(
        {
          success: true,
          assignments: [],
          unscheduled: [],
        },
        1
      )
    ).toThrowError('SCHEDULE_EMPTY_RESULT');
  });

  it('accepts a result where every student is unscheduled', () => {
    const result = normalizeScheduleResult(
      {
        success: false,
        assignments: [],
        unscheduled: [sampleUnscheduled],
      },
      1
    );

    expect(result.success).toBe(false);
    expect(result.assignments).toHaveLength(0);
    expect(result.unscheduled).toEqual([sampleUnscheduled]);
  });

  it('rejects incomplete solver results', () => {
    expect(() =>
      normalizeScheduleResult(
        {
          success: true,
          assignments: [
            {
              student: sampleStudent,
              roomSlot: sampleRoomSlot,
            },
          ],
          unscheduled: [],
        },
        2
      )
    ).toThrowError('SCHEDULE_INCOMPLETE_RESULT');
  });
});

describe('validateData', () => {
  it('reports empty student, room, and slot inputs as errors', () => {
    const result = validateData([], [], [], {});

    expect(result.isValid).toBe(false);
    expect(result.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        '沒有可排程的學生資料。',
        '沒有可用的房間資料。',
        '沒有可用的時段資料。',
      ])
    );
  });

  it('accepts a minimal valid dataset', () => {
    const result = validateData(
      [sampleStudent],
      [sampleRoom],
      [sampleSlot],
      {
        P01: new Set(['T1']),
        P02: new Set(['T1']),
      }
    );

    expect(result.isValid).toBe(true);
    expect(result.issues.filter((issue) => issue.type === 'error')).toHaveLength(0);
  });
});