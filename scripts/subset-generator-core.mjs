import path from 'node:path';
import { promises as fs } from 'node:fs';
import XLSX from 'xlsx';

const STUDENT_SUPERVISOR_ALIASES = ['supervisorId', 'SupervisorId', 'supervisor', 'Supervisor'];
const STUDENT_OBSERVER_ALIASES = ['observerId', 'ObserverId', 'observer', 'Observer'];
const PROFESSOR_ID_ALIASES = ['professorId', 'ProfessorId', 'id', 'ID'];
const PROFESSOR_NAME_ALIASES = ['professorName', 'ProfessorName', 'name', 'Name'];
const ROOM_NAME_ALIASES = ['venue', 'Venue', 'room', 'Room', 'name', 'Name'];
const DATE_ALIASES = ['date', 'Date'];
const TIME_ALIASES = ['timeSlot', 'Time Slot', 'time', 'Time'];

const normalizeHeaderName = (key) => String(key || '').replace(/^\uFEFF/, '').trim();
const normalizeHeader = (value) => normalizeHeaderName(value).toLowerCase().replace(/[\s_]+/g, '').trim();
const normalizeKey = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const normalizeProfessorAlias = (value) => String(value || '')
  .toLowerCase()
  .replace(/[()\[\]{}_,.:;\\/|-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const splitList = (str) => String(str || '')
  .split(/[,;|]/)
  .map((item) => item.trim())
  .filter(Boolean);

const monthMap = {
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

const pickValue = (row, aliases) => {
  for (const alias of aliases) {
    const value = row[alias];
    if (value !== undefined && value !== null) {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
};

const normalizeProfessorId = (profIdRaw) => {
  const profId = String(profIdRaw || '').trim();
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

  return profId;
};

const extractProfessorId = (value) => {
  const compact = String(value || '').replace(/\s+/g, '').toUpperCase();
  const match = compact.match(/([A-Z]+)0*(\d+)/);
  if (!match) return '';

  const [, prefix, numericPart] = match;
  const n = Number(numericPart);
  if (Number.isNaN(n)) return '';
  return `${prefix}${String(n).padStart(2, '0')}`;
};

const stripProfessorIdFragments = (value) => String(value || '')
  .replace(/\b[A-Za-z]+\s*0*\d+\b/g, ' ')
  .replace(/[()\[\]{}_,.:;\\/|-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const registerProfessorAlias = (aliasToId, aliasRaw, professorId) => {
  const normalized = normalizeProfessorAlias(aliasRaw || '');
  if (!normalized) return;
  aliasToId[normalized] = professorId;
};

const resolveProfessorReference = (value, professorDirectory) => {
  const raw = String(value || '').trim();
  if (!raw) return { id: '' };

  const normalizedId = normalizeProfessorId(raw);
  if (!professorDirectory) {
    return { id: normalizedId };
  }

  if (professorDirectory.idToName[normalizedId]) {
    return { id: normalizedId, name: professorDirectory.idToName[normalizedId] };
  }

  const extractedId = extractProfessorId(raw);
  if (extractedId && professorDirectory.idToName[extractedId]) {
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

const isAvailableCell = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return false;

  const falseValues = new Set(['0', 'n', 'no', 'false', 'f', 'x', '-', 'na', 'n/a', 'none', 'nil', 'unavailable']);
  const trueValues = new Set(['1', 'y', 'yes', 'true', 't', 'v', 'available', 'ok', 'a']);

  if (falseValues.has(normalized)) return false;
  if (trueValues.has(normalized)) return true;
  return true;
};

const getRoomScheduleLabel = (row) => [pickValue(row, DATE_ALIASES), pickValue(row, TIME_ALIASES)].filter(Boolean).join(' ').trim();

const getMonthDayKey = (raw) => {
  const cleaned = String(raw || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  const parts = cleaned.split(' ');
  const monthToken = parts.find((token) => monthMap[token] !== undefined);
  const dayMatch = cleaned.match(/\b(\d{1,2})\b/);
  if (!monthToken || !dayMatch) return null;

  const month = monthMap[monthToken];
  const day = Number(dayMatch[1]);
  if (!month || day < 1 || day > 31) return null;

  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const parseClockToMinutes = (raw, fallbackMeridiem) => {
  const cleaned = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const explicitMeridiem = match[3] ? match[3].toLowerCase() : undefined;
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

const parseTimeRange = (label) => {
  const normalized = String(label || '').replace(/[–—]/g, '-').trim();
  const match = normalized.match(
    /^(.*?)(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*$/i
  );
  if (!match) return null;

  const dayPrefix = match[1].trim();
  const dayKey = getMonthDayKey(dayPrefix) || normalizeKey(dayPrefix);
  const startRaw = match[2].trim();
  const endRaw = match[3].trim();

  const explicitStartMeridiem = startRaw.match(/(am|pm)\s*$/i)?.[1]?.toLowerCase();
  const explicitEndMeridiem = endRaw.match(/(am|pm)\s*$/i)?.[1]?.toLowerCase();

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

const createSeededRandom = (seedInput) => {
  let seed = 0;
  const text = String(seedInput || 'subset-seed');
  for (let i = 0; i < text.length; i += 1) {
    seed = ((seed * 31) + text.charCodeAt(i)) >>> 0;
  }

  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const computeSelectionCount = (total, options = {}) => {
  if (total <= 0) return 0;
  if (Number.isFinite(options.count) && options.count > 0) {
    return Math.min(total, Math.max(1, Math.floor(options.count)));
  }

  const fraction = Number.isFinite(options.fraction) ? options.fraction : 0.5;
  return Math.min(total, Math.max(1, Math.round(total * fraction)));
};

const selectValues = (values, options = {}) => {
  // The same selection policy is reused for room-slot labels and compact room slot tokens.
  const count = computeSelectionCount(values.length, options);
  if (options.strategy !== 'random') {
    return values.slice(0, count);
  }

  const random = createSeededRandom(options.seed);
  const indexed = values.map((value, index) => ({ value, index, sortKey: random() }));
  indexed.sort((left, right) => left.sortKey - right.sortKey || left.index - right.index);
  return indexed.slice(0, count).map((item) => item.value);
};

const selectRows = (rows, options = {}) => {
  // Student subset generation is deterministic by default and reproducible when seeded.
  const count = computeSelectionCount(rows.length, options);
  if (options.strategy !== 'random') {
    return rows.slice(0, count);
  }

  const random = createSeededRandom(options.seed);
  const indexed = rows.map((row, index) => ({ row, index, sortKey: random() }));
  indexed.sort((left, right) => left.sortKey - right.sortKey || left.index - right.index);
  return indexed.slice(0, count).map((item) => item.row);
};

const buildProfessorDirectoryFromRows = (rows) => {
  const idToName = {};
  const aliasToId = {};

  rows.forEach((row) => {
    // The subset tool reuses the same alias model as the main app so name-based student files still resolve correctly.
    const rawProfessorRef = pickValue(row, PROFESSOR_ID_ALIASES);
    const professorId = normalizeProfessorId(rawProfessorRef);
    const explicitProfessorName = pickValue(row, PROFESSOR_NAME_ALIASES);
    const professorName = explicitProfessorName || (professorId && rawProfessorRef !== professorId ? rawProfessorRef : '');
    if (!professorId) return;

    if (professorName && !idToName[professorId]) {
      idToName[professorId] = professorName;
    }

    registerProfessorAlias(aliasToId, professorId, professorId);
    registerProfessorAlias(aliasToId, professorName, professorId);
    registerProfessorAlias(aliasToId, `${professorId} ${professorName}`, professorId);
    registerProfessorAlias(aliasToId, `${professorName} ${professorId}`, professorId);
  });

  return { idToName, aliasToId };
};

const collectReferencedProfessorIds = (studentRows, professorDirectory) => {
  const referencedProfessorIds = new Set();

  studentRows.forEach((row) => {
    const supervisor = resolveProfessorReference(pickValue(row, STUDENT_SUPERVISOR_ALIASES), professorDirectory).id;
    const observer = resolveProfessorReference(pickValue(row, STUDENT_OBSERVER_ALIASES), professorDirectory).id;
    if (supervisor) referencedProfessorIds.add(supervisor);
    if (observer) referencedProfessorIds.add(observer);
  });

  return referencedProfessorIds;
};

const filterAvailabilityRows = (availabilityRows, referencedProfessorIds) => {
  return availabilityRows.filter((row) => {
    const professorId = normalizeProfessorId(pickValue(row, PROFESSOR_ID_ALIASES));
    return professorId && referencedProfessorIds.has(professorId);
  });
};

const deriveRelevantSlotsFromRoomRows = (roomRows, options = {}) => {
  if (roomRows.length === 0) {
    return { type: 'wide', slotHeaders: [], slotTokens: [], slotRanges: [] };
  }

  const headers = Object.keys(roomRows[0]);
  const headerSet = new Set(headers.map((header) => normalizeHeader(header)));

  if (headerSet.has('availableslots')) {
    // Compact room files cut by slot token directly.
    const uniqueSlotTokens = [];
    const seen = new Set();
    roomRows.forEach((row) => {
      splitList(pickValue(row, ['availableSlots', 'AvailableSlots'])).forEach((token) => {
        const normalized = normalizeKey(token);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        uniqueSlotTokens.push(token);
      });
    });

    const selectedTokens = selectValues(uniqueSlotTokens, options);
    return { type: 'compact', slotHeaders: [], slotTokens: selectedTokens, slotRanges: [] };
  }

  const isScheduleFormat = headerSet.has('date') && (headerSet.has('timeslot') || headerSet.has('time'));
  if (!isScheduleFormat) {
    return { type: 'wide', slotHeaders: [], slotTokens: [], slotRanges: [] };
  }

  // Schedule-style room files cut by distinct date/time labels instead of by room name.
  const uniqueLabels = [];
  const seen = new Set();
  roomRows.forEach((row) => {
    const label = getRoomScheduleLabel(row);
    const normalized = normalizeKey(label);
    if (!label || seen.has(normalized)) return;
    seen.add(normalized);
    uniqueLabels.push(label);
  });

  const selectedLabels = selectValues(uniqueLabels, options);
  return {
    type: 'wide',
    slotHeaders: [],
    slotTokens: selectedLabels,
    slotRanges: selectedLabels
      .map((slot) => ({ label: slot, range: parseTimeRange(slot) }))
      .filter((item) => item.range),
  };
};

const deriveRelevantSlotsFromAvailability = (availabilityRows) => {
  if (availabilityRows.length === 0) {
    return { type: 'wide', slotHeaders: [], slotTokens: [] };
  }

  const headers = Object.keys(availabilityRows[0] || {}).map((header) => normalizeHeaderName(header));
  const headerSet = new Set(headers.map((header) => normalizeHeader(header)));
  const isCompactFormat = headerSet.has('availableslots');

  if (isCompactFormat) {
    const slotTokens = new Set();
    availabilityRows.forEach((row) => {
      splitList(pickValue(row, ['availableSlots', 'AvailableSlots'])).forEach((token) => slotTokens.add(token));
    });
    return { type: 'compact', slotHeaders: [], slotTokens: Array.from(slotTokens), slotRanges: [] };
  }

  const fixedColumns = new Set(['id', 'professorid', 'name', 'professorname', 'remarks', 'remark', 'note', 'notes']);
  const timeColumns = headers.filter((header) => !fixedColumns.has(normalizeHeader(header)));
  const usedTimeColumns = timeColumns.filter((column) => availabilityRows.some((row) => isAvailableCell(row[column])));
  return {
    type: 'wide',
    slotHeaders: usedTimeColumns,
    slotTokens: usedTimeColumns,
    slotRanges: usedTimeColumns
      .map((slot) => ({ label: slot, range: parseTimeRange(slot) }))
      .filter((item) => item.range),
  };
};

const shapeRows = (rows, headers) => rows.map((row) => {
  const shaped = {};
  headers.forEach((header) => {
    shaped[header] = row[header] ?? '';
  });
  return shaped;
});

const filterAvailabilityColumns = (availabilityRows, relevantSlots) => {
  if (availabilityRows.length === 0) {
    return { rows: [], headers: Object.keys(availabilityRows[0] || {}) };
  }

  const headers = Object.keys(availabilityRows[0]);
  if (relevantSlots.type === 'compact') {
    return { rows: availabilityRows, headers };
  }

  const fixedColumns = headers.filter((header) => {
    const normalized = normalizeHeader(header);
    return ['id', 'professorid', 'name', 'professorname', 'remarks', 'remark', 'note', 'notes'].includes(normalized);
  });
  const selectedHeaders = [...fixedColumns, ...relevantSlots.slotHeaders.filter((header) => headers.includes(header))];
  return {
    rows: shapeRows(availabilityRows, selectedHeaders),
    headers: selectedHeaders,
  };
};

const preserveAvailabilityFile = (availabilityRows) => {
  // In keep-all-professors mode the availability file is copied exactly, with no row or column trimming.
  return {
    rows: availabilityRows.slice(),
    headers: Object.keys(availabilityRows[0] || {}),
  };
};

const filterRoomRows = (roomRows, relevantSlots) => {
  if (roomRows.length === 0) {
    return { rows: [], headers: [] };
  }

  const headers = Object.keys(roomRows[0]);
  const headerSet = new Set(headers.map((header) => normalizeHeader(header)));
  const slotKeySet = new Set(relevantSlots.slotTokens.map((token) => normalizeKey(token)));

  if (headerSet.has('availableslots')) {
    const filteredRows = roomRows
      .map((row) => {
        const keptSlots = splitList(pickValue(row, ['availableSlots', 'AvailableSlots']))
          .filter((token) => slotKeySet.has(normalizeKey(token)));
        if (keptSlots.length === 0) return null;
        return {
          ...row,
          availableSlots: keptSlots.join('; '),
        };
      })
      .filter(Boolean);

    return { rows: filteredRows, headers };
  }

  const isScheduleFormat = headerSet.has('date') && (headerSet.has('timeslot') || headerSet.has('time'));
  if (!isScheduleFormat) {
    return { rows: roomRows, headers };
  }

  const filteredRows = roomRows.filter((row) => {
    const roomLabel = getRoomScheduleLabel(row);
    if (slotKeySet.has(normalizeKey(roomLabel))) {
      return true;
    }

    const roomRange = parseTimeRange(roomLabel);
    if (!roomRange || !Array.isArray(relevantSlots.slotRanges) || relevantSlots.slotRanges.length === 0) {
      return false;
    }

    return relevantSlots.slotRanges.some(({ range }) => {
      if (!range || roomRange.dayKey !== range.dayKey) return false;
      return roomRange.startMinutes < range.endMinutes && roomRange.endMinutes > range.startMinutes;
    });
  });
  return { rows: filteredRows, headers };
};

const filterSlotRows = (slotRows, relevantSlots) => {
  if (!slotRows || slotRows.length === 0) {
    return { rows: [], headers: [] };
  }

  const headers = Object.keys(slotRows[0]);
  const slotKeySet = new Set(relevantSlots.slotTokens.map((token) => normalizeKey(token)));
  const filteredRows = slotRows.filter((row) => {
    const id = normalizeKey(pickValue(row, ['id', 'ID']));
    const timeLabel = normalizeKey(pickValue(row, ['timeLabel', 'TimeLabel', 'time', 'Time']));
    return slotKeySet.has(id) || slotKeySet.has(timeLabel);
  });
  return { rows: filteredRows, headers };
};

export const createSubsetData = ({
  studentRows,
  availabilityRows,
  roomRows,
  slotRows = [],
  options = {},
}) => {
  // This function can independently cut students, professors, and room-slot supply depending on options.
  const selectedStudentRows = selectRows(studentRows, options);
  const professorDirectory = buildProfessorDirectoryFromRows(availabilityRows);
  const referencedProfessorIds = collectReferencedProfessorIds(selectedStudentRows, professorDirectory);
  const keepAllProfessors = options.keepAllProfessors === true;
  const roomSlotOptions = {
    count: options.roomSlotCount,
    fraction: options.roomSlotFraction,
    strategy: options.roomSlotStrategy || options.strategy,
    seed: options.roomSlotSeed || options.seed,
  };
  const shouldCutRoomSlots = Number.isFinite(roomSlotOptions.count) || Number.isFinite(roomSlotOptions.fraction);

  const filteredAvailabilityRows = keepAllProfessors
    ? availabilityRows.slice()
    : filterAvailabilityRows(availabilityRows, referencedProfessorIds);
  const relevantSlots = shouldCutRoomSlots
    ? deriveRelevantSlotsFromRoomRows(roomRows, roomSlotOptions)
    : deriveRelevantSlotsFromAvailability(filteredAvailabilityRows);
  const availabilityOutput = keepAllProfessors
    ? preserveAvailabilityFile(filteredAvailabilityRows)
    : filterAvailabilityColumns(filteredAvailabilityRows, relevantSlots);
  const roomOutput = filterRoomRows(roomRows, relevantSlots);
  const slotOutput = filterSlotRows(slotRows, relevantSlots);

  const selectedProfessorIds = keepAllProfessors
    ? filteredAvailabilityRows
      .map((row) => pickValue(row, PROFESSOR_ID_ALIASES))
      .filter(Boolean)
    : Array.from(referencedProfessorIds);

  return {
    students: {
      rows: selectedStudentRows,
      headers: Object.keys(studentRows[0] || {}),
    },
    availability: availabilityOutput,
    rooms: roomOutput,
    slots: slotOutput,
    metadata: {
      selectionStrategy: options.strategy || 'first',
      keepAllProfessors,
      requestedCount: Number.isFinite(options.count) ? options.count : null,
      requestedFraction: Number.isFinite(options.fraction) ? options.fraction : null,
      requestedRoomSlotCount: Number.isFinite(options.roomSlotCount) ? options.roomSlotCount : null,
      requestedRoomSlotFraction: Number.isFinite(options.roomSlotFraction) ? options.roomSlotFraction : null,
      selectedStudentCount: selectedStudentRows.length,
      selectedProfessorIds: selectedProfessorIds.sort(),
      selectedSlotTokens: [...relevantSlots.slotTokens].sort((left, right) => left.localeCompare(right)),
      roomRowCount: roomOutput.rows.length,
      availabilityRowCount: availabilityOutput.rows.length,
      slotRowCount: slotOutput.rows.length,
    },
  };
};

const readRowsFromSheet = (filePath) => {
  const workbook = XLSX.readFile(filePath, { raw: false, dense: false });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { raw: false, defval: '' }).map((row) => {
    const normalized = {};
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeHeaderName(key)] = value;
    });
    return normalized;
  });
};

const writeCsvFile = async (filePath, rows, headers = []) => {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: headers, skipHeader: false });
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  await fs.writeFile(filePath, csv, 'utf8');
};

export const generateSubsetFiles = async ({
  studentPath,
  availabilityPath,
  roomPath,
  slotPath,
  outputDir,
  options = {},
}) => {
  // Read source workbooks, generate a consistent subset, then emit CSV outputs plus metadata for auditability.
  const subset = createSubsetData({
    studentRows: readRowsFromSheet(studentPath),
    availabilityRows: readRowsFromSheet(availabilityPath),
    roomRows: readRowsFromSheet(roomPath),
    slotRows: slotPath ? readRowsFromSheet(slotPath) : [],
    options,
  });

  await fs.mkdir(outputDir, { recursive: true });
  await writeCsvFile(path.join(outputDir, 'students.csv'), subset.students.rows, subset.students.headers);
  await writeCsvFile(path.join(outputDir, 'availability.csv'), subset.availability.rows, subset.availability.headers);
  await writeCsvFile(path.join(outputDir, 'rooms.csv'), subset.rooms.rows, subset.rooms.headers);
  if (slotPath) {
    await writeCsvFile(path.join(outputDir, 'slots.csv'), subset.slots.rows, subset.slots.headers);
  }
  await fs.writeFile(path.join(outputDir, 'metadata.json'), JSON.stringify(subset.metadata, null, 2), 'utf8');

  return subset;
};