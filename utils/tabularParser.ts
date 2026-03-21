import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export type TabularRow = Record<string, unknown>;

const normalizeHeaderName = (key: string): string => key.replace(/^\uFEFF/, '').trim();

const normalizeRowKeys = (row: TabularRow): TabularRow => {
  const normalized: TabularRow = {};
  Object.entries(row).forEach(([key, value]) => {
    normalized[normalizeHeaderName(key)] = value;
  });
  return normalized;
};

const isExcelFile = (file: File): boolean => /\.(xlsx|xls)$/i.test(file.name);

const parseCsvRows = (file: File): Promise<TabularRow[]> => {
  return new Promise((resolve, reject) => {
    file.text()
      .then((content) => {
        Papa.parse<TabularRow>(content, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const rows = (results.data || []).map((row) => normalizeRowKeys(row));
            resolve(rows);
          },
          error: (error) => reject(error),
        });
      })
      .catch(reject);
  });
};

const parseCsvHeaders = (file: File): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    file.text()
      .then((content) => {
        Papa.parse(content, {
          header: true,
          preview: 1,
          skipEmptyLines: true,
          complete: (results) => {
            const headers = (results.meta.fields || []).map((h) => normalizeHeaderName(h));
            resolve(headers);
          },
          error: (error) => reject(error),
        });
      })
      .catch(reject);
  });
};

const parseXlsxHeaders = async (file: File): Promise<string[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];

  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    defval: '',
  }) as unknown[][];
  const headerRow = Array.isArray(rows[0]) ? rows[0] : [];
  return headerRow.map((cell) => normalizeHeaderName(String(cell ?? ''))).filter(Boolean);
};

const parseXlsxRows = async (file: File): Promise<TabularRow[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) return [];

  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<TabularRow>(worksheet, {
    raw: false,
    defval: '',
  });
  return rows.map((row) => normalizeRowKeys(row));
};

export const parseTabularFile = async (file: File): Promise<TabularRow[]> => {
  return isExcelFile(file) ? parseXlsxRows(file) : parseCsvRows(file);
};

export const getTabularHeaders = async (file: File): Promise<string[]> => {
  return isExcelFile(file) ? parseXlsxHeaders(file) : parseCsvHeaders(file);
};
