import React, { useState, useEffect } from 'react';
import {
  FileText,
  Search,
  Filter,
  Download,
  Trash2,
  Edit,
  KeyRound,
  Upload,
  RefreshCw,
  Calendar,
  Layers,
  FileCode,
  Image,
  AlertTriangle,
  FolderOpen,
  CheckCircle2,
  X,
  Eye,
} from 'lucide-react';
import type { User, DocumentItem } from '../types';
import { documentApi } from '../services/api';
import { UploadModal } from './UploadModal';
import { PermissionModal } from './PermissionModal';
import { EditModal } from './EditModal';
import { PreviewModal } from './PreviewModal';

interface DocumentHubProps {
  user: User;
}

export const DocumentHub: React.FC<DocumentHubProps> = ({ user }) => {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'size'>('date');

  // Modals state
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [permissionDoc, setPermissionDoc] = useState<DocumentItem | null>(null);
  const [editDoc, setEditDoc] = useState<DocumentItem | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DocumentItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchDocuments = async () => {
    setLoading(true);
    setError(null);
    try {
      const docs = await documentApi.list();
      setDocuments(docs);
    } catch (err: any) {
      console.error('Fetch documents error:', err);
      setError(err.response?.data?.error || 'Failed to fetch documents from server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
  }, []);

  const handleDownload = async (doc: DocumentItem) => {
    setDownloadingId(doc.id);
    try {
      await documentApi.download(doc.id, doc.originalName || `${doc.title}.bin`);
      setToast({ type: 'success', message: `Downloaded "${doc.title}"` });
    } catch (err: any) {
      console.error('Download error:', err);
      setToast({ type: 'error', message: `Download blocked: ${err.response?.data?.error || err.message}` });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = async (doc: DocumentItem) => {
    if (!window.confirm(`Are you sure you want to delete "${doc.title}"? This cannot be undone.`)) {
      return;
    }
    setDeletingId(doc.id);
    try {
      await documentApi.delete(doc.id);
      setToast({ type: 'info', message: `Deleted "${doc.title}"` });
      await fetchDocuments();
    } catch (err: any) {
      console.error('Delete error:', err);
      setToast({ type: 'error', message: `Delete failed: ${err.response?.data?.error || err.message}` });
    } finally {
      setDeletingId(null);
    }
  };

  // Filter & sort logic
  const filteredDocuments = documents
    .filter((doc) => {
      const matchesSearch =
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.originalName && doc.originalName.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesCategory =
        selectedCategory === 'ALL' || (doc.category && doc.category.toLowerCase() === selectedCategory.toLowerCase());
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'size') return b.size - a.size;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const getMimeIcon = (mimeType: string) => {
    if (mimeType.includes('pdf')) {
      return <FileText className="w-5 h-5 text-rose-400" />;
    }
    if (mimeType.includes('image')) {
      return <Image className="w-5 h-5 text-emerald-400" />;
    }
    return <FileCode className="w-5 h-5 text-cyan-400" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Check role capabilities
  const userRole = (user?.role || '').toString().toUpperCase();
  const canUpload = userRole === 'ADMIN' || userRole === 'OWNER';

  return (
    <div className="space-y-6">
      {/* Top Action & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 bg-gray-900/60 p-4 rounded-2xl border border-gray-800/80 backdrop-blur-md">
        <div className="flex-1 flex flex-wrap items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search documents by title or filename..."
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1.5 bg-gray-950 px-3 py-1.5 rounded-xl border border-gray-800">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-transparent text-xs text-gray-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Categories</option>
              <option value="General">General</option>
              <option value="Confidential">Confidential</option>
              <option value="Financial">Financial</option>
              <option value="Legal">Legal</option>
              <option value="Engineering">Engineering</option>
              <option value="Audit">Audit</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="flex items-center gap-1.5 bg-gray-950 px-3 py-1.5 rounded-xl border border-gray-800">
            <span className="text-[11px] text-gray-400">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-transparent text-xs text-gray-200 focus:outline-none cursor-pointer"
            >
              <option value="date">Date (Newest)</option>
              <option value="title">Title (A-Z)</option>
              <option value="size">Size (Largest)</option>
            </select>
          </div>

          <button
            onClick={fetchDocuments}
            disabled={loading}
            className="p-2 rounded-xl bg-gray-950 border border-gray-800 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
            title="Refresh List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Upload Button */}
        {canUpload ? (
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all shrink-0 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            Upload Document
          </button>
        ) : (
          <div className="px-3 py-1.5 rounded-xl bg-gray-800/50 border border-gray-800 text-[11px] text-gray-400">
            Read-only persona (View & Download)
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4" />
            <span>{error}</span>
          </div>
          <button onClick={fetchDocuments} className="underline hover:text-rose-300 cursor-pointer">
            Retry
          </button>
        </div>
      )}

      {/* Documents Table / Grid */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="w-10 h-10 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-xs text-gray-400">Loading secure documents...</p>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="py-20 text-center bg-gray-900/30 rounded-2xl border border-gray-800/80">
          <div className="w-12 h-12 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center mx-auto mb-3 text-gray-500">
            <FolderOpen className="w-6 h-6" />
          </div>
          <h4 className="text-sm font-medium text-gray-300">No documents found</h4>
          <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
            {searchQuery || selectedCategory !== 'ALL'
              ? 'Try modifying your search or filter keywords.'
              : canUpload
              ? 'Start by uploading a verified PDF, image, or text asset.'
              : 'No documents have been shared with your account yet.'}
          </p>
          {canUpload && !searchQuery && selectedCategory === 'ALL' && (
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload First Document
            </button>
          )}
        </div>
      ) : (
        <div className="bg-gray-900/40 rounded-2xl border border-gray-800/80 overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-950/70 border-b border-gray-800 text-gray-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">Document</th>
                  <th className="px-4 py-3.5">Category</th>
                  <th className="px-4 py-3.5">Size / MIME</th>
                  <th className="px-4 py-3.5">Owner</th>
                  <th className="px-4 py-3.5">Created Date</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50 text-gray-300">
                {filteredDocuments.map((doc) => {
                  const isOwnerOrAdmin = user.role === 'ADMIN' || doc.ownerId === user.id;
                  const hasViewPermission =
                    isOwnerOrAdmin ||
                    doc.canView === true ||
                    doc.userAccessLevel === 'READ' ||
                    doc.userAccessLevel === 'EDIT';
                  const hasEditPermission =
                    isOwnerOrAdmin ||
                    doc.canEdit === true ||
                    doc.userAccessLevel === 'EDIT';
                  const canShare = isOwnerOrAdmin;
                  const canDelete = isOwnerOrAdmin;

                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-gray-800/30 transition-colors group"
                    >
                      {/* Title & icon */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gray-800 border border-gray-700/80 flex items-center justify-center shrink-0">
                            {getMimeIcon(doc.mimeType)}
                          </div>
                          <div className="min-w-0">
                            <span className="font-semibold text-gray-100 block truncate group-hover:text-indigo-300 transition-colors">
                              {doc.title}
                            </span>
                            <span className="text-[11px] text-gray-500 block truncate font-mono">
                              {doc.originalName || 'Asset Document'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-gray-800/80 text-gray-300 border border-gray-700/60">
                          <Layers className="w-3 h-3 text-gray-400" />
                          {doc.category || 'General'}
                        </span>
                      </td>

                      {/* Size & MIME */}
                      <td className="px-4 py-4">
                        <span className="text-gray-200 block font-mono">{formatFileSize(doc.size)}</span>
                        <span className="text-[10px] text-gray-500 font-mono truncate block max-w-[120px]">
                          {doc.mimeType}
                        </span>
                      </td>

                      {/* Owner & Permission Level */}
                      <td className="px-4 py-4 text-gray-400">
                        <div className="flex flex-col">
                          <span className="text-xs truncate block max-w-[150px]" title={doc.ownerEmail || doc.ownerId}>
                            {doc.ownerId === user.id ? (
                              <span className="text-emerald-400 font-medium">You (Owner)</span>
                            ) : (
                              doc.ownerEmail || `${doc.ownerId.slice(0, 10)}...`
                            )}
                          </span>
                          <div className="mt-1">
                            {isOwnerOrAdmin ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                                {user.role === 'ADMIN' ? 'ADMIN' : 'OWNER'}
                              </span>
                            ) : hasEditPermission ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold">
                                EDIT
                              </span>
                            ) : hasViewPermission ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                                VIEW
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-500 font-medium">
                                NO ACCESS
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-4 text-gray-400 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-gray-500" />
                          <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          {/* 1. View / Preview Button */}
                          {hasViewPermission ? (
                            <button
                              onClick={() => setPreviewDoc(doc)}
                              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-cyan-600/20 transition-colors cursor-pointer"
                              title="Preview Document (View)"
                            >
                              <Eye className="w-4 h-4 text-cyan-400" />
                            </button>
                          ) : (
                            <button
                              disabled
                              className="p-2 rounded-lg text-gray-600 cursor-not-allowed opacity-30"
                              title="View permission not granted"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}

                          {/* 2. Download Button */}
                          {hasViewPermission ? (
                            <button
                              onClick={() => handleDownload(doc)}
                              disabled={downloadingId === doc.id}
                              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-indigo-600/20 transition-colors cursor-pointer"
                              title="Download Document"
                            >
                              <Download className={`w-4 h-4 ${downloadingId === doc.id ? 'animate-bounce text-indigo-400' : ''}`} />
                            </button>
                          ) : (
                            <button
                              disabled
                              className="p-2 rounded-lg text-gray-600 cursor-not-allowed opacity-30"
                              title="Download permission not granted"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          )}

                          {/* 3. Edit Button - Available to ADMIN, OWNER, or EDIT permission */}
                          {hasEditPermission ? (
                            <button
                              onClick={() => setEditDoc(doc)}
                              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-amber-600/20 transition-colors cursor-pointer"
                              title="Edit Title / Category"
                            >
                              <Edit className="w-4 h-4 text-amber-400" />
                            </button>
                          ) : (
                            <button
                              disabled
                              className="p-2 rounded-lg text-gray-600 cursor-not-allowed opacity-30"
                              title="Read-only access: Edit not allowed"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          )}

                          {/* 4. Share / Permissions Button - Available ONLY to ADMIN or Document OWNER */}
                          {canShare ? (
                            <button
                              onClick={() => setPermissionDoc(doc)}
                              className="p-2 rounded-lg text-gray-300 hover:text-white hover:bg-emerald-600/20 transition-colors cursor-pointer"
                              title="Manage Access Permissions (Share)"
                            >
                              <KeyRound className="w-4 h-4 text-emerald-400" />
                            </button>
                          ) : null}

                          {/* 5. Delete Button - Available ONLY to ADMIN or Document OWNER */}
                          {canDelete ? (
                            <button
                              onClick={() => handleDelete(doc)}
                              disabled={deletingId === doc.id}
                              className="p-2 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Delete Document"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onSuccess={() => {
          fetchDocuments();
          setToast({ type: 'success', message: 'Document uploaded and verified successfully!' });
        }}
      />

      <PermissionModal
        isOpen={!!permissionDoc}
        onClose={() => setPermissionDoc(null)}
        document={permissionDoc}
      />

      <EditModal
        isOpen={!!editDoc}
        onClose={() => setEditDoc(null)}
        document={editDoc}
        onSuccess={fetchDocuments}
      />

      <PreviewModal
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        document={previewDoc}
        onDownload={handleDownload}
      />

      {/* Floating Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-gray-900 border border-gray-700/80 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-5 duration-300">
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
          {toast.type === 'error' && <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />}
          {toast.type === 'info' && <Layers className="w-5 h-5 text-indigo-400 shrink-0" />}
          <span className="text-xs font-medium text-gray-100">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
