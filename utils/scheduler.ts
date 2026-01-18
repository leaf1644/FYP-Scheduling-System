// File: fyp-排程系統-(fyp-scheduler)/utils/scheduler.ts

import { Student, RoomSlot, ScheduleResult } from '../types';
// 使用 Vite 的 Worker 導入語法
import SchedulerWorker from './scheduler.worker?worker';

export const generateSchedule = (
  students: Student[],
  allRoomSlots: RoomSlot[],
  profAvailability: Record<string, Set<string>>
): Promise<ScheduleResult> => {
  
  return new Promise((resolve, reject) => {
    // 1. 轉換 Set 為 Array 以便安全傳輸 (雖然現代瀏覽器支援 Set，但為了相容性建議轉)
    const safeAvailability: Record<string, string[]> = {};
    Object.entries(profAvailability).forEach(([k, v]) => {
      safeAvailability[k] = Array.from(v);
    });

    // 2. 實例化 Worker (這會加載 scheduler.worker.ts)
    const worker = new SchedulerWorker();

    worker.onmessage = (e) => {
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data);
      }
      worker.terminate(); // 完成後關閉 Worker 釋放資源
    };

    worker.onerror = (e) => {
      reject(new Error("Worker Error: " + (e.message || "Unknown")));
      worker.terminate();
    };

    // 3. 發送數據
    worker.postMessage({
      students,
      allRoomSlots,
      profAvailability: safeAvailability
    });
  });
};