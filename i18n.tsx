import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'en' | 'zh-Hans' | 'zh-Hant';

type TranslationValues = Record<string, string | number>;
type TranslateFn = (key: string, values?: TranslationValues) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslateFn;
}

const STORAGE_KEY = 'fyp-scheduler-locale';

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {
    'app.browserTitle': 'FYP Presentation Scheduler',
    'app.brand': 'FYP AutoScheduler Pro',
    'app.heroTitle': 'Smart FYP Presentation Scheduler v4.1',
    'app.heroSubtitle': 'Web Worker | Soft Constraints | Data Validation | Manual Adjustments',
    'app.language': 'Language',
    'actions.aiAdvice': 'AI Advice',
    'actions.startScheduling': 'Start Auto Scheduling',
    'actions.downloadCsv': 'Download CSV',
    'actions.reupload': 'Upload Again',
    'actions.close': 'Close',
    'errors.requiredFiles': 'Please upload the student, room, and professor availability files.',
    'errors.noSlotsFound': 'No available slots were found. Upload a slot file, or use room/professor files that include date and time slot columns.',
    'errors.validationFailed': 'Data validation failed. Please check the file content and ID mappings.',
    'errors.scheduleFailed': 'Schedule generation failed.',
    'errors.parseFailed': 'File parsing failed. Please check the CSV/XLSX format.',
    'errors.aiFailed': 'AI analysis failed',
    'errors.aiFailedRetry': 'AI analysis failed. Please try again later.',
    'errors.executionFailed': 'Execution Failed',
    'titles.validationIssues': 'Data Validation Issues',
    'titles.aiReport': 'AI Analysis Report',
    'labels.bottleneckProfessors': 'Bottleneck Professors:',
    'labels.requiredColumns': 'Required Columns:',
    'status.parsing': 'Parsing data...',
    'status.validating': 'Validating data...',
    'status.solving': 'Generating schedule...',
    'uploads.student.label': '1. Student Data',
    'uploads.student.description': 'Supports P numbers, professor names, or mixed identifiers; accepted headers include id/name/supervisorId/observerId or Students/Supervisor/Observer.',
    'uploads.slots.label': '2. Slot Data (Optional)',
    'uploads.slots.description': 'Optional. The system can derive slots automatically from the room or professor file.',
    'uploads.rooms.label': '3. Room Data',
    'uploads.rooms.description': 'Supports either id/name/availableSlots or Date + Time Slot + Venue formats.',
    'uploads.availability.label': '4. Professor Availability',
    'uploads.availability.description': 'Supports either professorId + availableSlots or ID + Name + per-slot columns.',
    'form.solver': 'Solver',
    'solver.cpSat': 'CP-SAT (Python)',
    'solver.pulp': 'PuLP ILP (Python / CBC)',
    'solver.legacy': 'Legacy Python Heuristic',
    'solver.help': 'All three options call the Python solvers you added. The app falls back to the built-in worker only if the local API is unavailable.',
    'upload.checkFailed': 'File header check failed',
    'upload.fileUploaded': 'File uploaded',
    'upload.dropOrClick': 'Drag and drop or click to upload CSV / XLSX',
    'upload.parseFailed': 'File parsing failed. Please confirm the CSV/XLSX format.',
    'upload.missingHeaders': 'Missing required columns: {columns}',
    'profPref.title': 'Professor Preferences (Soft Constraints)',
    'profPref.description': 'You can set preferences for each professor. If left unset, the system defaults to CONCENTRATE with weight 10.',
    'profPref.prefType': 'Preference Type',
    'profPref.concentrate': 'Concentrate Schedule (CONCENTRATE)',
    'profPref.maxPerDay': 'Daily Limit (MAX_PER_DAY)',
    'profPref.spread': 'Spread Schedule (SPREAD)',
    'profPref.desc.CONCENTRATE': 'Try to finish this professor\'s presentations within fewer days.',
    'profPref.desc.MAX_PER_DAY': 'Limit how many presentations this professor can have per day.',
    'profPref.desc.SPREAD': 'Try to spread this professor\'s presentations across more days.',
    'profPref.dailyLimit': 'Max presentations per day',
    'profPref.dailyLimitBadge': 'Daily limit {count}',
    'profPref.weight': 'Weight (1-10): {weight}',
    'profPref.priority.low': 'Low priority',
    'profPref.priority.medium': 'Medium priority',
    'profPref.priority.high': 'High priority (strong preference)',
    'profPref.clear': 'Clear this professor preference',
    'profPref.tip': 'Tip: higher weights make the solver try harder to satisfy the preference. Use 7-10 for strong requirements.',
    'dashboard.softCost': 'Soft Constraint Cost',
    'dashboard.softCostHint': 'Lower values mean the schedule matches professor preferences better.',
    'dashboard.softCostScore': 'Score (lower is better)',
    'dashboard.manualMode': 'Manual Adjustment Mode',
    'dashboard.unscheduledCount': '{count} students are still unscheduled',
    'dashboard.manualInstruction': 'After selecting an unscheduled student, choose one of the available slots in the panel below.',
    'dashboard.manualSelected': 'Selected: {name}',
    'dashboard.manualPrompt': 'You can switch to manual mode and place unscheduled students into valid slots.',
    'dashboard.finishManual': 'Finish Manual Adjustment',
    'dashboard.enterManual': 'Enter Manual Adjustment',
    'dashboard.title': 'Schedule Overview',
    'dashboard.view.time': 'By Time',
    'dashboard.view.room': 'By Room',
    'dashboard.view.prof': 'By Professor',
    'dashboard.movableSlots': 'Available Move Slots',
    'dashboard.noMoves': 'No available slots.',
    'dashboard.noMovesHint': 'You may need to adjust the data or manually swap another student first.',
    'dashboard.unscheduledTitle': 'Unscheduled Students ({count}) - Reason List',
    'dashboard.table.student': 'Student',
    'dashboard.table.id': 'ID',
    'dashboard.table.reasonCode': 'Reason Code',
    'dashboard.table.reasonDetails': 'Details',
    'dashboard.table.supervisor': 'Supervisor',
    'dashboard.table.observer': 'Observer',
    'dashboard.role.supervisor': 'Supervisor',
    'dashboard.role.observer': 'Observer',
    'dashboard.shortSupervisor': 'Sup',
    'dashboard.shortObserver': 'Obs',
    'dashboard.csv.scheduled': 'Scheduled',
    'dashboard.csv.unscheduled': 'Unscheduled',
    'reasons.NO_COMMON_TIME': 'The supervisor and observer do not share any common available slot.',
    'reasons.NO_ROOM_AVAILABLE': 'A common professor slot exists, but no room is available for it.',
    'reasons.PROF_BUSY': 'A usable slot is already occupied, or one of the professors has a conflict at that time.',
    'reasons.UNKNOWN': 'The system could not determine a more specific reason.',
    'validation.duplicateSlotId': 'Duplicate slot ID: {id}',
    'validation.studentMissingSupervisor': 'Student {name} ({id}) references a missing supervisor: {professorId}',
    'validation.studentMissingObserver': 'Student {name} ({id}) references a missing observer: {professorId}',
    'validation.sameSupervisorObserver': 'Student {name} ({id}) cannot have the same supervisor and observer: {professorId}',
    'validation.roomMissingSlot': 'Room {name} references a missing slot ID: {slotId}',
    'validation.professorMissingSlot': 'Professor {professorId} references a missing slot ID: {slotId}',
    'validation.professorLoadTooHigh': 'Professor {professorId} is required in {load} presentations but only has {availableCount} available slots.',
  },
  'zh-Hans': {
    'app.browserTitle': 'FYP 答辩排程系统',
    'app.brand': 'FYP AutoScheduler Pro',
    'app.heroTitle': '智能 FYP 答辩排程系统 v4.1',
    'app.heroSubtitle': 'Web Worker | 软约束优化 | 数据验证 | 手动调整',
    'app.language': '语言',
    'actions.aiAdvice': 'AI 分析建议',
    'actions.startScheduling': '开始自动排程',
    'actions.downloadCsv': '下载 CSV',
    'actions.reupload': '重新上传',
    'actions.close': '关闭',
    'errors.requiredFiles': '请至少上传学生、房间和教授可用时间这 3 份文件。',
    'errors.noSlotsFound': '找不到任何可用时段。请上传时段文件，或使用包含日期与时段栏位的房间/教授文件。',
    'errors.validationFailed': '数据验证失败，请检查文件内容与 ID 对应。',
    'errors.scheduleFailed': '排程计算失败。',
    'errors.parseFailed': '文件解析失败，请确认 CSV/XLSX 格式。',
    'errors.aiFailed': 'AI 分析失败',
    'errors.aiFailedRetry': 'AI 分析失败，请稍后再试。',
    'errors.executionFailed': '执行失败',
    'titles.validationIssues': '数据验证问题',
    'titles.aiReport': 'AI 分析报告',
    'labels.bottleneckProfessors': '瓶颈教授：',
    'labels.requiredColumns': '必要栏位：',
    'status.parsing': '正在解析数据...',
    'status.validating': '正在验证数据...',
    'status.solving': '正在生成排程...',
    'uploads.student.label': '1. 学生资料',
    'uploads.student.description': '支持 P number、教授姓名，或两者混写；栏位可为 id/name/supervisorId/observerId，或 Students/Supervisor/Observer。',
    'uploads.slots.label': '2. 时段资料（可选）',
    'uploads.slots.description': '可省略；系统会尝试从房间文件或教授文件自动抽取时段。',
    'uploads.rooms.label': '3. 房间资料',
    'uploads.rooms.description': '支持两种格式：id/name/availableSlots，或 Date + Time Slot + Venue。',
    'uploads.availability.label': '4. 教授可用时间',
    'uploads.availability.description': '支持两种格式：professorId + availableSlots，或 ID + Name + 各时段栏位。',
    'form.solver': '求解器',
    'solver.cpSat': 'CP-SAT（Python）',
    'solver.pulp': 'PuLP ILP（Python / CBC）',
    'solver.legacy': 'Legacy Python Heuristic',
    'solver.help': '三个选项都会调用你新增的 Python solver。只有在本地 API 不可用时，系统才会退回内建 worker。',
    'upload.checkFailed': '文件栏位检查失败',
    'upload.fileUploaded': '文件已上传',
    'upload.dropOrClick': '拖放或点击上传 CSV / XLSX',
    'upload.parseFailed': '文件解析失败，请确认 CSV/XLSX 格式。',
    'upload.missingHeaders': '缺少必要栏位：{columns}',
    'profPref.title': '教授偏好设置（软约束）',
    'profPref.description': '你可以针对每位教授设置偏好。若不设置，系统默认使用 CONCENTRATE，权重 10。',
    'profPref.prefType': '偏好类型',
    'profPref.concentrate': '集中安排（CONCENTRATE）',
    'profPref.maxPerDay': '每日上限（MAX_PER_DAY）',
    'profPref.spread': '分散安排（SPREAD）',
    'profPref.desc.CONCENTRATE': '希望把该教授的答辩集中在较少天数内完成。',
    'profPref.desc.MAX_PER_DAY': '限制该教授每天最多答辩场次。',
    'profPref.desc.SPREAD': '希望把该教授的答辩分散到更多天。',
    'profPref.dailyLimit': '每天最多答辩场次',
    'profPref.dailyLimitBadge': '每天上限 {count}',
    'profPref.weight': '权重（1-10）：{weight}',
    'profPref.priority.low': '低优先级',
    'profPref.priority.medium': '中优先级',
    'profPref.priority.high': '高优先级（强偏好）',
    'profPref.clear': '清除此教授偏好',
    'profPref.tip': '提示：权重越高，系统越倾向满足该偏好。若教授有强烈需求，建议设置为 7-10。',
    'dashboard.softCost': '软约束成本',
    'dashboard.softCostHint': '数值越低，代表越符合教授偏好。',
    'dashboard.softCostScore': '评分（越低越好）',
    'dashboard.manualMode': '手动调整模式',
    'dashboard.unscheduledCount': '仍有 {count} 位学生未排程',
    'dashboard.manualInstruction': '点选未排程学生后，可在右下角选择可用时段。',
    'dashboard.manualSelected': '当前选中：{name}',
    'dashboard.manualPrompt': '你可以切换到手动调整模式，将未排程学生安排到可用时段。',
    'dashboard.finishManual': '完成手动调整',
    'dashboard.enterManual': '进入手动调整',
    'dashboard.title': '排程总览',
    'dashboard.view.time': '按时段',
    'dashboard.view.room': '按房间',
    'dashboard.view.prof': '按教授',
    'dashboard.movableSlots': '可移动时段',
    'dashboard.noMoves': '没有可用时段。',
    'dashboard.noMovesHint': '可考虑调整数据，或先手动交换其他学生的时段。',
    'dashboard.unscheduledTitle': '未排入学生（{count}）- 原因清单',
    'dashboard.table.student': '学生',
    'dashboard.table.id': 'ID',
    'dashboard.table.reasonCode': '原因代码',
    'dashboard.table.reasonDetails': '详细原因',
    'dashboard.table.supervisor': '指导教授',
    'dashboard.table.observer': '观察',
    'dashboard.role.supervisor': '指导教授',
    'dashboard.role.observer': '观察',
    'dashboard.shortSupervisor': '指导',
    'dashboard.shortObserver': '观察',
    'dashboard.csv.scheduled': '已排程',
    'dashboard.csv.unscheduled': '未排程',
    'reasons.NO_COMMON_TIME': '指导教授与口试教授没有任何共同可用时段。',
    'reasons.NO_ROOM_AVAILABLE': '已找到教授共同可用时段，但没有可用房间。',
    'reasons.PROF_BUSY': '可用时段已被其他安排占用，或教授在同一时段有冲突。',
    'reasons.UNKNOWN': '系统无法判定更精确的未排入原因。',
    'validation.duplicateSlotId': '时段 ID 重复：{id}',
    'validation.studentMissingSupervisor': '学生 {name}（{id}）的指导教授不存在：{professorId}',
    'validation.studentMissingObserver': '学生 {name}（{id}）的口试教授不存在：{professorId}',
    'validation.sameSupervisorObserver': '学生 {name}（{id}）的指导教授与口试教授不可相同：{professorId}',
    'validation.roomMissingSlot': '房间 {name} 引用了不存在的时段 ID：{slotId}',
    'validation.professorMissingSlot': '教授 {professorId} 引用了不存在的时段 ID：{slotId}',
    'validation.professorLoadTooHigh': '教授 {professorId} 需要参与 {load} 场，但只有 {availableCount} 个可用时段。',
  },
  'zh-Hant': {
    'app.browserTitle': 'FYP 口試排程系統',
    'app.brand': 'FYP AutoScheduler Pro',
    'app.heroTitle': '智慧 FYP 口試排程系統 v4.1',
    'app.heroSubtitle': 'Web Worker | 軟限制優化 | 資料驗證 | 手動調整',
    'app.language': '語言',
    'actions.aiAdvice': 'AI 分析建議',
    'actions.startScheduling': '開始自動排程',
    'actions.downloadCsv': '下載 CSV',
    'actions.reupload': '重新上傳',
    'actions.close': '關閉',
    'errors.requiredFiles': '請至少上傳學生、房間與教授可用時間 3 份檔案。',
    'errors.noSlotsFound': '找不到任何可用時段。請上傳時段檔，或使用包含日期與時段欄位的房間/教授檔案。',
    'errors.validationFailed': '資料驗證失敗，請檢查檔案內容與 ID 對應。',
    'errors.scheduleFailed': '排程計算失敗。',
    'errors.parseFailed': '檔案解析失敗，請確認 CSV/XLSX 格式。',
    'errors.aiFailed': 'AI 分析失敗',
    'errors.aiFailedRetry': 'AI 分析失敗，請稍後再試。',
    'errors.executionFailed': '執行失敗',
    'titles.validationIssues': '資料驗證問題',
    'titles.aiReport': 'AI 分析報告',
    'labels.bottleneckProfessors': '瓶頸教授：',
    'labels.requiredColumns': '必要欄位：',
    'status.parsing': '解析資料中...',
    'status.validating': '驗證資料中...',
    'status.solving': '正在產生排程...',
    'uploads.student.label': '1. 學生資料',
    'uploads.student.description': '支援 P number、教授姓名，或兩者混寫；欄位可為 id/name/supervisorId/observerId，或 Students/Supervisor/Observer。',
    'uploads.slots.label': '2. 時段資料（可選）',
    'uploads.slots.description': '可省略；系統會嘗試從房間檔或教授檔自動抽取時段。',
    'uploads.rooms.label': '3. 房間資料',
    'uploads.rooms.description': '支援兩種格式：id/name/availableSlots，或 Date + Time Slot + Venue。',
    'uploads.availability.label': '4. 教授可用時間',
    'uploads.availability.description': '支援兩種格式：professorId + availableSlots，或 ID + Name + 各時段欄位。',
    'form.solver': '求解器',
    'solver.cpSat': 'CP-SAT（Python）',
    'solver.pulp': 'PuLP ILP（Python / CBC）',
    'solver.legacy': 'Legacy Python Heuristic',
    'solver.help': '三個選項都會呼叫你新增的 Python solver。若本地 API 無法使用，系統才會退回內建 worker。',
    'upload.checkFailed': '檔案欄位檢查失敗',
    'upload.fileUploaded': '檔案已上傳',
    'upload.dropOrClick': '拖放或點擊上傳 CSV / XLSX',
    'upload.parseFailed': '檔案解析失敗，請確認 CSV/XLSX 格式。',
    'upload.missingHeaders': '缺少必要欄位：{columns}',
    'profPref.title': '教授偏好設定（軟限制）',
    'profPref.description': '你可以針對每位教授設定偏好。若不設定，系統預設為 CONCENTRATE、權重 10。',
    'profPref.prefType': '偏好類型',
    'profPref.concentrate': '集中安排（CONCENTRATE）',
    'profPref.maxPerDay': '每日上限（MAX_PER_DAY）',
    'profPref.spread': '分散安排（SPREAD）',
    'profPref.desc.CONCENTRATE': '希望把該教授的口試集中在較少天數內完成。',
    'profPref.desc.MAX_PER_DAY': '限制該教授每天最多口試場次。',
    'profPref.desc.SPREAD': '希望把該教授的口試分散在更多天。',
    'profPref.dailyLimit': '每天最多口試場次',
    'profPref.dailyLimitBadge': '每天上限 {count}',
    'profPref.weight': '權重（1-10）：{weight}',
    'profPref.priority.low': '低優先',
    'profPref.priority.medium': '中優先',
    'profPref.priority.high': '高優先（強烈偏好）',
    'profPref.clear': '清除此教授偏好',
    'profPref.tip': '提示：權重越高，系統越傾向滿足該偏好。若某教授有強烈需求，建議設定 7-10。',
    'dashboard.softCost': '軟限制成本',
    'dashboard.softCostHint': '數值越低代表越符合教授偏好。',
    'dashboard.softCostScore': '評分（越低越好）',
    'dashboard.manualMode': '手動調整模式',
    'dashboard.unscheduledCount': '仍有 {count} 位學生尚未排程',
    'dashboard.manualInstruction': '點選未排程學生後，可在右下角選擇可用時段。',
    'dashboard.manualSelected': '目前選取：{name}',
    'dashboard.manualPrompt': '可切換到手動調整模式，將未排程學生安排到可用時段。',
    'dashboard.finishManual': '完成手動調整',
    'dashboard.enterManual': '進入手動調整',
    'dashboard.title': '排程總覽',
    'dashboard.view.time': '依時段',
    'dashboard.view.room': '依房間',
    'dashboard.view.prof': '依教授',
    'dashboard.movableSlots': '可移動時段',
    'dashboard.noMoves': '沒有可用時段。',
    'dashboard.noMovesHint': '可考慮調整資料或手動交換其他學生時段。',
    'dashboard.unscheduledTitle': '未排入學生（{count}）- 原因清單',
    'dashboard.table.student': '學生',
    'dashboard.table.id': 'ID',
    'dashboard.table.reasonCode': '原因代碼',
    'dashboard.table.reasonDetails': '詳細原因',
    'dashboard.table.supervisor': '指導教授',
    'dashboard.table.observer': '觀察',
    'dashboard.role.supervisor': '指導教授',
    'dashboard.role.observer': '觀察',
    'dashboard.shortSupervisor': '指導',
    'dashboard.shortObserver': '觀察',
    'dashboard.csv.scheduled': '已排程',
    'dashboard.csv.unscheduled': '未排程',
    'reasons.NO_COMMON_TIME': '指導教授與口試教授沒有任何共同可用時段。',
    'reasons.NO_ROOM_AVAILABLE': '已找到教授共同可用時段，但沒有可用房間。',
    'reasons.PROF_BUSY': '可用時段已被其他安排占用，或教授在同時段有衝堂。',
    'reasons.UNKNOWN': '系統無法判定更精確的未排入原因。',
    'validation.duplicateSlotId': '時段 ID 重複：{id}',
    'validation.studentMissingSupervisor': '學生 {name}（{id}）的指導教授不存在：{professorId}',
    'validation.studentMissingObserver': '學生 {name}（{id}）的口試教授不存在：{professorId}',
    'validation.sameSupervisorObserver': '學生 {name}（{id}）的指導教授與口試教授不可相同：{professorId}',
    'validation.roomMissingSlot': '房間 {name} 引用了不存在的時段 ID：{slotId}',
    'validation.professorMissingSlot': '教授 {professorId} 引用了不存在的時段 ID：{slotId}',
    'validation.professorLoadTooHigh': '教授 {professorId} 需參與 {load} 場，但僅有 {availableCount} 個可用時段。',
  },
};

