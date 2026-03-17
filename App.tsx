// File: fyp-scheduler/App.tsx

import React, { useMemo, useState } from 'react';
import { Bot, Play, AlertCircle, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import FileUpload from './components/FileUpload';
import ProfPreferenceInput from './components/ProfPreferenceInput';
import ScheduleDashboard from './components/ScheduleDashboard';
import { buildProfessorDirectory, deriveSlots, parseStudents, parseRooms, parseAvailability, validateData } from './utils/csvHelper';
import type { AvailabilityResolveStrategy } from './utils/csvHelper';
import { generateSchedule, type SolverMode } from './utils/scheduler';
import { Slot, RoomSlot, ScheduleResult, SolvingStatus, ValidationResult, ProfPreference, ProfessorOption } from './types';
import { I18nProvider, languageOptions, localizeValidationIssue, useI18n } from './i18n';

interface AiAdviceResponse {
  bottleneck_professors?: string[];
  analysis: string;
  suggestions?: string[];
}

const PROF_AVAILABILITY_RESOLVE_STRATEGY: AvailabilityResolveStrategy = 'overlap';

const normalizeUiMessage = (message: string, t: (key: string) => string): string => {
  switch (message) {
    case 'CP-SAT 求解失敗':
      return t('errors.scheduleFailed');
    case 'PuLP ILP 求解失敗':
      return t('errors.scheduleFailed');
    case 'Legacy Python 求解失敗':
      return t('errors.scheduleFailed');
    case 'AI 分析失敗':
      return t('errors.aiFailed');
    case 'AI 分析失敗，請稍後再試':
      return t('errors.aiFailedRetry');
    default:
      return message;
  }
};

const AppContent: React.FC = () => {
  const { locale, setLocale, t } = useI18n();
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
  const [availableProfessors, setAvailableProfessors] = useState<ProfessorOption[]>([]);

  // Gemini AI State
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<AiAdviceResponse | null>(null);

  const localizedValidationIssues = useMemo(
    () => validationResult?.issues.map((issue) => ({ ...issue, message: localizeValidationIssue(issue.message, t) })) ?? [],
    [validationResult, t]
  );

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
        const professorDirectory = await buildProfessorDirectory(file);
        const profsData = await parseAvailability(file, undefined, {
          resolveStrategy: PROF_AVAILABILITY_RESOLVE_STRATEGY,
          professorDirectory,
        });
        setAvailableProfessors(professorDirectory.options);
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
      setErrorMessage(t('errors.requiredFiles'));
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
        throw new Error(t('errors.noSlotsFound'));
      }

      const roomsData = await parseRooms(roomFile, slotsData);
      const professorDirectory = await buildProfessorDirectory(profFile);
      const profsData = await parseAvailability(profFile, slotsData, {
        resolveStrategy: PROF_AVAILABILITY_RESOLVE_STRATEGY,
        professorDirectory,
      });
      const studentsData = await parseStudents(studentFile, professorDirectory);

      setProfAvailability(profsData);
      setAvailableProfessors(professorDirectory.options);

      // 2. Validate Data (Logic Check)
      setStatus('validating');
      const valResult = validateData(studentsData, roomsData, slotsData, profsData);
      setValidationResult(valResult);

      if (!valResult.isValid) {
        setStatus('error');
        setErrorMessage(t('errors.validationFailed'));
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
        setErrorMessage(normalizeUiMessage(err.message || '', t) || t('errors.scheduleFailed'));
      }
    } catch (err: any) {
      setStatus('error');
      setErrorMessage(normalizeUiMessage(err.message || '', t) || t('errors.parseFailed'));
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
        throw new Error(data?.error || t('errors.aiFailed'));
      }

      setAiAdvice(data);
    } catch (e: any) {
      console.error('AI request error:', e);
      const errorMsg = normalizeUiMessage(e?.message || '', t) || t('errors.aiFailedRetry');
      setAiAdvice({ analysis: errorMsg, suggestions: [] });
      setErrorMessage(`${t('errors.aiFailed')}: ${errorMsg}`);
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
              {t('app.brand')}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-gray-100 rounded-full p-1">
              <span className="px-2 text-xs font-medium text-gray-500">{t('app.language')}</span>
              {languageOptions.map((option) => (
                <button
                  key={option.locale}
                  onClick={() => setLocale(option.locale)}
                  className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
                    locale === option.locale ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {status === 'partial' && (
              <button
                onClick={handleAskAi}
                disabled={isAskingAi || !!aiAdvice}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-full shadow-sm hover:shadow-md transition-all"
              >
                {isAskingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {t('actions.aiAdvice')}
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
              {t('titles.validationIssues')}
            </h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-red-700 max-h-60 overflow-y-auto">
              {localizedValidationIssues.map((issue, idx) => (
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
                  {t('titles.aiReport')}
                </h3>

                {aiAdvice.bottleneck_professors &&
                  Array.isArray(aiAdvice.bottleneck_professors) &&
                  aiAdvice.bottleneck_professors.length > 0 && (
                    <div className="mb-2 text-sm">
                      <span className="font-bold text-purple-800">{t('labels.bottleneckProfessors')} </span>
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
                  {t('actions.close')}
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
              <h2 className="text-3xl font-extrabold text-gray-900 mb-4">{t('app.heroTitle')}</h2>
              <p className="text-lg text-gray-600">{t('app.heroSubtitle')}</p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-8">
                {(status === 'error' || status === 'failed') && (
                  <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-bold text-red-800">{t('errors.executionFailed')}</h3>
                      <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FileUpload
                    label={t('uploads.student.label')}
                    description={t('uploads.student.description')}
                    file={studentFile}
                    onFileSelect={setStudentFile}
                  />
                  <FileUpload
                    label={t('uploads.slots.label')}
                    description={t('uploads.slots.description')}
                    requiredHeaders={['id', 'timeLabel']}
                    file={slotsFile}
                    onFileSelect={setSlotsFile}
                  />
                  <FileUpload
                    label={t('uploads.rooms.label')}
                    description={t('uploads.rooms.description')}
                    file={roomFile}
                    onFileSelect={setRoomFile}
                  />
                  <FileUpload
                    label={t('uploads.availability.label')}
                    description={t('uploads.availability.description')}
                    file={profFile}
                    onFileSelect={handleProfFileSelect}
                  />
                </div>

                {availableProfessors.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <ProfPreferenceInput professorOptions={availableProfessors} onPreferencesChange={setProfPreferences} />
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.solver')}</label>
                    <select
                      value={solverMode}
                      onChange={(e) => setSolverMode(e.target.value as SolverMode)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700"
                    >
                      <option value="cp-sat">{t('solver.cpSat')}</option>
                      <option value="pulp-ilp">{t('solver.pulp')}</option>
                      <option value="legacy-python">{t('solver.legacy')}</option>
                    </select>
                    <p className="mt-2 text-xs text-gray-500">{t('solver.help')}</p>
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
                        <Loader2 className="w-6 h-6 animate-spin" /> {t('status.parsing')}
                      </>
                    )}
                    {status === 'validating' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> {t('status.validating')}
                      </>
                    )}
                    {status === 'solving' && (
                      <>
                        <Loader2 className="w-6 h-6 animate-spin" /> {t('status.solving')}
                      </>
                    )}
                    {(status === 'idle' || status === 'error' || status === 'failed') && (
                      <>
                        <Play className="w-6 h-6 fill-current" /> {t('actions.startScheduling')}
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

const App: React.FC = () => {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
};

export default App;
