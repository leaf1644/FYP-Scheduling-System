// File: fyp-排程系統-(fyp-scheduler)/utils/csvHelper.ts

import Papa from 'papaparse';
import { Student, Slot, Room, ValidationResult } from '../types';

const parseCSV = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (error) => reject(error),
    });
  });
};

const splitList = (str: string | undefined): string[] => {
  if (!str) return [];
  return str.split(/[,;|]/).map(s => s.trim()).filter(Boolean);
};

export const parseStudents = async (file: File): Promise<Student[]> => {
  const data = await parseCSV(file);
  return data.map((row: any) => ({
    id: row['id'] || row['ID'] || '',
    name: row['name'] || row['Name'] || '',
    supervisorId: row['supervisorId'] || row['SupervisorId'] || row['supervisor'] || '',
    observerId: row['observerId'] || row['ObserverId'] || row['observer'] || '',
  })).filter(s => s.id && s.name);
};

export const parseSlots = async (file: File): Promise<Slot[]> => {
  const data = await parseCSV(file);
  return data.map((row: any) => ({
    id: row['id'] || row['ID'] || '',
    timeLabel: row['timeLabel'] || row['TimeLabel'] || row['time'] || '',
  })).filter(s => s.id && s.timeLabel);
};

export const parseRooms = async (file: File): Promise<Room[]> => {
  const data = await parseCSV(file);
  return data.map((row: any) => ({
    id: row['id'] || row['ID'] || '',
    name: row['name'] || row['Name'] || '',
    capacity: parseInt(row['capacity'] || row['Capacity'] || '1', 10),
    availableSlotIds: splitList(row['availableSlots'] || row['AvailableSlots']),
  })).filter(r => r.id && r.name);
};

export const parseAvailability = async (file: File): Promise<Record<string, Set<string>>> => {
  const data = await parseCSV(file);
  const map: Record<string, Set<string>> = {};

  data.forEach((row: any) => {
    const profId = row['professorId'] || row['ProfessorId'] || row['id'] || '';
    const slotsStr = row['availableSlots'] || row['AvailableSlots'] || '';
    
    if (profId) {
      if (!map[profId]) {
        map[profId] = new Set();
      }
      const slots = splitList(slotsStr);
      slots.forEach(s => map[profId].add(s));
    }
  });
  
  return map;
};

// --- Enhanced Validation Logic ---

export const validateData = (
  students: Student[],
  rooms: Room[],
  slots: Slot[],
  profAvailability: Record<string, Set<string>>
): ValidationResult => {
  const issues: any[] = [];
  const slotIds = new Set(slots.map(s => s.id));
  const profIds = new Set(Object.keys(profAvailability));
  const seenSlotIds = new Set<string>();

  // 1. Slots Integrity
  slots.forEach(s => {
    if (seenSlotIds.has(s.id)) {
      issues.push({ type: 'error', message: `時段 ID '${s.id}' 重複定義。` });
    }
    seenSlotIds.add(s.id);
  });

  // 2. Student Logic
  students.forEach(s => {
    if (!profIds.has(s.supervisorId)) {
      issues.push({ type: 'error', message: `學生 ${s.name} (${s.id}) 的導師 '${s.supervisorId}' 不在教授清單中。` });
    }
    if (!profIds.has(s.observerId)) {
      issues.push({ type: 'error', message: `學生 ${s.name} (${s.id}) 的觀察員 '${s.observerId}' 不在教授清單中。` });
    }
    if (s.supervisorId === s.observerId) {
      issues.push({ type: 'error', message: `學生 ${s.name} (${s.id}) 的導師與觀察員不能是同一人 (${s.supervisorId})。` });
    }
  });

  // 3. Room & Prof Slot References
  rooms.forEach(r => {
    r.availableSlotIds.forEach(sid => {
      if (!slotIds.has(sid)) {
        issues.push({ type: 'warning', message: `房間 ${r.name} 引用了不存在的時段 ID '${sid}'。` });
      }
    });
  });

  Object.entries(profAvailability).forEach(([pid, pSlots]) => {
    pSlots.forEach(sid => {
      if (!slotIds.has(sid)) {
        issues.push({ type: 'warning', message: `教授 ${pid} 引用了不存在的時段 ID '${sid}'。` });
      }
    });
  });

  // 4. Professor Load vs Availability (Heuristic Warning)
  const profLoad: Record<string, number> = {};
  students.forEach(s => {
    profLoad[s.supervisorId] = (profLoad[s.supervisorId] || 0) + 1;
    profLoad[s.observerId] = (profLoad[s.observerId] || 0) + 1;
  });

  Object.entries(profLoad).forEach(([pid, load]) => {
    const availableCount = profAvailability[pid]?.size || 0;
    // 修正: 語氣不要太絕對
    if (availableCount < load) {
      issues.push({ 
        type: 'warning', 
        message: `教授 ${pid} 需要出席 ${load} 次，但只提供了 ${availableCount} 個空閒時段。除非有合併演示，否則可能資源不足。` 
      });
    }
  });

  return {
    isValid: issues.filter(i => i.type === 'error').length === 0,
    issues
  };
};