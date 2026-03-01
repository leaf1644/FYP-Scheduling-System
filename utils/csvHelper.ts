import Papa from 'papaparse';
import { Student, Slot, Room, ValidationResult, ValidationIssue } from '../types';

type CsvRow = Record<string, unknown>;

const parseCSV = (file: File): Promise<CsvRow[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data || []),
      error: (error) => reject(error),
    });
  });
};

const splitList = (str: string | undefined): string[] => {
  if (!str) return [];
  return str.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
};

const normalizeHeader = (value: string): string =>
  value.toLowerCase().replace(/[\s_]+/g, '').trim();

const normalizeKey = (value: string): string =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const pickValue = (row: CsvRow, aliases: string[]): string => {
  for (const alias of aliases) {
    const val = row[alias];
    if (val !== undefined && val !== null) {
      const text = String(val).trim();
      if (text) return text;
    }
  }
  return '';
};

const isAvailableCell = (value: unknown): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const falseValues = new Set(['0', 'n', 'no', 'false', 'f', 'x', '-', 'na', 'n/a']);
  const trueValues = new Set(['1', 'y', 'yes', 'true', 't', 'v', 'available', 'ok', 'a']);

  if (falseValues.has(normalized)) return false;
  if (trueValues.has(normalized)) return true;
  return true;
};

export const parseStudents = async (file: File): Promise<Student[]> => {
  const data = await parseCSV(file);
  return data
    .map((row, index) => ({
      id: pickValue(row, ['id', 'ID', 'studentId', 'StudentID']) || `S${index + 1}`,
      name: pickValue(row, ['name', 'Name', 'student', 'Student', 'students', 'Students']),
      supervisorId: pickValue(row, ['supervisorId', 'SupervisorId', 'supervisor', 'Supervisor']),
      observerId: pickValue(row, ['observerId', 'ObserverId', 'observer', 'Observer']),
    }))
    .filter((s) => s.name);
};

export const parseSlots = async (file: File): Promise<Slot[]> => {
  const data = await parseCSV(file);
  return data
    .map((row) => ({
      id: pickValue(row, ['id', 'ID']),
      timeLabel: pickValue(row, ['timeLabel', 'TimeLabel', 'time']),
    }))
    .filter((s) => s.id && s.timeLabel);
};

export const parseRooms = async (file: File): Promise<Room[]> => {
  const data = await parseCSV(file);
  return data
    .map((row) => ({
      id: pickValue(row, ['id', 'ID']),
      name: pickValue(row, ['name', 'Name']),
      capacity: parseInt(pickValue(row, ['capacity', 'Capacity']) || '1', 10),
      availableSlotIds: splitList(pickValue(row, ['availableSlots', 'AvailableSlots'])),
    }))
    .filter((r) => r.id && r.name);
};

export const parseAvailability = async (
  file: File,
  slots?: Slot[]
): Promise<Record<string, Set<string>>> => {
  const data = await parseCSV(file);
  const map: Record<string, Set<string>> = {};

  if (data.length === 0) return map;

  const firstRow = data[0] || {};
  const headers = Object.keys(firstRow);
  const headerSet = new Set(headers.map((h) => normalizeHeader(h)));
  const isCompactFormat = headerSet.has('availableslots');

  if (isCompactFormat) {
    data.forEach((row) => {
      const profId = pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']);
      const slotsStr = pickValue(row, ['availableSlots', 'AvailableSlots']);
      if (!profId) return;

      if (!map[profId]) map[profId] = new Set();
      splitList(slotsStr).forEach((slotId) => map[profId].add(slotId));
    });
    return map;
  }

  const fixedColumns = new Set(['id', 'professorid', 'name', 'professorname']);
  const timeColumns = headers.filter((h) => !fixedColumns.has(normalizeHeader(h)));

  const slotKeyToId: Record<string, string> = {};
  (slots || []).forEach((slot) => {
    slotKeyToId[normalizeKey(slot.id)] = slot.id;
    slotKeyToId[normalizeKey(slot.timeLabel)] = slot.id;
  });

  data.forEach((row) => {
    const profId = pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']);
    if (!profId) return;

    if (!map[profId]) map[profId] = new Set();

    timeColumns.forEach((column) => {
      if (!isAvailableCell(row[column])) return;
      const mappedSlotId = slotKeyToId[normalizeKey(column)] || column;
      map[profId].add(mappedSlotId);
    });
  });

  return map;
};

export const validateData = (
  students: Student[],
  rooms: Room[],
  slots: Slot[],
  profAvailability: Record<string, Set<string>>
): ValidationResult => {
  const issues: ValidationIssue[] = [];
  const slotIds = new Set(slots.map((s) => s.id));
  const profIds = new Set(Object.keys(profAvailability));
  const seenSlotIds = new Set<string>();

  slots.forEach((s) => {
    if (seenSlotIds.has(s.id)) {
      issues.push({ type: 'error', message: `Duplicate slot ID: ${s.id}` });
    }
    seenSlotIds.add(s.id);
  });

  students.forEach((s) => {
    if (!profIds.has(s.supervisorId)) {
      issues.push({
        type: 'error',
        message: `Student ${s.name} (${s.id}) has unknown supervisorId: ${s.supervisorId}`,
      });
    }
    if (!profIds.has(s.observerId)) {
      issues.push({
        type: 'error',
        message: `Student ${s.name} (${s.id}) has unknown observerId: ${s.observerId}`,
      });
    }
    if (s.supervisorId === s.observerId) {
      issues.push({
        type: 'error',
        message: `Student ${s.name} (${s.id}) has same supervisor and observer: ${s.supervisorId}`,
      });
    }
  });

  rooms.forEach((r) => {
    r.availableSlotIds.forEach((sid) => {
      if (!slotIds.has(sid)) {
        issues.push({
          type: 'warning',
          message: `Room ${r.name} references unknown slot ID: ${sid}`,
        });
      }
    });
  });

  Object.entries(profAvailability).forEach(([pid, pSlots]) => {
    pSlots.forEach((sid) => {
      if (!slotIds.has(sid)) {
        issues.push({
          type: 'warning',
          message: `Professor ${pid} references unknown slot ID: ${sid}`,
        });
      }
    });
  });

  const profLoad: Record<string, number> = {};
  students.forEach((s) => {
    profLoad[s.supervisorId] = (profLoad[s.supervisorId] || 0) + 1;
    profLoad[s.observerId] = (profLoad[s.observerId] || 0) + 1;
  });

  Object.entries(profLoad).forEach(([pid, load]) => {
    const availableCount = profAvailability[pid]?.size || 0;
    if (availableCount < load) {
      issues.push({
        type: 'warning',
        message: `Professor ${pid} has load ${load} but only ${availableCount} available slots.`,
      });
    }
  });

  return {
    isValid: !issues.some((i) => i.type === 'error'),
    issues,
  };
};
