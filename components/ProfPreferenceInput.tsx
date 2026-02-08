import React, { useState, useMemo } from 'react';
import { ProfPreference } from '../types';
import { ChevronDown } from 'lucide-react';

interface ProfPreferenceInputProps {
  professorIds: string[];
  onPreferencesChange: (preferences: Record<string, ProfPreference>) => void;
}

const ProfPreferenceInput: React.FC<ProfPreferenceInputProps> = ({ professorIds, onPreferencesChange }) => {
  const [preferences, setPreferences] = useState<Record<string, ProfPreference>>({});
  const [expandedProf, setExpandedProf] = useState<string | null>(null);

  const handlePrefChange = (profId: string, type: 'CONCENTRATE' | 'MAX_PER_DAY' | 'SPREAD', weight: number, target?: number) => {
    const updated = { ...preferences };
    updated[profId] = { type, weight, target };
    setPreferences(updated);
    onPreferencesChange(updated);
  };

  const prefTypeDescriptions: Record<string, string> = {
    CONCENTRATE: '集中在一天內完成所有演講（最小化演講天數）',
    MAX_PER_DAY: '限制每天的演講數量（每天最多演講場次）',
    SPREAD: '分散在多天進行演講（最大化演講天數）'
  };

  return (
    <div className="bg-white border border-gray-300 rounded-lg p-6 shadow-sm">
      <h3 className="text-lg font-bold mb-4 text-gray-900">教授工作偏好設定（可選）</h3>
      <p className="text-sm text-gray-600 mb-4">
        為教授設定工作偏好以優化排程。不設定則使用預設值（CONCENTRATE, weight=10）
      </p>

      <div className="space-y-3">
        {professorIds.map((profId) => {
          const pref = preferences[profId] || { type: 'CONCENTRATE', weight: 10 };
          const isExpanded = expandedProf === profId;

          return (
            <div key={profId} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpandedProf(isExpanded ? null : profId)}
                className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3 text-left">
                  <span className="font-medium text-gray-900">{profId}</span>
                  <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                    {pref.type}
                  </span>
                  {pref.type === 'MAX_PER_DAY' && pref.target && (
                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                      Max {pref.target}/day
                    </span>
                  )}
                </div>
                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="p-4 bg-white border-t border-gray-200">
                  {/* Preference Type Selection */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      工作偏好類型
                    </label>
                    <select
                      value={pref.type}
                      onChange={(e) => handlePrefChange(profId, e.target.value as any, pref.weight, pref.target)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="CONCENTRATE">集中（Concentrate）</option>
                      <option value="MAX_PER_DAY">限制每日數量（Max Per Day）</option>
                      <option value="SPREAD">分散（Spread）</option>
                    </select>
                    <p className="mt-2 text-xs text-gray-500 italic">
                      {prefTypeDescriptions[pref.type]}
                    </p>
                  </div>

                  {/* Target Input (only for MAX_PER_DAY) */}
                  {pref.type === 'MAX_PER_DAY' && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        每天最多演講場次
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={pref.target || 3}
                        onChange={(e) => handlePrefChange(profId, pref.type, pref.weight, parseInt(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {/* Weight Slider */}
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      優先級 (1-10): <span className="text-blue-600 font-bold">{pref.weight}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={pref.weight}
                      onChange={(e) => handlePrefChange(profId, pref.type, parseInt(e.target.value), pref.target)}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {pref.weight <= 3 && '低優先級（可選）'}
                      {pref.weight > 3 && pref.weight <= 6 && '中優先級'}
                      {pref.weight > 6 && '高優先級（強烈偏好）'}
                    </p>
                  </div>

                  {/* Clear Button */}
                  <button
                    onClick={() => {
                      const updated = { ...preferences };
                      delete updated[profId];
                      setPreferences(updated);
                      onPreferencesChange(updated);
                    }}
                    className="w-full text-sm text-red-600 hover:text-red-700 py-2 px-3 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
                  >
                    清除此教授的設定
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-gray-500 bg-blue-50 p-3 rounded">
        💡 <strong>提示：</strong>優先級越高，排程器越努力滿足此偏好。建議為重要偏好設定 7-10。
      </p>
    </div>
  );
};

export default ProfPreferenceInput;
