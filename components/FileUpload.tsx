import React, { ChangeEvent, useState } from 'react';
import { Upload, FileCheck, FileX } from 'lucide-react';
import { getTabularHeaders } from '../utils/tabularParser';
import { useI18n } from '../i18n';

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
  accept = '.csv,.xlsx,.xls',
  file,
  onFileSelect,
  requiredHeaders,
}) => {
  const { t } = useI18n();
  const [headerError, setHeaderError] = useState<string>('');

  const validateHeaders = async (selectedFile: File) => {
    if (!requiredHeaders || requiredHeaders.length === 0) {
      setHeaderError('');
      onFileSelect(selectedFile);
      return;
    }

    try {
      const headers = await getTabularHeaders(selectedFile);
      const headerSet = new Set(headers.map((h) => h.trim().toLowerCase()));
      const missing = requiredHeaders.filter((h) => !headerSet.has(h.toLowerCase()));

      if (missing.length > 0) {
        setHeaderError(t('upload.missingHeaders', { columns: missing.join(', ') }));
        onFileSelect(null);
        return;
      }

      setHeaderError('');
      onFileSelect(selectedFile);
    } catch {
      setHeaderError(t('upload.parseFailed'));
      onFileSelect(null);
    }
  };

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0] || null;

    if (!selectedFile) {
      setHeaderError('');
      onFileSelect(null);
      return;
    }

    await validateHeaders(selectedFile);
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
            <p className="text-sm font-medium text-red-800">{t('upload.checkFailed')}</p>
            <p className="text-xs text-red-600 mt-1">{headerError}</p>
          </div>
        ) : file ? (
          <div className="text-center">
            <FileCheck className="w-10 h-10 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-800">{file.name}</p>
            <p className="text-xs text-green-600 mt-1">{t('upload.fileUploaded')}</p>
          </div>
        ) : (
          <div className="text-center pointer-events-none">
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">{t('upload.dropOrClick')}</p>
            <p className="text-xs text-gray-400 mt-1">{description}</p>
            {requiredHeaders && (
              <p className="text-[10px] text-gray-400 mt-2">
                {t('labels.requiredColumns')} {requiredHeaders.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
