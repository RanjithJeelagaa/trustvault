import React, { useState, useEffect } from 'react';
import {
  X,
  Eye,
  Download,
  FileText,
  Image as ImageIcon,
  Archive,
  File,
  AlertCircle,
  Loader2,
  Layers,
} from 'lucide-react';
import type { DocumentItem } from '../types';

interface PreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: DocumentItem | null;
  onDownload: (doc: DocumentItem) => void;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFallbackIcon(mime: string) {
  const m = mime.toLowerCase();
  if (m.startsWith('image/')) {
    return <ImageIcon className="w-10 h-10 text-indigo-400" />;
  }
  if (m.includes('pdf') || m.startsWith('text/') || m.includes('document')) {
    return <FileText className="w-10 h-10 text-emerald-400" />;
  }
  if (m.includes('zip') || m.includes('tar') || m.includes('compressed') || m.includes('archive')) {
    return <Archive className="w-10 h-10 text-amber-400" />;
  }
  return <File className="w-10 h-10 text-indigo-400" />;
}

export const PreviewModal: React.FC<PreviewModalProps> = ({
  isOpen,
  onClose,
  document,
  onDownload,
}) => {
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [blobSize, setBlobSize] = useState<number | null>(null);

  useEffect(() => {
    let activeUrl: string | null = null;
    let isMounted = true;

    if (isOpen && document) {
      setLoading(true);
      setError(null);
      setImageError(false);
      setPreviewUrl(null);
      setTextContent(null);
      setBlobSize(null);

      const fetchDocument = async () => {
        try {
          const token = localStorage.getItem('trustvault_token');
          const response = await fetch(`/api/documents/${document.id}/view`, {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Failed to fetch preview (HTTP ${response.status})`);
          }

          const blob = await response.blob();
          if (!isMounted) return;

          setBlobSize(blob.size);
          const objectUrl = URL.createObjectURL(blob);
          activeUrl = objectUrl;
          setPreviewUrl(objectUrl);

          const contentType = response.headers.get('content-type') || document.mimeType || '';
          const mime = contentType.split(';')[0].trim().toLowerCase();

          if (mime.startsWith('text/') || mime === 'application/json') {
            try {
              const text = await blob.text();
              if (isMounted) setTextContent(text);
            } catch (err) {
              console.error('Error reading text blob:', err);
            }
          }
        } catch (err: any) {
          console.error('Preview error:', err);
          if (isMounted) {
            setError(err.message || 'Failed to preview document. You may lack VIEW permissions.');
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      fetchDocument();
    }

    return () => {
      isMounted = false;
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
      }
    };
  }, [isOpen, document]);

  if (!isOpen || !document) return null;

  const mime = document.mimeType.toLowerCase();
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';
  const isText = mime.startsWith('text/') || mime === 'application/json';

  // Check if content is corrupted, empty, or placeholder (< 100 bytes)
  const isTooSmall = (blobSize !== null && blobSize < 100) || (document.size > 0 && document.size < 100);
  const isSupportedPreview = (isImage || isPdf || isText) && !imageError && !isTooSmall;

  const handleImageError = () => {
    console.warn('Image rendering error for preview:', document.title);
    setImageError(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#111827] border border-gray-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
              <Eye className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-gray-100 truncate">{document.title}</h3>
              <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-0.5">
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3 text-gray-500" />
                  {document.category || 'General'}
                </span>
                <span>•</span>
                <span className="font-mono text-gray-500">{document.mimeType}</span>
                <span>•</span>
                <span className="text-gray-400">{document.originalName || 'Asset Document'}</span>
                <span>•</span>
                <span className="text-gray-400 font-mono">{formatBytes(blobSize || document.size)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors shrink-0 ml-4 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-950/40">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
              <p className="text-xs text-gray-400">Verifying permissions & loading secure stream...</p>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-3 my-8 max-w-lg mx-auto">
              <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-rose-300">Preview Access Denied</p>
                <p className="mt-1 text-rose-400/90">{error}</p>
              </div>
            </div>
          ) : isSupportedPreview ? (
            <div className="flex flex-col items-center justify-center min-h-[350px]">
              {isImage && previewUrl && (
                <div className="flex items-center justify-center w-full">
                  <img
                    src={previewUrl}
                    alt={document.title}
                    className="max-h-[60vh] max-w-full object-contain mx-auto rounded shadow-lg border border-slate-800"
                    onError={handleImageError}
                  />
                </div>
              )}

              {isPdf && previewUrl && (
                <div className="w-full h-[60vh] rounded-xl overflow-hidden border border-slate-800 shadow-md">
                  <iframe
                    src={previewUrl}
                    title={document.title}
                    className="w-full h-[60vh] border-0 rounded bg-slate-900"
                  />
                </div>
              )}

              {isText && textContent !== null && (
                <div className="w-full max-h-[60vh]">
                  <pre className="overflow-auto max-h-[60vh] p-4 bg-slate-900 rounded text-sm text-slate-200 font-mono whitespace-pre-wrap border border-slate-800">
                    {textContent}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            /* Clean Fallback Card (Empty/corrupt, unsupported format, or image render error) */
            <div className="flex flex-col items-center justify-center p-8 bg-slate-900/60 border border-slate-800 rounded-2xl max-w-md mx-auto text-center shadow-lg my-8 animate-in fade-in duration-200">
              <div className="w-20 h-20 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mb-4 shadow-inner">
                {getFallbackIcon(document.mimeType)}
              </div>
              <h4 className="text-base font-semibold text-slate-100 truncate max-w-sm">
                {document.originalName || document.title}
              </h4>
              <div className="flex items-center gap-2 justify-center mt-2">
                <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  {document.mimeType}
                </span>
                <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300 font-mono border border-slate-700">
                  {formatBytes(blobSize || document.size)}
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-4 max-w-xs">
                Preview not available for this file or file content is empty.
              </p>
              <button
                onClick={() => onDownload(document)}
                className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors shadow cursor-pointer"
              >
                <Download className="w-4 h-4 text-indigo-400" />
                Download to View
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-800 bg-gray-900/50 shrink-0">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="font-semibold text-gray-300">Access Level:</span>
            <span className="px-2 py-0.5 rounded text-[11px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              {document.userAccessLevel || 'AUTHORIZED'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={() => onDownload(document)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors shadow-lg shadow-indigo-600/20 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Download Document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
