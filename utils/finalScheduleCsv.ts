import Papa from 'papaparse';
import { ScheduleAssignment, UnscheduledStudent } from '../types';

interface FinalScheduleCsvLabels {
  scheduled: string;
  unscheduled: string;
}

const UTF8_BOM = '\uFEFF';

const formatProfessorLabel = (id: string, name?: string): string => {
  return name ? `${id} ${name}` : id;
};

export const buildFinalScheduleCsv = (
  assignments: ScheduleAssignment[],
  unscheduled: UnscheduledStudent[],
  labels: FinalScheduleCsvLabels
): string => {
  const csvData = assignments.map((assignment) => ({
    Status: labels.scheduled,
    Time: assignment.roomSlot.timeLabel,
    Room: assignment.roomSlot.roomName,
    Student: assignment.student.name,
    Supervisor: formatProfessorLabel(assignment.student.supervisorId, assignment.student.supervisorName),
    Observer: formatProfessorLabel(assignment.student.observerId, assignment.student.observerName),
  }));

  unscheduled.forEach((item) => {
    csvData.push({
      Status: labels.unscheduled,
      Time: '',
      Room: '',
      Student: item.student.name,
      Supervisor: formatProfessorLabel(item.student.supervisorId, item.student.supervisorName),
      Observer: formatProfessorLabel(item.student.observerId, item.student.observerName),
    });
  });

  return Papa.unparse(csvData);
};

export const createFinalScheduleCsvBlob = (
  assignments: ScheduleAssignment[],
  unscheduled: UnscheduledStudent[],
  labels: FinalScheduleCsvLabels
): Blob => {
  return new Blob([UTF8_BOM, buildFinalScheduleCsv(assignments, unscheduled, labels)], {
    type: 'text/csv;charset=utf-8;',
  });
};

export const FINAL_SCHEDULE_CSV_FILENAME = 'fyp_schedule_final.csv';