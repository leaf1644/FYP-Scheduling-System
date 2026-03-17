// File: fyp-scheduler/App.tsx

import React, { useState } from 'react';
import { Bot, Play, AlertCircle, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ProfPreferenceInput from './components/ProfPreferenceInput';
import ScheduleDashboard from './components/ScheduleDashboard';
import { deriveSlots, parseStudents, parseRooms, parseAvailability, validateData } from './utils/csvHelper';
import type { AvailabilityResolveStrategy } from './utils/csvHelper';
import { generateSchedule, type SolverMode } from './utils/scheduler';
import { Slot, RoomSlot, ScheduleResult, SolvingStatus, ValidationResult, ProfPreference } from './types';

interface AiAdviceResponse {
  bottleneck_professors?: string[];
  analysis: string;
  suggestions?: string[];
}

const PROF_AVAILABILITY_RESOLVE_STRATEGY: AvailabilityResolveStrategy = 'overlap';

const App: React.FC = () => {
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [roomFile, setRoomFile] = useState<File | null>(null);
  const [slotsFile, setSlotsFile] = useState<File | null>(null);
  const [profFile, setProfFile] = useState<File | null>(null);

  const [status, setStatus] = useState<SolvingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleResult | null>(null);
  const [solverMode, setSolverMode] = useState<SolverMode>('cp-sat');

  // Stored for Edit Mode calculation
  const [allRoomSlots, setAllRoomSlots] = useState<RoomSlot[]>([]);
  const [profAvailability, setProfAvailability] = useState<Record<string, Set<string>>>({});

  // Professor Preferences
  const [profPreferences, setProfPreferences] = useState<Record<string, ProfPreference>>({});
  const [availableProfessors, setAvailableProfessors] = useState<string[]>([]);

  // Gemini AI State
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<AiAdviceResponse | null>(null);

  const handleReset = () => {
    setStudentFile(null);
    setRoomFile(null);
    setSlotsFile(null);
    setProfFile(null);
    setScheduleData(null);
    setValidationResult(null);
    setStatus('idle');
    setErrorMessage('');
    setAiAdvice(null);
    setAvailableProfessors([]);
    setProfPreferences({});
  };

  // Extract professors from availability file as soon as it's uploaded
  const handleProfFileSelect = async (file: File | null) => {
    setProfFile(file);
    if (file) {
      try {
        const profsData = await parseAvailability(file, undefined, {
          resolveStrategy: PROF_AVAILABILITY_RESOLVE_STRATEGY,
        });
        const profIds = Object.keys(profsData).sort();
        setAvailableProfessors(profIds);
        setProfAvailability(profsData);
      } catch (err) {
        console.warn('Could not extract professors from file yet:', err);
        setAvailableProfessors([]);
      }
    } else {
      setAvailableProfessors([]);
      setProfPreferences({});
      setProfAvailability({});
    }
  };

  const startProcessing = async () => {
    if (!studentFile || !roomFile || !profFile) {
      setErrorMessage('請至少上傳學生、房間與教授可用時間 3 份檔案。');
      return;
    }

    setStatus('parsing');
    setErrorMessage('');
    setValidationResult(null);

    try {
      // 1. Parse Data
      const slotsData = await deriveSlots({
        slotsFile,
        roomFile,
        availabilityFile: profFile,
      });
      if (slotsData.length === 0) {
        throw new Error('找不到任何可用時段。請上傳時段檔，或使用包含日期與時段欄位的房間/教授檔案。');
      }

      const roomsData = await parseRooms(roomFile, slotsData);
      const profsData = await parseAvailability(profFile, slotsData, {
        resolveStrategy: PROF_AVAILABILITY_RESOLVE_STRATEGY,
      });
      const studentsData = await parseStudents(studentFile);

      setProfAvailability(profsData);

      // 2. Validate Data (Logic Check)
      setStatus('validating');
      const valResult = validateData(studentsData, roomsData, slotsData, profsData);
      setValidationResult(valResult);

      if (!valResult.isValid) {
        setStatus('error');
        setErrorMessage('資料驗證失敗，請檢查 CSV 內容與 ID 對應。');
        return;
      }

      // 3. Pre-process Relational Data for Solver
      const slotMap = new Map<string, Slot>();
      slotsData.forEach((s) => slotMap.set(s.id, s));
      const generatedRoomSlots: RoomSlot[] = [];

      roomsData.forEach((room) => {
        room.availableSlotIds.forEach((slotId) => {
          const slot = slotMap.get(slotId);
          if (slot) {
            generatedRoomSlots.push({
              id: `${room.id}::${slot.id}`,
              roomId: room.id,
              roomName: room.name,
              slotId: slot.id,
              timeLabel: slot.timeLabel,
            });
          }
        });
      });

      setAllRoomSlots(generatedRoomSlots);

      // 4. Solve (Worker) - Pass profPreferences
      setStatus('solving');
      try {
        const result = await generateSchedule(
          studentsData,
          generatedRoomSlots,
          profsData,
          profPreferences,
          {
            timeoutMs: Math.max(1500, studentsData.length * 120),
            solverMode,
          }
        );
        setScheduleData(result);
        setStatus(result.success ? 'success' : 'partial');
      } catch (err: any) {
        setStatus('failed');
        setErrorMessage(err.message || '排程計算失敗。');
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || '檔案解析失敗，請確認 CSV 格式。');
    }
  };

  const handleAskAi = async () => {
    if (!scheduleData) return;

    setIsAskingAi(true);

    try {
      const failedAssignments = scheduleData.unscheduled.slice(0, 15).map((u) => ({
        supervisorId: u.student.supervisorId,
        observerId: u.student.observerId,
        reason: u.reason,
      }));

      const response = await fetch('/api/ai-advice', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ failedAssignments }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'AI 分析失敗');
      }

      setAiAdvice(data);
    } catch (e: any) {
      console.error('AI request error:', e);
      const errorMsg = e?.message || 'AI 分析失敗，請稍後再試';
      setAiAdvice({ analysis: errorMsg, suggestions: [] });
      setErrorMessage(`AI 分析失敗: ${errorMsg}`);
    } finally {
      setIsAskingAi(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-violet-600">
              FYP AutoScheduler Pro
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {status === 'partial' && (
              <button
                onClick={handleAskAi}
                disabled={isAskingAi || !!aiAdvice}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-full shadow-sm hover:shadow-md transition-all"
              >
                {isAskingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                AI 分析建議
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {validationResult && !validationResult.isValid && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-6">
            <h3 className="text-lg font-bold text-red-800 flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5" />
              資料驗證問題
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-red-700 max-h-60 overflow-y-auto">
              {validationResult.issues.map((issue, idx) => (
                <li key={idx}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {(status === 'success' || status === 'partial') && scheduleData ? (
          <>
            {aiAdvice && (
              <div className="mb-6 bg-purple-50 border border-purple-200 rounded-xl p-6 relative">
                <h3 className="text-md font-bold text-purple-900 flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  AI 分析報告
                </h3>

                {aiAdvice.bottleneck_professors &&
                  Array.isArray(aiAdvice.bottleneck_professors) &&
                  aiAdvice.bottleneck_professors.length > 0 && (
                    <div className="mb-2 text-sm">
                      <span className="font-bold text-purple-800">瓶頸教授: </span>
                      {aiAdvice.bottleneck_professors.join(', ')}
                    </div>
                  )}

                <p className="text-sm text-purple-800 leading-relaxed mb-3">{aiAdvice.analysis}</p>

                {aiAdvice.suggestions && Array.isArray(aiAdvice.suggestions) && (
                  <ul className="list-disc list-inside text-sm text-purple-800 space-y-1 bg-white/50 p-3 rounded-lg">
                    {aiAdvice.suggestions.map((s: string, i: number) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}

                <button
                  onClick={() => setAiAdvice(null)}
                  className="absolute top-4 right-4 text-purple-400 hover:text-purple-600"
                >
                  &times;
                </button>
              </div>
            )}
            <ScheduleDashboard
              schedule={scheduleData}
              onReset={handleReset}
              allRoomSlots={allRoomSlots}
              profAvailability={profAvailability}
            />
          </>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-4">智慧 FYP 口試排程系統 v4.1</h2>
              <p className="text-lg text-gray-600">Web Worker | 軟限制優化 | 資料驗證 | 手動調整</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-8">
                {(status === 'error' || status === 'failed') && (
                  <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-bold text-red-800">執行失敗</h3>
                      <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FileUpload
                    label="1. 學生資料 (Students)"
                    description="支援兩種格式：id/name/supervisorId/observerId，或 Students/Supervisor/Observer"
                    file={studentFile}
                    onFileSelect={setStudentFile}
                  />
                  <FileUpload
                    label="2. 時段資料 (Slots，可選)"
                    description="可省略；系統會嘗試從房間檔或教授檔自動抽取時段"
                    requiredHeaders={['id', 'timeLabel']}
                    file={slotsFile}
                    onFileSelect={setSlotsFile}
                  />
                  <FileUpload
                    label="3. 房間資料 (Rooms)"
                    description="支援兩種格式：id/name/availableSlots，或 Date + Time Slot + Venue"
                    file={roomFile}
                    onFileSelect={setRoomFile}
                  />
                  <FileUpload
                    label="4. 教授可用時間 (Availability)"
                    description="支援兩種格式：professorId + availableSlots，或 ID + Name + 各時段欄位"
                    file={profFile}
                    onFileSelect={handleProfFileSelect}
                  />
                </div>

                {availableProfessors.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <ProfPreferenceInput professorIds={availableProfessors} onPreferencesChange={setProfPreferences} />
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">求解器</label>
                    <select
                      value={solverMode}
                      onChange={(e) => setSolverMode(e.target.value as SolverMode)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    >
                      <option value="cp-sat">CP-SAT（推薦）</option>
                      <option value="legacy">Legacy Worker</option>
                    </select>
                    <p className="mt-2 text-xs text-gray-500">
                      `CP-SAT` 會呼叫本地 Python `ortools` API；`Legacy Worker` 則使用原本的前端 heuristic solver。
                    </p>
                  </div>
                  <button
                    onClick={startProcessing}
                    disabled={status === 'parsing' || status === 'solving' || status === 'validating'}
                    className={`
                      w-full py-4 px-6 rounded-xl flex items-center justify-center gap-3 text-lg font-bold transition-all transform hover:scale-[1.02] active:scale-[0.98]
                      ${(status !== 'idle' && status !== 'error' && status !== 'failed')
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-200 hover:shadow-indigo-300'}
                    `}
                  >
                    {status === 'parsing' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> 解析資料中...
                      </>
                    )}
                    {status === 'validating' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> 驗證資料中...
                      </>
                    )}
                    {status === 'solving' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> 正在產生排程...
                      </>
                    )}
                    {(status === 'idle' || status === 'error' || status === 'failed') && (
                      <>
                        <Play className="w-6 h-6 fill-current" /> 開始自動排程
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
