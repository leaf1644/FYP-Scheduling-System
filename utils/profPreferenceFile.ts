import { ProfPreference, ProfessorOption } from '../types';
import { parseTabularFile, TabularRow } from './tabularParser';
import { normalizeFacultyPriorityName } from './facultyPriority';

const normalizeHeader = (value: string): string => String(value || '').toLowerCase().replace(/[\s_]+/g, '').trim();

const pickValue = (row: TabularRow, aliases: string[]): string => {
  const normalizedEntries = Object.entries(row).map(([key, value]) => [normalizeHeader(key), value] as const);
  for (const alias of aliases) {
    const normalizedAlias = normalizeHeader(alias);
    const matched = normalizedEntries.find(([key]) => key === normalizedAlias);
    if (!matched) continue;
    const text = String(matched[1] ?? '').trim();
    if (text) return text;
  }
  return '';
};

const normalizeProfessorId = (value: string): string => String(value || '').replace(/\s+/g, '').toUpperCase();

const normalizeProfessorName = (value: string): string => normalizeFacultyPriorityName(String(value || ''));

const normalizeProfessorAlias = (value: string): string => String(value || '')
  .toLowerCase()
  .replace(/^(prof\.|professor|dr\.|doctor|lecturer)\s*/i, '')
  .replace(/[()\[\]{}_,.:;\\/|-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizePreferenceType = (value: string): ProfPreference['type'] | null => {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  if (normalized === 'CONCENTRATE' || normalized === 'GROUP' || normalized === 'PACK') return 'CONCENTRATE';
  if (normalized === 'MAX_PER_DAY' || normalized === 'MAXPERDAY' || normalized === 'DAILY_LIMIT') return 'MAX_PER_DAY';
  if (normalized === 'SPREAD' || normalized === 'DISTRIBUTE') return 'SPREAD';
  return null;
};

const clampWeight = (value: string): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 10;
  return Math.min(10, Math.max(1, Math.round(parsed)));
};

const parseOptionalTarget = (value: string): number | undefined => {
  const parsed = Number(value);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return Math.round(parsed);
};

const isDefaultPreference = (preference: ProfPreference): boolean => {
  return preference.type === 'CONCENTRATE' && preference.weight === 10 && preference.target === undefined;
};

const resolveProfessorId = (row: TabularRow, professorOptions: ProfessorOption[]): string => {
  const rawId = pickValue(row, ['professorId', 'id', 'profId', 'staffId']);
  const rawName = pickValue(row, ['professorName', 'name', 'staffName', 'professor']);

  if (rawId) {
    const normalizedId = normalizeProfessorId(rawId);
    const directMatch = professorOptions.find((option) => normalizeProfessorId(option.id) === normalizedId);
    if (directMatch) return directMatch.id;
  }

  if (rawName) {
    const normalizedName = normalizeProfessorName(rawName);
    const normalizedAlias = normalizeProfessorAlias(rawName);
    const nameMatch = professorOptions.find((option) => {
      return normalizedName === normalizeProfessorName(option.name || '')
        || normalizedName === normalizeProfessorName(option.label || '')
        || normalizedName === normalizeProfessorName(`${option.id} ${option.name || ''}`);
    });
    if (nameMatch) return nameMatch.id;

    const aliasMatch = professorOptions.find((option) => {
      return normalizedAlias === normalizeProfessorAlias(option.name || '')
        || normalizedAlias === normalizeProfessorAlias(option.label || '')
        || normalizedAlias === normalizeProfessorAlias(`${option.id} ${option.name || ''}`)
        || normalizedAlias === normalizeProfessorAlias(`${option.name || ''} ${option.id}`);
    });
    if (aliasMatch) return aliasMatch.id;
  }

  return rawId ? normalizeProfessorId(rawId) : '';
};

export const parseProfessorPreferenceFile = async (
  file: File,
  professorOptions: ProfessorOption[]
): Promise<Record<string, ProfPreference>> => {
  const rows = await parseTabularFile(file);
  const preferences: Record<string, ProfPreference> = {};
  let actionableRowCount = 0;

  rows.forEach((row) => {
    const rawType = pickValue(row, ['preferenceType', 'type', 'tendency', 'preference', 'strategy']);
    const rawProfessorId = pickValue(row, ['professorId', 'id', 'profId', 'staffId']);
    const rawProfessorName = pickValue(row, ['professorName', 'name', 'staffName', 'professor']);

    const professorId = resolveProfessorId(row, professorOptions);
    const type = normalizePreferenceType(
      rawType
    );

    if (!professorId || !type) return;

    const weight = clampWeight(pickValue(row, ['weight', 'priority', 'importance']) || '10');
    const target = parseOptionalTarget(pickValue(row, ['target', 'maxPerDay', 'dailyLimit', 'limit']));

    const preference = type === 'MAX_PER_DAY'
      ? { type, weight, target: target || 3 }
      : { type, weight };

    if (isDefaultPreference(preference)) {
      return;
    }

    actionableRowCount += 1;
    preferences[professorId] = preference;
  });

  if (actionableRowCount > 0 && Object.keys(preferences).length === 0) {
    throw new Error('No professor preference rows matched the current professor list. If your availability file only contains P-number IDs, fill the professorId column in the preference file instead of only professorName.');
  }

  return preferences;
};