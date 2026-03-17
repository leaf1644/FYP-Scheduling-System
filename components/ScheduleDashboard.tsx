// File: fyp-scheduler/components/ScheduleDashboard.tsx

import React, { useMemo, useState, useEffect } from 'react';
import { ScheduleResult, RoomSlot, Student } from '../types';
import { Calendar, Download, AlertTriangle, Briefcase, Edit2, CheckCircle } from 'lucide-react';
import Papa from 'papaparse';
import { useI18n } from '../i18n';

interface Props {
  schedule: ScheduleResult;
  onReset: () => void;
  allRoomSlots: RoomSlot[];
  profAvailability: Record<string, Set<string>>;
}

const looksCorrupted = (text: string): boolean => /[�]/.test(text) || /\?[^\s]{1,3}/.test(text);

const getReadableUnscheduledDetails = (
  reason: string,
  details: string,
  t: (key: string, values?: Record<string, string | number>) => string
): string => {
  const fallbackReasonDetails: Record<string, string> = {
    NO_COMMON_TIME: t('reasons.NO_COMMON_TIME'),
    NO_ROOM_AVAILABLE: t('reasons.NO_ROOM_AVAILABLE'),
    PROF_BUSY: t('reasons.PROF_BUSY'),
    UNKNOWN: t('reasons.UNKNOWN'),
  };

  const normalized = String(details || '').trim();
  if (!normalized || looksCorrupted(normalized)) {
    return fallbackReasonDetails[reason] || fallbackReasonDetails.UNKNOWN;
  }
  return normalized;
};

const formatProfessorLabel = (id: string, name?: string): string => {
  return name ? `${id} ${name}` : id;
};

