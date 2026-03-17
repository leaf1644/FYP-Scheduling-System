import { Student, Slot, Room, ValidationResult, ValidationIssue, ProfessorOption } from '../types';
import { parseTabularFile, TabularRow } from './tabularParser';

const splitList = (str: string | undefined): string[] => {
  if (!str) return [];
  return str.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
};

const normalizeHeader = (value: string): string => value.toLowerCase().replace(/[\s_]+/g, '').trim();

const normalizeKey = (value: string): string => value.toLowerCase().replace(/\s+/g, ' ').trim();

const normalizeProfessorAlias = (value: string): string => value
  .toLowerCase()
  .replace(/[()\[\]{}_,.:;\\/|-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const monthMap: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const fallbackProfessorNameToId: Record<string, string> = {
  'Dr. CHAN, Jacky Chun Pong': 'P11',
  'Dr. CHEUNG, Jamie Y.H.': 'P35',
  'Dr. CHOY, Martin Man Ting': 'P36',
  'Dr. DUAN, Yang': 'P06',
  'Dr. LAI, Jean Hok Yin': 'P03',
  'Dr. LI, Kristen Yuanxi': 'P39',
  'Dr. LIU, Jing': 'P07',
  'Dr. MA, Shichao': 'P17',
  'Dr. SHEK, Sarah Pui Wah': 'P32',
  'Dr. WANG, Kevin King Hang': 'P26',
  'Dr. XIAN, Poline Yin': 'P04',
  'Dr. YU, Wilson Shih Bun': 'P01',
  'Dr. ZHANG, Ce': 'P31',
  'Prof. CHANG, Song': 'P40',
  'Prof. CHEN, Amy Y.Y.': 'P05',
  'Prof. CHEN, Jie': 'P22',
  'Prof. CHEN, Li': 'P19',
  'Prof. CHEN, Yifan': 'P37',
  'Prof. CHEUNG, William Kwok Wai': 'P38',
  'Prof. CHEUNG, Yiu Ming': 'P28',
  'Prof. CHOI, Byron Koon Kau': 'P25',
  'Prof. DAI, Henry Hong Ning': 'P29',
  'Prof. GUO, Xiaoqing': 'P30',
  'Prof. HAN, Bo': 'P20',
  'Prof. HUANG, Longkai': 'P18',
  'Prof. HUANG, Xin': 'P33',
  'Prof. LEUNG, Yiu Wing': 'P21',
  'Prof. LIU, Yang': 'P15',
  'Prof. MA, Jing': 'P10',
  'Prof. TAI, Samson Kin Hon': 'P02',
  'Prof. WAN, Monique Shui Ki': 'P08',
  'Prof. WAN, Renjie': 'P13',
  'Prof. WANG, Juncheng': 'P27',
  'Prof. XU, Jianliang': 'P09',
  'Prof. YANG, Renchi': 'P24',
  'Prof. YUEN, Pong Chi': 'P14',
  'Prof. ZHANG, Eric Lu': 'P34',
  'Prof. ZHOU, Amelie Chi': 'P12',
  'Prof. ZHOU, Kaiyang': 'P16',
};

const autoSlotId = (index: number): string => `AUTO_SLOT_${String(index + 1).padStart(3, '0')}`;

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

  const falseValues = new Set(['0', 'n', 'no', 'false', 'f', 'x', '-', 'na', 'n/a', 'none', 'nil', 'unavailable']);
  const trueValues = new Set(['1', 'y', 'yes', 'true', 't', 'v', 'available', 'ok', 'a']);

  if (falseValues.has(normalized)) return false;
  if (trueValues.has(normalized)) return true;
  return true;
};

export type AvailabilityResolveMode = 'containment' | 'overlap';
export type AvailabilityResolveStrategy = AvailabilityResolveMode | 'inherit-cell';

const getAvailabilityResolveMode = (
  value: unknown,
  resolveStrategy: AvailabilityResolveStrategy = 'inherit-cell'
): AvailabilityResolveMode => {
  if (resolveStrategy === 'containment' || resolveStrategy === 'overlap') {
    return resolveStrategy;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('if necessary') || normalized.includes('if needed')) {
    return 'overlap';
  }
  return 'containment';
};

interface ParseAvailabilityOptions {
  resolveStrategy?: AvailabilityResolveStrategy;
}

export interface ProfessorDirectory {
  idToName: Record<string, string>;
  aliasToId: Record<string, string>;
  options: ProfessorOption[];
}

const normalizeProfessorId = (profIdRaw: string): string => {
  const profId = profIdRaw.trim();
  if (!profId) return '';

  const compact = profId.replace(/\s+/g, '').toUpperCase();
  const prefixedMatch = compact.match(/^([A-Z]+)0*(\d+)$/);
  if (prefixedMatch) {
    const [, prefix, numericPart] = prefixedMatch;
    const n = Number(numericPart);
    if (!Number.isNaN(n)) {
      return `${prefix}${String(n).padStart(2, '0')}`;
    }
  }

  const numericOnlyMatch = compact.match(/^0*(\d+)$/);
  if (numericOnlyMatch) {
    const n = Number(numericOnlyMatch[1]);
    if (!Number.isNaN(n)) {
      return `P${String(n).padStart(2, '0')}`;
    }
  }

  return compact;
};

const extractProfessorId = (value: string): string => {
  const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
  const match = compact.match(/([A-Z]+)0*(\d+)/);
  if (!match) return '';

  const [, prefix, numericPart] = match;
  const n = Number(numericPart);
  if (Number.isNaN(n)) return '';
  return `${prefix}${String(n).padStart(2, '0')}`;
};

const stripProfessorIdFragments = (value: string): string => String(value || '')
  .replace(/\b[A-Za-z]+\s*0*\d+\b/g, ' ')
  .replace(/[()\[\]{}_,.:;\\/|-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const buildProfessorLabel = (id: string, name?: string): string => {
  return name ? `${id} ${name}` : id;
};

const registerProfessorAlias = (
  aliasToId: Record<string, string>,
  aliasRaw: string | undefined,
  professorId: string
) => {
  const normalized = normalizeProfessorAlias(aliasRaw || '');
  if (!normalized) return;
  aliasToId[normalized] = professorId;
};

const resolveProfessorReference = (
  value: string,
  professorDirectory?: ProfessorDirectory
): { id: string; name?: string } => {
  const raw = String(value || '').trim();
  if (!raw) return { id: '' };

  const normalizedId = normalizeProfessorId(raw);
  if (!professorDirectory) {
    return { id: normalizedId };
  }

  if (professorDirectory.idToName[normalizedId] || professorDirectory.options.some((option) => option.id === normalizedId)) {
    return { id: normalizedId, name: professorDirectory.idToName[normalizedId] };
  }

  const extractedId = extractProfessorId(raw);
  if (extractedId && (professorDirectory.idToName[extractedId] || professorDirectory.options.some((option) => option.id === extractedId))) {
    return { id: extractedId, name: professorDirectory.idToName[extractedId] };
  }

  const aliasCandidates = [
    normalizeProfessorAlias(raw),
    normalizeProfessorAlias(stripProfessorIdFragments(raw)),
  ].filter(Boolean);

  for (const candidate of aliasCandidates) {
    const resolvedId = professorDirectory.aliasToId[candidate];
    if (resolvedId) {
      return { id: resolvedId, name: professorDirectory.idToName[resolvedId] };
    }
  }

  return { id: normalizedId || raw };
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

const getMonthDayKey = (raw: string): string | null => {
  const cleaned = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const monthToken = cleaned.split(' ').find((token) => monthMap[token] !== undefined);
  const dayMatch = cleaned.match(/\b(\d{1,2})\b/);

  if (!monthToken || !dayMatch) return null;

  const month = monthMap[monthToken];
  const day = Number(dayMatch[1]);
  if (!month || day < 1 || day > 31) return null;

  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseClockToMinutes = (raw: string, fallbackMeridiem?: 'am' | 'pm'): number | null => {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const explicitMeridiem = (match[3]?.toLowerCase() as 'am' | 'pm' | undefined);
  const meridiem = explicitMeridiem || fallbackMeridiem;

  if (!meridiem) {
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

  const dayPrefix = match[1].trim();
  const dayKey = getMonthDayKey(dayPrefix) || normalizeKey(dayPrefix);
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

const buildSlotResolvers = (slots: Slot[]) => {
  const slotKeyToId: Record<string, string> = {};
  const slotTimeMeta: SlotTimeMeta[] = [];

  slots.forEach((slot) => {
    slotKeyToId[normalizeKey(slot.id)] = slot.id;
    slotKeyToId[normalizeKey(slot.timeLabel)] = slot.id;

    const parsed = parseTimeRange(slot.timeLabel) || parseTimeRange(slot.id);
    if (parsed) {
      slotTimeMeta.push({ id: slot.id, range: parsed });
    }
  });

  return { slotKeyToId, slotTimeMeta };
};

const resolveAvailabilityToken = (
  token: string,
  slotKeyToId: Record<string, string>,
  slotTimeMeta: SlotTimeMeta[],
  resolveMode: AvailabilityResolveMode = 'containment'
): string[] => {
  const normalizedToken = normalizeKey(token);
  const exactSlotId = slotKeyToId[normalizedToken];
  if (exactSlotId) return [exactSlotId];

  const range = parseTimeRange(token);
  if (!range) return [token];

  const matched = slotTimeMeta
    .filter(({ range: slotRange }) => {
      if (range.dayKey && slotRange.dayKey && range.dayKey !== slotRange.dayKey) return false;
      if (resolveMode === 'overlap') {
        return slotRange.startMinutes < range.endMinutes && slotRange.endMinutes > range.startMinutes;
      }
      return slotRange.startMinutes >= range.startMinutes && slotRange.endMinutes <= range.endMinutes;
    })
    .map(({ id }) => id);

  return matched.length > 0 ? matched : [token];
};

const compareSlotLabels = (left: string, right: string): number => {
  const leftRange = parseTimeRange(left);
  const rightRange = parseTimeRange(right);

  if (leftRange && rightRange) {
    if (leftRange.dayKey !== rightRange.dayKey) return leftRange.dayKey.localeCompare(rightRange.dayKey);
    if (leftRange.startMinutes !== rightRange.startMinutes) return leftRange.startMinutes - rightRange.startMinutes;
    return leftRange.endMinutes - rightRange.endMinutes;
  }

  return left.localeCompare(right);
};

const buildAutoSlots = (labels: string[]): Slot[] => {
  return Array.from(new Set(labels.map((label) => label.trim()).filter(Boolean)))
    .sort(compareSlotLabels)
    .map((timeLabel, index) => ({
      id: autoSlotId(index),
      timeLabel,
    }));
};

const getRoomScheduleLabel = (row: TabularRow): string => {
  const dateLabel = pickValue(row, ['date', 'Date']);
  const timeLabel = pickValue(row, ['timeSlot', 'Time Slot', 'time', 'Time']);
  return [dateLabel, timeLabel].filter(Boolean).join(' ').trim();
};

const extractRoomScheduleLabels = (data: TabularRow[]): string[] => data.map(getRoomScheduleLabel).filter(Boolean);

const extractAvailabilityHeaderLabels = (data: TabularRow[]): string[] => {
  if (data.length === 0) return [];

  const firstRow = data[0] || {};
  const fixedColumns = new Set(['id', 'professorid', 'name', 'professorname', 'remarks', 'remark', 'note', 'notes']);

  return Object.keys(firstRow).filter((header) => {
    const normalized = normalizeHeader(header);
    if (fixedColumns.has(normalized)) return false;
    return parseTimeRange(header) !== null;
  });
};

const isRoomScheduleFormat = (headers: string[]): boolean => {
  const normalizedHeaders = new Set(headers.map((header) => normalizeHeader(header)));
  return normalizedHeaders.has('date') &&
    (normalizedHeaders.has('timeslot') || normalizedHeaders.has('time')) &&
    (normalizedHeaders.has('venue') || normalizedHeaders.has('room') || normalizedHeaders.has('name'));
};

export const deriveSlots = async ({
  slotsFile,
  roomFile,
  availabilityFile,
}: {
  slotsFile?: File | null;
  roomFile?: File | null;
  availabilityFile?: File | null;
}): Promise<Slot[]> => {
  if (slotsFile) {
    const explicitSlots = await parseSlots(slotsFile);
    if (explicitSlots.length > 0) return explicitSlots;
  }

  if (roomFile) {
    const roomData = await parseTabularFile(roomFile);
    const roomLabels = extractRoomScheduleLabels(roomData);
    if (roomLabels.length > 0) return buildAutoSlots(roomLabels);
  }

  if (availabilityFile) {
    const availabilityData = await parseTabularFile(availabilityFile);
    const availabilityLabels = extractAvailabilityHeaderLabels(availabilityData);
    if (availabilityLabels.length > 0) return buildAutoSlots(availabilityLabels);
  }

  return [];
};

export const buildProfessorDirectory = async (file: File): Promise<ProfessorDirectory> => {
  const data = await parseTabularFile(file);
  const idToName: Record<string, string> = {};
  const aliasToId: Record<string, string> = {};

  Object.entries(fallbackProfessorNameToId).forEach(([name, id]) => {
    idToName[id] = name;
    registerProfessorAlias(aliasToId, id, id);
    registerProfessorAlias(aliasToId, name, id);
    registerProfessorAlias(aliasToId, `${id} ${name}`, id);
    registerProfessorAlias(aliasToId, `${name} ${id}`, id);
  });

  data.forEach((row) => {
    const professorId = normalizeProfessorId(pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']));
    const professorName = pickValue(row, ['professorName', 'ProfessorName', 'name', 'Name']);
    if (!professorId) return;

    if (professorName && !idToName[professorId]) {
      idToName[professorId] = professorName;
    }

    registerProfessorAlias(aliasToId, professorId, professorId);
    registerProfessorAlias(aliasToId, professorName, professorId);
    registerProfessorAlias(aliasToId, `${professorId} ${professorName}`, professorId);
    registerProfessorAlias(aliasToId, `${professorName} ${professorId}`, professorId);
  });

  const options = Object.keys(aliasToId)
    .map((alias) => aliasToId[alias])
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort()
    .map((id) => ({
      id,
      name: idToName[id],
      label: buildProfessorLabel(id, idToName[id]),
    }));

  return { idToName, aliasToId, options };
};

export const parseStudents = async (file: File, professorDirectory?: ProfessorDirectory): Promise<Student[]> => {
  const data = await parseTabularFile(file);
  return data
    .map((row, index) => {
      const supervisor = resolveProfessorReference(
        pickValue(row, ['supervisorId', 'SupervisorId', 'supervisor', 'Supervisor']),
        professorDirectory
      );
      const observer = resolveProfessorReference(
        pickValue(row, ['observerId', 'ObserverId', 'observer', 'Observer']),
        professorDirectory
      );

      return {
        id: pickValue(row, ['id', 'ID', 'studentId', 'StudentID']) || `S${index + 1}`,
        name: pickValue(row, ['name', 'Name', 'student', 'Student', 'students', 'Students']),
        supervisorId: supervisor.id,
        observerId: observer.id,
        supervisorName: supervisor.name,
        observerName: observer.name,
      };
    })
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

export const parseRooms = async (file: File, slots?: Slot[]): Promise<Room[]> => {
  const data = await parseTabularFile(file);
  if (data.length === 0) return [];

  const headers = Object.keys(data[0] || {});
  const headerSet = new Set(headers.map((header) => normalizeHeader(header)));

  if (headerSet.has('availableslots')) {
    return data
      .map((row) => ({
        id: pickValue(row, ['id', 'ID']),
        name: pickValue(row, ['name', 'Name']),
        capacity: parseInt(pickValue(row, ['capacity', 'Capacity']) || '1', 10),
        availableSlotIds: splitList(pickValue(row, ['availableSlots', 'AvailableSlots'])),
      }))
      .filter((r) => r.id && r.name);
  }

  if (!isRoomScheduleFormat(headers)) return [];

  const effectiveSlots = slots && slots.length > 0 ? slots : buildAutoSlots(extractRoomScheduleLabels(data));
  const { slotKeyToId, slotTimeMeta } = buildSlotResolvers(effectiveSlots);
  const rooms = new Map<string, Room>();

  data.forEach((row) => {
    const roomName = pickValue(row, ['venue', 'Venue', 'room', 'Room', 'name', 'Name']).trim();
    const slotLabel = getRoomScheduleLabel(row);
    const hasExistingAssignment = Boolean(
      pickValue(row, ['student', 'Student']) ||
      pickValue(row, ['supervisor', 'Supervisor']) ||
      pickValue(row, ['observer', 'Observer'])
    );

    if (!roomName || !slotLabel || hasExistingAssignment) return;

    const resolvedSlotIds = resolveAvailabilityToken(slotLabel, slotKeyToId, slotTimeMeta);
    if (!rooms.has(roomName)) {
      rooms.set(roomName, {
        id: roomName,
        name: roomName,
        capacity: 1,
        availableSlotIds: [],
      });
    }

    const room = rooms.get(roomName)!;
    resolvedSlotIds.forEach((slotId) => {
      if (!room.availableSlotIds.includes(slotId)) {
        room.availableSlotIds.push(slotId);
      }
    });
  });

  return Array.from(rooms.values()).filter((room) => room.availableSlotIds.length > 0);
};

export const parseAvailability = async (
  file: File,
  slots?: Slot[],
  options?: ParseAvailabilityOptions
): Promise<Record<string, Set<string>>> => {
  const data = await parseTabularFile(file);
  const map: Record<string, Set<string>> = {};
  const { slotKeyToId, slotTimeMeta } = buildSlotResolvers(slots || []);
  const resolveStrategy = options?.resolveStrategy ?? 'inherit-cell';

  const addResolvedSlots = (
    profId: string,
    token: string,
    resolveMode: AvailabilityResolveMode = 'containment'
  ) => {
    if (!profId) return;
    const resolvedSlotIds = resolveAvailabilityToken(token, slotKeyToId, slotTimeMeta, resolveMode);
    if (!map[profId]) map[profId] = new Set();
    resolvedSlotIds.forEach((slotId) => map[profId].add(slotId));
  };

  if (data.length === 0) return map;

  const firstRow = data[0] || {};
  const headers = Object.keys(firstRow);
  const headerSet = new Set(headers.map((h) => normalizeHeader(h)));
  const isCompactFormat = headerSet.has('availableslots');

  if (isCompactFormat) {
    data.forEach((row) => {
      const profId = normalizeProfessorId(pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']));
      const slotsStr = pickValue(row, ['availableSlots', 'AvailableSlots']);
      if (!profId) return;
      const resolveMode = getAvailabilityResolveMode(slotsStr, resolveStrategy);
      splitList(slotsStr).forEach((token) => addResolvedSlots(profId, token, resolveMode));
    });
    return map;
  }

  const fixedColumns = new Set(['id', 'professorid', 'name', 'professorname', 'remarks', 'remark', 'note', 'notes']);
  const timeColumns = headers.filter((header) => {
    const normalized = normalizeHeader(header);
    if (fixedColumns.has(normalized)) return false;
    return parseTimeRange(header) !== null || Boolean(slotKeyToId[normalizeKey(header)]);
  });

  data.forEach((row) => {
    const profId = normalizeProfessorId(pickValue(row, ['professorId', 'ProfessorId', 'id', 'ID']));
    if (!profId) return;

    timeColumns.forEach((column) => {
      const cellValue = row[column];
      if (!isAvailableCell(cellValue)) return;
      addResolvedSlots(profId, column, getAvailabilityResolveMode(cellValue, resolveStrategy));
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
