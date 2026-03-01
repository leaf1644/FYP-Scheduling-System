import React, { ChangeEvent, useState } from 'react';
import Papa from 'papaparse';
import { Upload, FileCheck, FileX } from 'lucide-react';

interface FileUploadProps {
  label: string;
  description: string;
  accept?: string;
  file: File | null;
  onFileSelect: (file: File | null) => void;
  requiredHeaders?: string[];
}

const FileUpload: React.FC<FileUploadProps> = ({
  label,
  description,
  accept = '.csv',
  file,
  onFileSelect,
  requiredHeaders
}) => {
  const [headerError, setHeaderError] = useState<string>('');

  const validateHeaders = (selectedFile: File) => {
    if (!requiredHeaders || requiredHeaders.length === 0) {
      setHeaderError('');
      onFileSelect(selectedFile);
      return;
    }

    Papa.parse(selectedFile, {
      header: true,
      skipEmptyLines: true,
      preview: 1,
      complete: (results) => {
        const headers = (results.meta.fields || []).map((h) => h.trim().toLowerCase());
        const headerSet = new Set(headers);
        const missing = requiredHeaders.filter((h) => !headerSet.has(h.toLowerCase()));

        if (missing.length > 0) {
          setHeaderError(`缺少必要欄位: ${missing.join(', ')}`);
          onFileSelect(null);
          return;
        }

        setHeaderError('');
        onFileSelect(selectedFile);
      },
      error: () => {
        setHeaderError('CSV 解析失敗，請確認檔案格式。');
        onFileSelect(null);
      },
    });
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;

    if (!selectedFile) {
      setHeaderError('');
      onFileSelect(null);
      return;
    }

    validateHeaders(selectedFile);
  };

  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div
        className={`
          relative border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors
          ${headerError ? 'border-red-400 bg-red-50' : file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 bg-white'}
        `}
      >
        <input
          type="file"
          accept={accept}
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        {headerError ? (
          <div className="text-center">
            <FileX className="w-10 h-10 text-red-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-red-800">CSV 欄位檢查失敗</p>
            <p className="text-xs text-red-600 mt-1">{headerError}</p>
          </div>
        ) : file ? (
          <div className="text-center">
            <FileCheck className="w-10 h-10 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-800">{file.name}</p>
            <p className="text-xs text-green-600 mt-1">檔案已上傳</p>
          </div>
        ) : (
          <div className="text-center pointer-events-none">
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">拖放或點擊上傳 CSV</p>
            <p className="text-xs text-gray-400 mt-1">{description}</p>
            {requiredHeaders && (
              <p className="text-[10px] text-gray-400 mt-2">
                Required Columns: {requiredHeaders.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
