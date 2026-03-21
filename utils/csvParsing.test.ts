import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProfessorDirectory, deriveSlots, parseAvailability, parseRooms, parseStudents } from './csvHelper';

const fixturePath = (...segments: string[]) => path.resolve(process.cwd(), 'tests', 'fixtures', ...segments);

const loadCsvFile = (...segments: string[]) => {
  const absolutePath = fixturePath(...segments);
  const content = readFileSync(absolutePath, 'utf8');
  const fileName = segments[segments.length - 1];
  return new File([content], fileName, { type: 'text/csv' });
};

describe('CSV fixtures', () => {
  it('parses the valid fixture set into students, slots, rooms, and availability', async () => {
    const studentFile = loadCsvFile('valid', 'students.csv');
    const roomFile = loadCsvFile('valid', 'rooms.csv');
    const availabilityFile = loadCsvFile('valid', 'availability.csv');

    const slots = await deriveSlots({ roomFile, availabilityFile });
    const professorDirectory = await buildProfessorDirectory(availabilityFile);
    const students = await parseStudents(studentFile, professorDirectory);
    const rooms = await parseRooms(roomFile, slots);
    const availability = await parseAvailability(availabilityFile, slots, { professorDirectory });

    expect(slots).toHaveLength(2);
    expect(students).toHaveLength(2);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].availableSlotIds).toHaveLength(2);
    expect(Array.from(availability.P01)).toHaveLength(2);
    expect(Array.from(availability.P02)).toEqual([slots[0].id]);
  });

  it('keeps empty student fixture empty so the app can reject it early', async () => {
    const studentFile = loadCsvFile('errors', 'students-empty.csv');
    const availabilityFile = loadCsvFile('errors', 'availability-basic.csv');
    const professorDirectory = await buildProfessorDirectory(availabilityFile);
    const students = await parseStudents(studentFile, professorDirectory);

    expect(students).toEqual([]);
  });

  it('treats occupied-only room fixture as unusable room supply', async () => {
    const roomFile = loadCsvFile('errors', 'rooms-occupied-only.csv');
    const availabilityFile = loadCsvFile('errors', 'availability-basic.csv');
    const slots = await deriveSlots({ roomFile, availabilityFile });
    const rooms = await parseRooms(roomFile, slots);

    expect(slots).toHaveLength(2);
    expect(rooms).toEqual([]);
  });
});