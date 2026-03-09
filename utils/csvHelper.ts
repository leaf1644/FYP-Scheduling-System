import { Student, Slot, Room, ValidationResult, ValidationIssue } from '../types';
import { parseTabularFile, TabularRow } from './tabularParser';

const splitList = (str: string | undefined): string[] => {
  if (!str) return [];
  return str.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[\s_]+/g, '').trim();

const normalizeKey = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const pickValue = (row: TabularRow, aliases: string[]): string => {
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

const buildProfessorAliases = (profIdRaw: string, profNameRaw: string): string[] => {
  const aliases = new Set<string>();
  const profId = profIdRaw.trim();
  const profName = profNameRaw.trim();

  if (profId) aliases.add(profId);
  if (profName) aliases.add(profName);

  if (profName) {
    const stripped = profName.replace(/^prof\.?\s*/i, '').trim();
    if (stripped) {
      aliases.add(stripped);
      aliases.add(`Prof. ${stripped}`);
      aliases.add(`Prof ${stripped}`);
    }
  }

  if (/^\d+$/.test(profId)) {
    const n = Number(profId);
    if (!Number.isNaN(n)) {
      aliases.add(`P${String(n).padStart(2, '0')}`);
      aliases.add(`P${n}`);
    }
  }

  return Array.from(aliases).filter(Boolean);
};

interface ParsedTimeRange {
  dayKey: string;
  startMinutes: number;
  endMinutes: number;
}

interface SlotTimeMeta {
  id: string;
  range: ParsedTimeRange;
}

const parseClockToMinutes = (raw: string, fallbackMeridiem?: 'am' | 'pm'): number | null => {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const explicitMeridiem = (match[3]?.toLowerCase() as 'am' | 'pm' | undefined);
  const meridiem = explicitMeridiem || fallbackMeridiem;

  if (!meridiem) {
    // No am/pm provided, treat as 24-hour time.
    if (hour > 23 || minute > 59) return null;
    return hour * 60 + minute;
  }

  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (meridiem === 'pm') hour += 12;
  return hour * 60 + minute;
};

const parseTimeRange = (label: string): ParsedTimeRange | null => {
  const normalized = label.replace(/[–—]/g, '-').trim();
  const match = normalized.match(
    /^(.*?)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i
  );
  if (!match) return null;

  const dayKey = normalizeKey(match[1].trim());
  const startRaw = match[2].trim();
  const endRaw = match[3].trim();

  const explicitStartMeridiem = startRaw.match(/(am|pm)\s*$/i)?.[1]?.toLowerCase() as 'am' | 'pm' | undefined;
  const explicitEndMeridiem = endRaw.match(/(am|pm)\s*$/i)?.[1]?.toLowerCase() as 'am' | 'pm' | undefined;

  let startMinutes = parseClockToMinutes(startRaw, explicitStartMeridiem || explicitEndMeridiem);
  let endMinutes = parseClockToMinutes(endRaw, explicitEndMeridiem || explicitStartMeridiem);

  if (
    startMinutes !== null &&
    endMinutes !== null &&
    startMinutes >= endMinutes &&
    !explicitStartMeridiem &&
    explicitEndMeridiem
  ) {
    // Case like "11:30-1pm": start should likely be opposite meridiem.
    const opposite = explicitEndMeridiem === 'am' ? 'pm' : 'am';
    const altStart = parseClockToMinutes(startRaw, opposite);
    if (altStart !== null && altStart < endMinutes) {
      startMinutes = altStart;
    }
  }

  if (startMinutes === null || endMinutes === null || startMinutes >= endMinutes) return null;

  return {
    dayKey,
    startMinutes,
    endMinutes,
  };
};

const resolveAvailabilityToken = (
  token: string,
  slotKeyToId: Record<string, string>,
  slotTimeMeta: SlotTimeMeta[]
): string[] => {
  const normalizedToken = normalizeKey(token);
  const exactSlotId = slotKeyToId[normalizedToken];
  if (exactSlotId) return [exactSlotId];

  const range = parseTimeRange(token);
  if (!range) return [token];

  const matched = slotTimeMeta
    .filter(({ range: slotRange }) => {
      if (range.dayKey && slotRange.dayKey && range.dayKey !== slotRange.dayKey) return false;
      return slotRange.startMinutes >= range.startMinutes && slotRange.endMinutes <= range.endMinutes;
    })
    .map(({ id }) => id);

  return matched.length > 0 ? matched : [token];
};

export const parseStudents = async (file: File): Promise<Student[]> => {
  const data = await parseTabularFile(file);
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
  const data = await parseTabularFile(file);
  return data
    .map((row) => ({
      id: pickValue(row, ['id', 'ID']),
      timeLabel: pickValue(row, ['timeLabel', 'TimeLabel', 'time']),
    }))
    .filter((s) => s.id && s.timeLabel);
};

export const parseRooms = async (file: File): Promise<Room[]> => {
  const data = await parseTabularFile(file);
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
  const data = await parseTabularFile(file);
  const map: Record<string, Set<string>> = {};
  const slotKeyToId: Record<string, string> = {};
  const slotTimeMeta: SlotTimeMeta[] = [];

  (slots || []).forEach((slot) => {
    slotKeyToId[normalizeKey(slot.id)] = slot.id;
    slotKeyToId[normalizeKey(slot.timeLabel)] = slot.id;

    const parsed = parseTimeRange(slot.timeLabel) || parseTimeRange(slot.id);
    if (parsed) {
      slotTimeMeta.push({ id: slot.id, range: parsed });
    }
  });

  const addResolvedSlots = (profAliases: string[], token: string) => {
    const resolvedSlotIds = resolveAvailabilityToken(token, slotKeyToId, slotTimeMeta);
    profAliases.forEach((alias) => {
      if (!map[alias]) map[alias] = new Set();
      resolvedSlotIds.forEach((slotId) => map[alias].add(slotId));
    });
  };

  if (data.length === 0) return map;

  const firstRow = data[0] || {};
  const headers = Object.keys(firstRow);
  const headerSet = new Set(headers.map((h) => normalizeHeader(h)));
  const isCompactFormat = headerSet.has('availableslots');

  if (isCompactFormat) {
    data.forEach((row) => {
      const profId = pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']);
      const profName = pickValue(row, ['name', 'Name', 'professorName', 'ProfessorName']);
      const slotsStr = pickValue(row, ['availableSlots', 'AvailableSlots']);
      const aliases = buildProfessorAliases(profId, profName);
      if (aliases.length === 0) return;
      splitList(slotsStr).forEach((token) => addResolvedSlots(aliases, token));
    });
    return map;
  }

  const fixedColumns = new Set(['id', 'professorid', 'name', 'professorname']);
  const timeColumns = headers.filter((h) => !fixedColumns.has(normalizeHeader(h)));

  data.forEach((row) => {
    const profId = pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']);
    const profName = pickValue(row, ['name', 'Name', 'professorName', 'ProfessorName']);
    const aliases = buildProfessorAliases(profId, profName);
    if (aliases.length === 0) return;

    timeColumns.forEach((column) => {
      if (!isAvailableCell(row[column])) return;
      addResolvedSlots(aliases, column);
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
      issues.push({ type: 'error', message: `時段 ID 重複：${s.id}` });
    }
    seenSlotIds.add(s.id);
  });

  students.forEach((s) => {
    if (!profIds.has(s.supervisorId)) {
      issues.push({
        type: 'error',
        message: `學生 ${s.name}（${s.id}）的指導教授不存在：${s.supervisorId}`,
      });
    }
    if (!profIds.has(s.observerId)) {
      issues.push({
        type: 'error',
        message: `學生 ${s.name}（${s.id}）的口試教授不存在：${s.observerId}`,
      });
    }
    if (s.supervisorId === s.observerId) {
      issues.push({
        type: 'error',
        message: `學生 ${s.name}（${s.id}）的指導教授與口試教授不可相同：${s.supervisorId}`,
      });
    }
  });

  rooms.forEach((r) => {
    r.availableSlotIds.forEach((sid) => {
      if (!slotIds.has(sid)) {
        issues.push({
          type: 'warning',
          message: `房間 ${r.name} 引用了不存在的時段 ID：${sid}`,
        });
      }
    });
  });

  Object.entries(profAvailability).forEach(([pid, pSlots]) => {
    pSlots.forEach((sid) => {
      if (!slotIds.has(sid)) {
        issues.push({
          type: 'warning',
          message: `教授 ${pid} 引用了不存在的時段 ID：${sid}`,
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
        message: `教授 ${pid} 需參與 ${load} 場，但僅有 ${availableCount} 個可用時段。`,
      });
    }
  });

  return {
    isValid: !issues.some((i) => i.type === 'error'),
    issues,
  };
};
