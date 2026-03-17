import React, { useState } from 'react';
import { ProfPreference, ProfessorOption } from '../types';
import { ChevronDown } from 'lucide-react';

interface ProfPreferenceInputProps {
  professorOptions: ProfessorOption[];
  onPreferencesChange: (preferences: Record<string, ProfPreference>) => void;
}

const ProfPreferenceInput: React.FC<ProfPreferenceInputProps> = ({ professorOptions, onPreferencesChange }) => {
  const [preferences, setPreferences] = useState<Record<string, ProfPreference>>({});
  const [expandedProf, setExpandedProf] = useState<string | null>(null);

  const handlePrefChange = (
    profId: string,
    type: 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD',
    weight: number,
    target?: number
  ) => {
    const updated = { ...preferences };
    updated[profId] = { type, weight, target };
    setPreferences(updated);
    onPreferencesChange(updated);
  };

  const prefTypeDescriptions: Record<string, string> = {
    CONCENTRATE: '希望把該教授的口試集中在較少天數內完成。',
    MAX_PER_DAY: '限制該教授每天最多口試場次。',
    SPREAD: '希望把該教授的口試分散在更多天。',
  };

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-6 shadow-sm">
      <h3 className="text-lg font-bold mb-4 text-gray-900">教授偏好設定（軟限制）</h3>
      <p className="text-sm text-gray-600 mb-4">
        你可以針對每位教授設定偏好。若不設定，系統預設為 <code>CONCENTRATE</code>、權重 10。
      </p>

      <div className="space-y-3">
        {professorOptions.map((professor) => {
          const profId = professor.id;
          const pref = preferences[profId] || { type: 'CONCENTRATE' as const, weight: 10 };
          const isExpanded = expandedProf === profId;

          return (
            <div key={profId} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setExpandedProf(isExpanded ? null : profId)}
                className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3 text-left">
                  <span className="font-medium text-gray-900">{professor.label}</span>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">{pref.type}</span>
                  {pref.type === 'MAX_PER_DAY' && pref.target && (
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                      每天上限 {pref.target}
                    </span>
                  )}
                </div>
                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="p-4 bg-white border-t border-gray-200">
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">偏好類型</label>
                    <select
                      value={pref.type}
                      onChange={(e) =>
                        handlePrefChange(
                          profId,
                          e.target.value as 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD',
                          pref.weight,
                          pref.target
                        )
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="CONCENTRATE">集中安排（CONCENTRATE）</option>
                      <option value="MAX_PER_DAY">每日上限（MAX_PER_DAY）</option>
                      <option value="SPREAD">分散安排（SPREAD）</option>
                    </select>
                    <p className="mt-2 text-xs text-gray-500 italic">{prefTypeDescriptions[pref.type]}</p>
                  </div>

                  {pref.type === 'MAX_PER_DAY' && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">每天最多口試場次</label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={pref.target || 3}
                        onChange={(e) =>
                          handlePrefChange(profId, pref.type, pref.weight, parseInt(e.target.value || '3', 10))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      權重（1-10）：<span className="text-blue-600 font-bold">{pref.weight}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={pref.weight}
                      onChange={(e) =>
                        handlePrefChange(profId, pref.type, parseInt(e.target.value, 10), pref.target)
                      }
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {pref.weight <= 3 && '低優先'}
                      {pref.weight > 3 && pref.weight <= 6 && '中優先'}
                      {pref.weight > 6 && '高優先（強烈偏好）'}
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      const updated = { ...preferences };
                      delete updated[profId];
                      setPreferences(updated);
                      onPreferencesChange(updated);
                    }}
                    className="w-full text-sm text-red-600 hover:text-red-700 py-2 px-3 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                  >
                    清除此教授偏好
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-gray-500 bg-blue-50 p-3 rounded">
        提示：權重越高，系統越傾向滿足該偏好。若某教授有強烈需求，建議設定 7-10。
      </p>
    </div>
  );
};

export default ProfPreferenceInput;