const ScheduleDashboard: React.FC<Props> = ({ schedule, onReset, allRoomSlots, profAvailability }) => {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<'time' | 'room' | 'prof'>('time');
  const [assignments, setAssignments] = useState(schedule.assignments);
  const [unscheduled, setUnscheduled] = useState(schedule.unscheduled);

  useEffect(() => {
    setAssignments(schedule.assignments);
    setUnscheduled(schedule.unscheduled);
  }, [schedule]);

  const professorLabelMap = useMemo(() => {
    const map: Record<string, string> = {};

    [...assignments.map((item) => item.student), ...unscheduled.map((item) => item.student)].forEach((student) => {
      if (student.supervisorName) {
        map[student.supervisorId] = formatProfessorLabel(student.supervisorId, student.supervisorName);
      } else if (!map[student.supervisorId]) {
        map[student.supervisorId] = student.supervisorId;
      }

      if (student.observerName) {
        map[student.observerId] = formatProfessorLabel(student.observerId, student.observerName);
      } else if (!map[student.observerId]) {
        map[student.observerId] = student.observerId;
      }
    });

    return map;
  }, [assignments, unscheduled]);

  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);

  const groupedData = useMemo(() => {
    const groups: Record<string, typeof assignments> = {};

    if (viewMode === 'prof') {
      assignments.forEach((item) => {
        const sup = item.student.supervisorId;
        const obs = item.student.observerId;
        if (!groups[sup]) groups[sup] = [];
        groups[sup].push(item);
        if (!groups[obs]) groups[obs] = [];
        groups[obs].push(item);
      });
    } else {
      assignments.forEach((item) => {
        const key = viewMode === 'time' ? item.roomSlot.timeLabel : item.roomSlot.roomName;
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });
    }

    return Object.keys(groups)
      .sort()
      .reduce((obj, key) => {
        obj[key] = groups[key];
        return obj;
      }, {} as Record<string, typeof assignments>);
  }, [assignments, viewMode]);

  const availableMoves = useMemo(() => {
    if (!selectedStudent || !isEditMode) return new Set<string>();

    const supSlots = profAvailability[selectedStudent.supervisorId] || new Set();
    const obsSlots = profAvailability[selectedStudent.observerId] || new Set();

    const occupiedRoomSlotIds = new Set<string>();
    const busyProfSlots = new Set<string>();

    assignments.forEach((a) => {
      if (a.student.id === selectedStudent.id) return;
      occupiedRoomSlotIds.add(a.roomSlot.id);
      busyProfSlots.add(`${a.student.supervisorId}::${a.roomSlot.slotId}`);
      busyProfSlots.add(`${a.student.observerId}::${a.roomSlot.slotId}`);
    });

    const validIds = new Set<string>();

    allRoomSlots.forEach((slot) => {
      if (!supSlots.has(slot.slotId) || !obsSlots.has(slot.slotId)) return;
      if (occupiedRoomSlotIds.has(slot.id)) return;

      const supKey = `${selectedStudent.supervisorId}::${slot.slotId}`;
      const obsKey = `${selectedStudent.observerId}::${slot.slotId}`;

      if (!busyProfSlots.has(supKey) && !busyProfSlots.has(obsKey)) {
        validIds.add(slot.id);
      }
    });

    return validIds;
  }, [selectedStudent, isEditMode, assignments, allRoomSlots, profAvailability]);

  const handleStudentClick = (student: Student) => {
    if (!isEditMode) return;
    setSelectedStudent((prev) => (prev?.id === student.id ? null : student));
  };

  const handleMoveToSlot = (targetSlot: RoomSlot) => {
    if (!selectedStudent) return;

    const newAssignments = assignments.filter((a) => a.student.id !== selectedStudent.id);
    const newUnscheduled = unscheduled.filter((u) => u.student.id !== selectedStudent.id);

    newAssignments.push({ student: selectedStudent, roomSlot: targetSlot });

    setAssignments(newAssignments);
    setUnscheduled(newUnscheduled);
    setSelectedStudent(null);
  };

  const handleDownloadCSV = () => {
    const csvData = assignments.map((s) => ({
      Status: t('dashboard.csv.scheduled'),
      Time: s.roomSlot.timeLabel,
      Room: s.roomSlot.roomName,
      Student: s.student.name,
      Supervisor: formatProfessorLabel(s.student.supervisorId, s.student.supervisorName),
      Observer: formatProfessorLabel(s.student.observerId, s.student.observerName),
    }));

    unscheduled.forEach((u) => {
      csvData.push({
        Status: t('dashboard.csv.unscheduled'),
        Time: '',
        Room: '',
        Student: u.student.name,
        Supervisor: formatProfessorLabel(u.student.supervisorId, u.student.supervisorName),
        Observer: formatProfessorLabel(u.student.observerId, u.student.observerName),
      });
    });

    const csv = Papa.unparse(csvData);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'fyp_schedule_final.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {schedule.softConstraintCost !== undefined && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Briefcase className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-blue-900">{t('dashboard.softCost')}</p>
                <p className="text-xs text-blue-700 mt-0.5">{t('dashboard.softCostHint')}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-blue-900">{schedule.softConstraintCost}</p>
              <p className="text-xs text-blue-600">{t('dashboard.softCostScore')}</p>
            </div>
          </div>
        </div>
      )}

      {(unscheduled.length > 0 || isEditMode) && (
        <div
          className={`border rounded-xl p-6 shadow-sm transition-colors ${
            isEditMode ? 'bg-indigo-50 border-indigo-200' : 'bg-red-50 border-red-200'
          }`}
        >
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              <div className={`p-2 rounded-full ${isEditMode ? 'bg-indigo-200' : 'bg-red-100'}`}>
                {isEditMode ? (
                  <Edit2 className="w-6 h-6 text-indigo-700" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-red-600" />
                )}
              </div>
              <div>
                <h3 className={`text-lg font-bold ${isEditMode ? 'text-indigo-900' : 'text-red-900'}`}>
                  {isEditMode ? t('dashboard.manualMode') : t('dashboard.unscheduledCount', { count: unscheduled.length })}
                </h3>
                {isEditMode ? (
                  <p className="text-sm text-indigo-700 mt-1">
                    {t('dashboard.manualInstruction')}
                    {selectedStudent && (
                      <span className="font-bold ml-2">{t('dashboard.manualSelected', { name: selectedStudent.name })}</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-red-700 mt-1">{t('dashboard.manualPrompt')}</p>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                setIsEditMode(!isEditMode);
                setSelectedStudent(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-bold shadow-sm transition-all ${
                isEditMode ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-white border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {isEditMode ? t('dashboard.finishManual') : t('dashboard.enterManual')}
            </button>
          </div>

          {unscheduled.length > 0 && (
            <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
              {unscheduled.map((u, i) => (
                <div
                  key={i}
                  onClick={() => handleStudentClick(u.student)}
                  className={`
                    min-w-[180px] p-3 rounded-lg border cursor-pointer transition-all flex flex-col gap-1
                    ${
                      selectedStudent?.id === u.student.id
                        ? 'bg-indigo-600 text-white border-indigo-600 ring-2 ring-indigo-300'
                        : 'bg-white border-gray-200 hover:border-indigo-300 hover:shadow-md'
                    }
                  `}
                >
                  <div className="font-bold text-sm truncate">{u.student.name}</div>
                  <div className="text-xs opacity-80">{u.student.id}</div>
                  <div className="text-[10px] flex flex-col gap-1 mt-1">
                    <span className="bg-white/20 px-1 rounded">{t('dashboard.shortSupervisor')}: {formatProfessorLabel(u.student.supervisorId, u.student.supervisorName)}</span>
                    <span className="bg-white/20 px-1 rounded">{t('dashboard.shortObserver')}: {formatProfessorLabel(u.student.observerId, u.student.observerName)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 bg-gray-50 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
              <Calendar className="w-6 h-6 text-indigo-600" />
              {t('dashboard.title')}
            </h2>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="bg-white rounded-lg p-1 border border-gray-200 flex">
              <button
                onClick={() => setViewMode('time')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                  viewMode === 'time' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('dashboard.view.time')}
              </button>
              <button
                onClick={() => setViewMode('room')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                  viewMode === 'room' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('dashboard.view.room')}
              </button>
              <button
                onClick={() => setViewMode('prof')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md ${
                  viewMode === 'prof' ? 'bg-indigo-100 text-indigo-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t('dashboard.view.prof')}
              </button>
            </div>
            <button
              onClick={handleDownloadCSV}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg border border-gray-300"
              title={t('actions.downloadCsv')}
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={onReset}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              {t('actions.reupload')}
            </button>
          </div>
        </div>

        <div className="p-6 bg-gray-50/50 min-h-[500px]">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {(Object.entries(groupedData) as Array<[string, typeof assignments]>).map(([groupKey, items]) => {
              const groupLabel = viewMode === 'prof' ? (professorLabelMap[groupKey] || groupKey) : groupKey;
              return (
                <div key={groupKey} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                  <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100 flex justify-between items-center">
                    <span className="font-bold text-indigo-900 flex items-center gap-2">{groupLabel}</span>
                    <span className="text-xs bg-white px-2 py-1 rounded text-indigo-600 border border-indigo-100">{items.length}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {items.map((item, idx) => {
                      const isSup = viewMode === 'prof' && item.student.supervisorId === groupKey;
                      const isSelected = selectedStudent?.id === item.student.id;

                      return (
                        <div
                          key={idx}
                          onClick={() => handleStudentClick(item.student)}
                          className={`
                            p-4 transition-colors cursor-pointer
                            ${isSelected ? 'bg-indigo-100 border-l-4 border-indigo-500' : 'hover:bg-gray-50 border-l-4 border-transparent'}
                          `}
                        >
                          <div className="flex justify-between mb-2">
                            <span className="font-semibold text-gray-800 text-sm">{item.student.name}</span>
                            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                              {viewMode === 'time' ? item.roomSlot.roomName : item.roomSlot.timeLabel}
                            </span>
                          </div>
                          {viewMode === 'prof' && (
                            <div className="text-xs mb-2">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] ${
                                  isSup ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'
                                }`}
                              >
                                  {isSup ? t('dashboard.role.supervisor') : t('dashboard.role.observer')}
                              </span>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                            <div
                              className={
                                viewMode === 'prof' && item.student.supervisorId === groupKey ? 'font-bold text-orange-700' : ''
                              }
                            >
                              {t('dashboard.shortSupervisor')}: {formatProfessorLabel(item.student.supervisorId, item.student.supervisorName)}
                            </div>
                            <div
                              className={
                                viewMode === 'prof' && item.student.observerId === groupKey ? 'font-bold text-blue-700' : ''
                              }
                            >
                              {t('dashboard.shortObserver')}: {formatProfessorLabel(item.student.observerId, item.student.observerName)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {isEditMode && selectedStudent && (
            <div className="fixed bottom-6 right-6 w-80 bg-white rounded-xl shadow-2xl border border-indigo-200 overflow-hidden flex flex-col max-h-[400px]">
              <div className="bg-indigo-600 text-white px-4 py-3 font-bold flex justify-between items-center">
                <span>{t('dashboard.movableSlots')}</span>
                <span className="text-xs bg-indigo-500 px-2 py-0.5 rounded">{availableMoves.size}</span>
              </div>
              <div className="overflow-y-auto p-2 space-y-2 flex-1">
                {availableMoves.size === 0 ? (
                  <div className="text-center text-gray-400 py-8 text-sm">
                    {t('dashboard.noMoves')}<br />
                    {t('dashboard.noMovesHint')}
                  </div>
                ) : (
                  allRoomSlots
                    .filter((s) => availableMoves.has(s.id))
                    .map((slot) => (
                      <div
                        key={slot.id}
                        onClick={() => handleMoveToSlot(slot)}
                        className="p-3 border rounded hover:bg-green-50 hover:border-green-300 cursor-pointer group"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-gray-700 text-sm group-hover:text-green-800">{slot.timeLabel}</span>
                          <CheckCircle className="w-4 h-4 text-green-400 group-hover:text-green-600" />
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{slot.roomName}</div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {unscheduled.length > 0 && !isEditMode && (
        <div className="bg-white rounded-xl shadow-lg border border-red-200 overflow-hidden">
          <div className="bg-red-50 px-6 py-4 border-b border-red-200">
            <h3 className="text-lg font-bold text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-6 h-6" />
              {t('dashboard.unscheduledTitle', { count: unscheduled.length })}
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-red-50 border-b border-red-200">
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.student')}</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.id')}</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.reasonCode')}</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.reasonDetails')}</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.supervisor')}</th>
                  <th className="px-6 py-3 text-left text-sm font-bold text-red-900">{t('dashboard.table.observer')}</th>
                </tr>
              </thead>
              <tbody>
                {unscheduled.map((item, idx) => (
                  <tr
                    key={idx}
                    className={`border-b border-gray-200 hover:bg-red-50 transition-colors ${
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                  >
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-800">{item.student.name}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{item.student.id}</td>
                    <td className="px-6 py-4">
                      <span className="inline-block bg-red-100 text-red-800 text-xs font-semibold px-3 py-1 rounded">
                        {item.reason}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      <div className="max-w-xs">{getReadableUnscheduledDetails(item.reason, item.details, t)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-1 rounded">
                        {formatProfessorLabel(item.student.supervisorId, item.student.supervisorName)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-block bg-blue-100 text-blue-800 text-xs font-semibold px-2 py-1 rounded">
                        {formatProfessorLabel(item.student.observerId, item.student.observerName)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleDashboard;