const languageLabels: Record<Locale, string> = {
  en: 'EN',
  'zh-Hans': '简中',
  'zh-Hant': '繁中',
};

const htmlLangMap: Record<Locale, string> = {
  en: 'en',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-HK',
};

const I18nContext = createContext<I18nContextValue | null>(null);

const interpolate = (template: string, values?: TranslationValues): string => {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
};

const detectInitialLocale = (): Locale => {
  if (typeof window === 'undefined') return 'zh-Hant';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'zh-Hans' || stored === 'zh-Hant') {
    return stored;
  }

  const language = window.navigator.language.toLowerCase();
  if (language.startsWith('zh-cn') || language.startsWith('zh-sg') || language.includes('hans')) {
    return 'zh-Hans';
  }
  if (language.startsWith('en')) {
    return 'en';
  }
  return 'zh-Hant';
};

export const languageOptions = (Object.keys(languageLabels) as Locale[]).map((locale) => ({
  locale,
  label: languageLabels[locale],
}));

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocale] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = htmlLangMap[locale];
    document.title = dictionaries[locale]['app.browserTitle'];
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t: (key, values) => {
      const translation = dictionaries[locale][key] || dictionaries['zh-Hant'][key] || key;
      return interpolate(translation, values);
    },
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
};

export const localizeValidationIssue = (message: string, t: TranslateFn): string => {
  const duplicateSlot = message.match(/^時段 ID 重複：(.+)$/);
  if (duplicateSlot) {
    return t('validation.duplicateSlotId', { id: duplicateSlot[1] });
  }

  const missingSupervisor = message.match(/^學生\s+(.+)（(.+)）的指導教授不存在：(.+)$/);
  if (missingSupervisor) {
    return t('validation.studentMissingSupervisor', {
      name: missingSupervisor[1],
      id: missingSupervisor[2],
      professorId: missingSupervisor[3],
    });
  }

  const missingObserver = message.match(/^學生\s+(.+)（(.+)）的口試教授不存在：(.+)$/);
  if (missingObserver) {
    return t('validation.studentMissingObserver', {
      name: missingObserver[1],
      id: missingObserver[2],
      professorId: missingObserver[3],
    });
  }

  const sameProfessor = message.match(/^學生\s+(.+)（(.+)）的指導教授與口試教授不可相同：(.+)$/);
  if (sameProfessor) {
    return t('validation.sameSupervisorObserver', {
      name: sameProfessor[1],
      id: sameProfessor[2],
      professorId: sameProfessor[3],
    });
  }

  const roomMissingSlot = message.match(/^房間\s+(.+)\s+引用了不存在的時段 ID：(.+)$/);
  if (roomMissingSlot) {
    return t('validation.roomMissingSlot', {
      name: roomMissingSlot[1],
      slotId: roomMissingSlot[2],
    });
  }

  const professorMissingSlot = message.match(/^教授\s+(.+)\s+引用了不存在的時段 ID：(.+)$/);
  if (professorMissingSlot) {
    return t('validation.professorMissingSlot', {
      professorId: professorMissingSlot[1],
      slotId: professorMissingSlot[2],
    });
  }

  const loadTooHigh = message.match(/^教授\s+(.+)\s+需參與\s+(\d+)\s+場，但僅有\s+(\d+)\s+個可用時段。$/);
  if (loadTooHigh) {
    return t('validation.professorLoadTooHigh', {
      professorId: loadTooHigh[1],
      load: loadTooHigh[2],
      availableCount: loadTooHigh[3],
    });
  }

  return message;
};