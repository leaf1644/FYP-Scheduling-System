import React, { ChangeEvent } from 'react';
import { Upload, FileCheck, FileX } from 'lucide-react';

interface FileUploadProps {
  label: string;
  description: string;
  accept?: string;
  file: File | null;
  onFileSelect: (file: File) => void;
  requiredHeaders?: string[];
}

const FileUpload: React.FC<FileUploadProps> = ({ 
  label, 
  description, 
  accept = ".csv", 
  file, 
  onFileSelect,
  requiredHeaders 
}) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileSelect(e.target.files[0]);
    }
  };

  return (
    <div className="mb-6">
      <label className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <div className={`
        relative border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors
        ${file ? 'border-green-400 bg-green-50' : 'border-gray-300 hover:border-blue-400 bg-white'}
      `}>
        <input 
          type="file" 
          accept={accept}
          onChange={handleChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
        
        {file ? (
          <div className="text-center">
            <FileCheck className="w-10 h-10 text-green-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-green-800">{file.name}</p>
            <p className="text-xs text-green-600 mt-1">已準備好</p>
          </div>
        ) : (
          <div className="text-center pointer-events-none">
            <Upload className="w-10 h-10 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500 font-medium">點擊或拖放文件</p>
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