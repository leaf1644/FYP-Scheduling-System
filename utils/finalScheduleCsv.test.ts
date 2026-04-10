import { describe, expect, it } from 'vitest';
import { buildFinalScheduleCsv, createFinalScheduleCsvBlob } from './finalScheduleCsv';
import { ScheduleAssignment, UnscheduledStudent } from '../types';

const sampleAssignment: ScheduleAssignment = {
  student: {
    id: 'S001',
    name: '張小明',
    supervisorId: 'P01',
    observerId: 'P02',
    supervisorName: '陳教授',
    observerName: '李教授',
  },
  roomSlot: {
    id: 'R1::T1',
    roomId: 'R1',
    roomName: 'Room 101',
    slotId: 'T1',
    timeLabel: '13 Apr 2026 15:30-16:15',
  },
};

const sampleUnscheduled: UnscheduledStudent = {
  student: {
    id: 'S002',
    name: '王小美',
    supervisorId: 'P03',
    observerId: 'P04',
    supervisorName: '周教授',
    observerName: '何教授',
  },
  reason: 'NO_COMMON_TIME',
  details: 'No common availability',
};

const labels = {
  scheduled: '已排程',
  unscheduled: '未排程',
};

describe('finalScheduleCsv', () => {
  it('builds a CSV with scheduled and unscheduled rows', () => {
    const csv = buildFinalScheduleCsv([sampleAssignment], [sampleUnscheduled], labels);

    expect(csv).toContain('Status,Time,Room,Student,Supervisor,Observer');
    expect(csv).toContain('已排程,13 Apr 2026 15:30-16:15,Room 101,張小明,P01 陳教授,P02 李教授');
    expect(csv).toContain('未排程,,,王小美,P03 周教授,P04 何教授');
  });

  it('prepends a UTF-8 BOM so Excel can decode Unicode text correctly', async () => {
    const blob = createFinalScheduleCsvBlob([sampleAssignment], [sampleUnscheduled], labels);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = await blob.text();

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(text).toContain('張小明');
    expect(text).toContain('13 Apr 2026 15:30-16:15');
  });
});