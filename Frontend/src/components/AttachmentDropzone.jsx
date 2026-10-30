import React, { useRef, useState, useEffect } from 'react';
import { Upload, X, FileText, Image as ImageIcon, AlertCircle, CheckCircle2 } from 'lucide-react';

export const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.txt', '.log'];
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) {
        return `${mb.toFixed(2)} MB`;
    }
    const kb = bytes / 1024;
    return `${kb.toFixed(1)} KB`;
}

export function validateFile(file) {
    if (!file) return { valid: false, error: "No file selected." };

    // 1. Check size limit
    if (file.size > MAX_FILE_SIZE_BYTES) {
        const sizeFormatted = (file.size / (1024 * 1024)).toFixed(2);
        return {
            valid: false,
            error: `File is too large (${sizeFormatted} MB). Maximum allowed size is 10 MB.`
        };
    }

    // 2. Check extension
    const name = file.name.toLowerCase();
    const hasValidExt = ALLOWED_EXTENSIONS.some(ext => name.endsWith(ext));
    if (!hasValidExt) {
        return {
            valid: false,
            error: `Unsupported file type. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ')}`
        };
    }

    return { valid: true, error: null };
}

export function AttachmentDropzone({
    file,
    onFileSelect,
    onFileRemove,
    onError,
    disabled = false,
    label = "Attachment / Screenshot (Optional)"
}) {
    const fileInputRef = useRef(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [previewUrl, setPreviewUrl] = useState(null);
    const [validationError, setValidationError] = useState('');

    const isImage = file && (
        file.type?.startsWith('image/') || 
        ['.png', '.jpg', '.jpeg', '.webp'].some(ext => file.name?.toLowerCase().endsWith(ext))
    );

    useEffect(() => {
        if (!file) {
            setPreviewUrl(null);
            return;
        }

        if (isImage) {
            const url = URL.createObjectURL(file);
            setPreviewUrl(url);
            return () => URL.revokeObjectURL(url);
        } else {
            setPreviewUrl(null);
        }
    }, [file, isImage]);

    const handleIncomingFile = (selectedFile) => {
        if (!selectedFile) return;

        const validation = validateFile(selectedFile);
        if (!validation.valid) {
            setValidationError(validation.error);
            onError?.(validation.error);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
        }

        setValidationError('');
        onError?.('');
        onFileSelect?.(selectedFile);
    };

    const handleInputChange = (e) => {
        const selected = e.target.files?.[0];
        handleIncomingFile(selected);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!disabled) setIsDragOver(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (disabled) return;

        const dropped = e.dataTransfer.files?.[0];
        handleIncomingFile(dropped);
    };

    const handleRemove = () => {
        setValidationError('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        onFileRemove?.();
    };

    return (
        <div className="w-full space-y-2">
            {label && (
                <div className="flex items-center justify-between">
                    <label className="text-sm font-bold text-gray-700">{label}</label>
                    <span className="text-xs font-semibold text-gray-400">Max: 10 MB</span>
                </div>
            )}

            {!file ? (
                <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => !disabled && fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
                            e.preventDefault();
                            fileInputRef.current?.click();
                        }
                    }}
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label="Upload attachment: Drag and drop or click to select file up to 10 MB"
                    className={`group relative h-40 border-2 border-dashed rounded-2xl transition-all flex flex-col items-center justify-center p-6 text-center select-none ${
                        disabled ? 'opacity-50 cursor-not-allowed bg-gray-50 border-gray-200' :
                        isDragOver ? 'bg-emerald-50 border-emerald-400 scale-[1.01]' :
                        'bg-gray-50/60 border-gray-200 hover:bg-emerald-50/50 hover:border-emerald-300 cursor-pointer'
                    }`}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleInputChange}
                        accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.log"
                        disabled={disabled}
                        tabIndex={-1}
                        className="hidden"
                        aria-hidden="true"
                    />
                    <div className="w-12 h-12 bg-white rounded-xl shadow-xs border border-gray-100 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                        <Upload className="text-emerald-500 w-5 h-5" aria-hidden="true" />
                    </div>
                    <p className="text-sm font-bold text-gray-700">
                        Drag and drop or <span className="text-emerald-600 underline">browse</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1 font-medium">
                        Supports PNG, JPG, WebP, PDF, TXT, LOG (up to 10 MB)
                    </p>
                </div>
            ) : (
                <div 
                    className="relative rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-4 shadow-xs animate-in fade-in zoom-in-95 duration-200"
                    role="region"
                    aria-label={`Selected attachment: ${file.name}`}
                >
                    {/* Thumbnail / Document Icon */}
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-100 bg-gray-50 flex items-center justify-center shrink-0 shadow-inner">
                        {isImage && previewUrl ? (
                            <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                        ) : (
                            <FileText className="text-emerald-600 w-8 h-8" aria-hidden="true" />
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate" title={file.name}>
                            {file.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1 text-xs font-semibold text-gray-500">
                            <span className="px-2 py-0.5 rounded-md bg-gray-100 border border-gray-200 font-mono text-[11px]">
                                {formatBytes(file.size)} / 10 MB
                            </span>
                            <span className="text-emerald-600 flex items-center gap-1 font-bold">
                                <CheckCircle2 size={13} aria-hidden="true" /> Validated
                            </span>
                        </div>
                    </div>

                    {/* Remove Action */}
                    <button
                        type="button"
                        onClick={handleRemove}
                        disabled={disabled}
                        aria-label={`Remove file ${file.name}`}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0 focus:outline-hidden focus:ring-2 focus:ring-red-400"
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>
            )}

            {/* Validation Error Banner */}
            {validationError && (
                <div 
                    role="alert" 
                    className="flex items-center gap-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 p-2.5 rounded-xl animate-in fade-in duration-200"
                >
                    <AlertCircle size={16} className="shrink-0 text-red-500" aria-hidden="true" />
                    <span>{validationError}</span>
                </div>
            )}
        </div>
    );
}

export default AttachmentDropzone;
