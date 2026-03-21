import { describe, expect, it } from 'vitest';
import { createSubsetData } from '../scripts/subset-generator-core.mjs';

describe('createSubsetData', () => {
  it('keeps only professors referenced by the selected students', () => {
    const result = createSubsetData({
      studentRows: [
        { ID: 'S001', Name: 'Alice', Supervisor: 'P01', Observer: 'P02' },
        { ID: 'S002', Name: 'Bob', Supervisor: 'P03', Observer: 'P04' },
        { ID: 'S003', Name: 'Carol', Supervisor: 'P05', Observer: 'P06' },
      ],
      availabilityRows: [
        { ID: 'P01', Name: 'Prof A', 'Apr 01 09:00 - 10:00': 'Yes', 'Apr 01 10:00 - 11:00': '' },
        { ID: 'P02', Name: 'Prof B', 'Apr 01 09:00 - 10:00': 'Yes', 'Apr 01 10:00 - 11:00': 'Yes' },
        { ID: 'P03', Name: 'Prof C', 'Apr 01 09:00 - 10:00': '', 'Apr 01 10:00 - 11:00': 'Yes' },
        { ID: 'P04', Name: 'Prof D', 'Apr 01 09:00 - 10:00': '', 'Apr 01 10:00 - 11:00': 'Yes' },
        { ID: 'P05', Name: 'Prof E', 'Apr 01 09:00 - 10:00': 'Yes', 'Apr 01 10:00 - 11:00': '' },
        { ID: 'P06', Name: 'Prof F', 'Apr 01 09:00 - 10:00': '', 'Apr 01 10:00 - 11:00': '' },
      ],
      roomRows: [
        { Date: 'Apr 01', 'Time Slot': '09:00 - 10:00', Venue: 'Room 101' },
        { Date: 'Apr 01', 'Time Slot': '10:00 - 11:00', Venue: 'Room 101' },
      ],
      options: {
        count: 2,
        strategy: 'first',
      },
    });

    expect(result.students.rows).toHaveLength(2);
    expect(result.metadata.selectedProfessorIds).toEqual(['P01', 'P02', 'P03', 'P04']);
    expect(result.availability.rows).toHaveLength(4);
    expect(result.rooms.rows).toHaveLength(2);
  });

  it('filters compact room and availability formats by the selected slot tokens', () => {
    const result = createSubsetData({
      studentRows: [
        { ID: 'S001', Name: 'Alice', Supervisor: 'P01', Observer: 'P02' },
        { ID: 'S002', Name: 'Bob', Supervisor: 'P03', Observer: 'P04' },
      ],
      availabilityRows: [
        { ID: 'P01', Name: 'Prof A', AvailableSlots: 'T1; T2' },
        { ID: 'P02', Name: 'Prof B', AvailableSlots: 'T1' },
        { ID: 'P03', Name: 'Prof C', AvailableSlots: 'T3' },
        { ID: 'P04', Name: 'Prof D', AvailableSlots: 'T4' },
      ],
      roomRows: [
        { ID: 'R1', Name: 'Room 101', AvailableSlots: 'T1; T2; T3' },
        { ID: 'R2', Name: 'Room 102', AvailableSlots: 'T4' },
      ],
      slotRows: [
        { ID: 'T1', TimeLabel: 'Apr 01 09:00 - 10:00' },
        { ID: 'T2', TimeLabel: 'Apr 01 10:00 - 11:00' },
        { ID: 'T3', TimeLabel: 'Apr 01 11:00 - 12:00' },
        { ID: 'T4', TimeLabel: 'Apr 01 12:00 - 13:00' },
      ],
      options: {
        count: 1,
        strategy: 'first',
      },
    });

    expect(result.metadata.selectedProfessorIds).toEqual(['P01', 'P02']);
    expect(result.metadata.selectedSlotTokens).toEqual(['T1', 'T2']);
    expect(result.rooms.rows).toHaveLength(1);
    expect(result.rooms.rows[0].availableSlots).toBe('T1; T2');
    expect(result.slots.rows.map((row) => row.ID)).toEqual(['T1', 'T2']);
  });

  it('keeps fine-grained room rows when they overlap with broader availability windows on the same day', () => {
    const result = createSubsetData({
      studentRows: [
        { ID: 'S001', Name: 'Alice', Supervisor: 'P01', Observer: 'P02' },
      ],
      availabilityRows: [
        { ID: 'P01', '10 April (Fri) 9-11:30am': 'Yes', '10 April (Fri) 11:30-1pm': '' },
        { ID: 'P02', '10 April (Fri) 9-11:30am': 'Yes', '10 April (Fri) 11:30-1pm': 'Yes' },
      ],
      roomRows: [
        { Date: '10 Apr 2026', 'Time Slot': '09:00-09:45', Venue: 'RRS732', Student: '', Supervisor: '', Observer: '' },
        { Date: '10 Apr 2026', 'Time Slot': '09:45-10:30', Venue: 'RRS732', Student: '', Supervisor: '', Observer: '' },
        { Date: '10 Apr 2026', 'Time Slot': '14:00-14:45', Venue: 'RRS732', Student: '', Supervisor: '', Observer: '' },
      ],
      options: {
        count: 1,
        strategy: 'first',
      },
    });

    expect(result.rooms.rows).toHaveLength(2);
    expect(result.rooms.rows.map((row) => row['Time Slot'])).toEqual(['09:00-09:45', '09:45-10:30']);
  });

  it('can keep all professors unchanged while cutting room slots only', () => {
    const result = createSubsetData({
      studentRows: [
        { ID: 'S001', Name: 'Alice', Supervisor: 'P01', Observer: 'P02' },
        { ID: 'S002', Name: 'Bob', Supervisor: 'P03', Observer: 'P04' },
      ],
      availabilityRows: [
        { ID: 'P01', '10 April (Fri) 9-11:30am': 'Yes' },
        { ID: 'P02', '10 April (Fri) 9-11:30am': 'Yes' },
        { ID: 'P03', '10 April (Fri) 9-11:30am': 'Yes' },
        { ID: 'P04', '10 April (Fri) 9-11:30am': 'Yes' },
      ],
      roomRows: [
        { Date: '10 Apr 2026', 'Time Slot': '09:00-09:45', Venue: 'RRS732' },
        { Date: '10 Apr 2026', 'Time Slot': '09:45-10:30', Venue: 'RRS732' },
        { Date: '11 Apr 2026', 'Time Slot': '09:00-09:45', Venue: 'RRS732' },
      ],
      options: {
        fraction: 1,
        keepAllProfessors: true,
        roomSlotCount: 1,
      },
    });

    expect(result.metadata.keepAllProfessors).toBe(true);
    expect(result.availability.rows).toHaveLength(4);
    expect(result.metadata.selectedProfessorIds).toEqual(['P01', 'P02', 'P03', 'P04']);
    expect(result.rooms.rows).toHaveLength(1);
  });

  it('preserves professor availability rows and columns exactly when keep-all-professors is enabled', () => {
    const availabilityRows = [
      { ID: 'Dr. YU, Wilson Shih Bun', '10 April (Fri) 9-11:30am': 'Yes', Remarks: '', 欄1: '' },
      { ID: 'Prof. TAI, Samson Kin Hon', '10 April (Fri) 9-11:30am': 'No', Remarks: 'keep', 欄1: 'x' },
    ];

    const result = createSubsetData({
      studentRows: [
        { Students: '1', Supervisor: 'Prof. ZHOU, Kaiyang', Observer: 'Prof. HAN, Bo' },
      ],
      availabilityRows,
      roomRows: [
        { Date: '10 Apr 2026', 'Time Slot': '09:00-09:45', Venue: 'RRS732' },
      ],
      options: {
        fraction: 1,
        keepAllProfessors: true,
        roomSlotCount: 1,
      },
    });

    expect(result.availability.rows).toEqual(availabilityRows);
    expect(result.availability.headers).toEqual(['ID', '10 April (Fri) 9-11:30am', 'Remarks', '欄1']);
    expect(result.metadata.selectedProfessorIds).toEqual(['Dr. YU, Wilson Shih Bun', 'Prof. TAI, Samson Kin Hon']);
  });
});