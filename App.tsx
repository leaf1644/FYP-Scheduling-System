// File: fyp-排程系統-(fyp-scheduler)/App.tsx

import React, { useState } from 'react';
import { Bot, Play, AlertCircle, Loader2, Sparkles, AlertTriangle } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import FileUpload from './components/FileUpload';
import ProfPreferenceInput from './components/ProfPreferenceInput';
import ScheduleDashboard from './components/ScheduleDashboard';
import { parseStudents, parseRooms, parseSlots, parseAvailability, validateData } from './utils/csvHelper';
import { generateSchedule } from './utils/scheduler';
import { Student, Slot, RoomSlot, ScheduleResult, SolvingStatus, ValidationResult, ProfPreference } from './types';

const App: React.FC = () => {
  const [studentFile, setStudentFile] = useState<File | null>(null);
  const [roomFile, setRoomFile] = useState<File | null>(null);
  const [slotsFile, setSlotsFile] = useState<File | null>(null);
  const [profFile, setProfFile] = useState<File | null>(null);
  
  const [status, setStatus] = useState<SolvingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleResult | null>(null);

  // Stored for Edit Mode calculation
  const [allRoomSlots, setAllRoomSlots] = useState<RoomSlot[]>([]);
  const [profAvailability, setProfAvailability] = useState<Record<string, Set<string>>>({});
  
  // Professor Preferences
  const [profPreferences, setProfPreferences] = useState<Record<string, ProfPreference>>({});
  const [availableProfessors, setAvailableProfessors] = useState<string[]>([]);

  // Gemini AI State
  const [isAskingAi, setIsAskingAi] = useState(false);
  const [aiAdvice, setAiAdvice] = useState<any | null>(null);

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
  };

  const startProcessing = async () => {
    if (!studentFile || !roomFile || !slotsFile || !profFile) {
      setErrorMessage("請上傳所有 4 個必要的 CSV 文件");
      return;
    }

    setStatus('parsing');
    setErrorMessage('');
    setValidationResult(null);

    try {
      // 1. Parse Data
      const slotsData = await parseSlots(slotsFile);
      const roomsData = await parseRooms(roomFile);
      const profsData = await parseAvailability(profFile);
      const studentsData = await parseStudents(studentFile);

      setProfAvailability(profsData);
      
      // Extract unique professor IDs from availability
      const profIds = Object.keys(profsData).sort();
      setAvailableProfessors(profIds);

      // 2. Validate Data (Logic Check)
      setStatus('validating');
      const valResult = validateData(studentsData, roomsData, slotsData, profsData);
      setValidationResult(valResult);

      if (!valResult.isValid) {
        setStatus('error');
        setErrorMessage("資料驗證失敗，請修正 CSV 中的錯誤 ID。");
        return;
      }

      // 3. Pre-process Relational Data for Solver
      const slotMap = new Map<string, Slot>();
      slotsData.forEach(s => slotMap.set(s.id, s));
      const generatedRoomSlots: RoomSlot[] = [];
      roomsData.forEach(room => {
        room.availableSlotIds.forEach(slotId => {
          const slot = slotMap.get(slotId);
          if (slot) {
            generatedRoomSlots.push({
              id: `${room.id}::${slot.id}`,
              roomId: room.id,
              roomName: room.name,
              slotId: slot.id,
              timeLabel: slot.timeLabel
            });
          }
        });
      });
      setAllRoomSlots(generatedRoomSlots);

      // 4. Solve (Worker) - Pass profPreferences
      setStatus('solving');
      try {
        const result = await generateSchedule(studentsData, generatedRoomSlots, profsData, profPreferences);
        setScheduleData(result);
        setStatus(result.success ? 'success' : 'partial');
      } catch (err: any) {
        setStatus('failed');
        setErrorMessage(err.message || "排程計算失敗");
      }

    } catch (err: any) {
      setStatus('error');
      setErrorMessage(err.message || "解析文件時發生錯誤。");
    }
  };

  const handleAskAi = async () => {
    if (!scheduleData || !process.env.API_KEY) {
      setErrorMessage("缺少 Google GenAI API Key，請設定環境變數");
      return;
    }
    setIsAskingAi(true);

    try {
      const ai = new GoogleGenAI(process.env.API_KEY);
      
      const failedSummary = scheduleData.unscheduled.slice(0, 15).map(u => 
        `{ sup: "${u.student.supervisorId}", obs: "${u.student.observerId}", reason: "${u.reason}" }`
      ).join('\n');

      const prompt = `
        Context: CSP Scheduling for University Presentations.
        Task: Analyze the following list of failed assignments (anonymized) to find bottleneck resources.
        
        Input Data:
        ${failedSummary}
        
        Output format: JSON only.
        {
          "bottleneck_professors": ["ProfA", "ProfB"],
          "analysis": "Brief explanation of why...",
          "suggestions": [
            "Ask ProfA to open 1 more slot.",
            "Swap pairs involving ProfB."
          ]
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt
      });

      const text = response.text || "{}";
      const jsonStr = text.replace(/```json|```/g, '').trim();
      try {
          setAiAdvice(JSON.parse(jsonStr));
      } catch (e) {
          setAiAdvice({ analysis: text, suggestions: [] });
      }

    } catch (e: any) {
      console.error("AI request error:", e);
      const errorMsg = e?.message || "AI 連線失敗，請檢查 API Key 和網路連線。";
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
             {status === 'partial' && process.env.API_KEY && (
               <button 
                onClick={handleAskAi}
                disabled={isAskingAi || !!aiAdvice}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm rounded-full shadow-sm hover:shadow-md transition-all"
               >
                 {isAskingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                 AI 智能顧問
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
                資料驗證錯誤
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
                   AI 建議報告
                 </h3>
                 
                 {aiAdvice.bottleneck_professors && Array.isArray(aiAdvice.bottleneck_professors) && aiAdvice.bottleneck_professors.length > 0 && (
                     <div className="mb-2 text-sm">
                        <span className="font-bold text-purple-800">瓶頸教授: </span>
                        {aiAdvice.bottleneck_professors.join(', ')}
                     </div>
                 )}

                 <p className="text-sm text-purple-800 leading-relaxed mb-3">
                   {aiAdvice.analysis}
                 </p>
                 
                 {/* 修正: 安全檢查 suggestions 是否為陣列 */}
                 {aiAdvice.suggestions && Array.isArray(aiAdvice.suggestions) && (
                    <ul className="list-disc list-inside text-sm text-purple-800 space-y-1 bg-white/50 p-3 rounded-lg">
                        {aiAdvice.suggestions.map((s: string, i: number) => <li key={i}>{s}</li>)}
                    </ul>
                 )}

                 <button onClick={() => setAiAdvice(null)} className="absolute top-4 right-4 text-purple-400 hover:text-purple-600">
                   &times;
                 </button>
              </div>
            )}
            <ScheduleDashboard 
                key={Date.now()} // 確保每次計算都強制重置 Dashboard 狀態
                schedule={scheduleData} 
                onReset={handleReset} 
                allRoomSlots={allRoomSlots}
                profAvailability={profAvailability}
            />
          </>
        ) : (
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-extrabold text-gray-900 mb-4">
                智慧型 FYP 演示排程系統 v4.1
              </h2>
              <p className="text-lg text-gray-600">
                Web Worker | 局部搜索優化 | 邏輯驗證 | 手動排程
              </p>
            </div>

            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="p-8">
                {(status === 'error' || status === 'failed') && (
                  <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-r flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                    <div>
                      <h3 className="text-sm font-bold text-red-800">操作中斷</h3>
                      <p className="text-sm text-red-700 mt-1">{errorMessage}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FileUpload 
                    label="1. 學生名單 (Students)" 
                    description="id, name, supervisorId, observerId"
                    requiredHeaders={['id', 'name', 'supervisorId', 'observerId']}
                    file={studentFile}
                    onFileSelect={setStudentFile}
                  />
                  <FileUpload 
                    label="2. 時段定義 (Slots)" 
                    description="id, timeLabel"
                    requiredHeaders={['id', 'timeLabel']}
                    file={slotsFile}
                    onFileSelect={setSlotsFile}
                  />
                  <FileUpload 
                    label="3. 房間列表 (Rooms)" 
                    description="id, name, capacity, availableSlots"
                    requiredHeaders={['id', 'name', 'availableSlots']}
                    file={roomFile}
                    onFileSelect={setRoomFile}
                  />
                  <FileUpload 
                    label="4. 教授空閒時間 (Availability)" 
                    description="professorId, availableSlots"
                    requiredHeaders={['professorId', 'availableSlots']}
                    file={profFile}
                    onFileSelect={setProfFile}
                  />
                </div>

                {availableProfessors.length > 0 && (
                  <div className="mt-8 pt-6 border-t border-gray-100">
                    <ProfPreferenceInput 
                      professorIds={availableProfessors}
                      onPreferencesChange={setProfPreferences}
                    />
                  </div>
                )}

                <div className="mt-8 pt-6 border-t border-gray-100">
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
                    {status === 'parsing' && <><Loader2 className="w-6 h-6 animate-spin" /> 解析資料中...</>}
                    {status === 'validating' && <><Loader2 className="w-6 h-6 animate-spin" /> 驗證邏輯與完整性...</>}
                    {status === 'solving' && <><Loader2 className="w-6 h-6 animate-spin" /> 啟動 AI 演算法優化...</>}
                    {(status === 'idle' || status === 'error' || status === 'failed') && (
                      <><Play className="w-6 h-6 fill-current" /> 開始自動排程</>
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