import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  Filter,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
} from 'lucide-react';
import type { AuditLogItem, AuditVerifyResponse } from '../types';
import { adminApi } from '../services/api';

export const AuditViewer: React.FC = () => {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [documentIdFilter, setDocumentIdFilter] = useState('');
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');

  // Tamper Verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Copied state
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchLogs = async (pageNum = page) => {
    setLoading(true);
    try {
      const res = await adminApi.getAuditLogs({
        page: pageNum,
        limit,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        userId: userIdFilter.trim() || undefined,
        documentId: documentIdFilter.trim() || undefined,
        startDate: startDateFilter || undefined,
        endDate: endDateFilter || undefined,
      });

      setLogs(res.logs || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
      setPage(res.page || pageNum);
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(1);
  }, [statusFilter, startDateFilter, endDateFilter]);

  const handleVerifyChain = async () => {
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);

    try {
      const result = await adminApi.verifyAuditChain();
      setVerifyResult(result);
    } catch (err: any) {
      setVerifyError(err.response?.data?.message || err.message || 'Audit chain verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const getActionBadge = (action: string) => {
    let color = 'bg-gray-800 text-gray-300 border-gray-700';
    if (action.includes('UPLOAD')) color = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
    if (action.includes('DOWNLOAD')) color = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
    if (action.includes('EDIT')) color = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    if (action.includes('DELETE')) color = 'bg-rose-500/10 text-rose-400 border-rose-500/20';
    if (action.includes('GRANT')) color = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    if (action.includes('REVOKE')) color = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
    if (action.includes('DENIED')) color = 'bg-rose-500/10 text-rose-400 border-rose-500/20 font-bold';

    return (
      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide border ${color}`}>
        {action}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header & Verification Card */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-900/90 to-[#121826] p-6 rounded-2xl border border-gray-800 shadow-2xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                <Fingerprint className="w-4 h-4" />
              </div>
              <h2 className="text-lg font-bold text-gray-100">Cryptographic Hash-Chain Verification</h2>
            </div>
            <p className="text-xs text-gray-400 max-w-2xl leading-relaxed">
              Every audit record is sealed with SHA-256 and cryptographically chained to its predecessor.
              Running verification validates that zero records have been altered, injected, or deleted.
            </p>
          </div>

          <button
            onClick={handleVerifyChain}
            disabled={verifying}
            className="flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs font-bold shadow-xl shadow-indigo-600/30 transition-all shrink-0 disabled:opacity-50"
          >
            {verifying ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                <span>Traversing Hash Chain...</span>
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Run Hash-Chain Audit Verification</span>
              </>
            )}
          </button>
        </div>

        {/* Verification Status Banner */}
        {verifyResult && (
          <div
            className={`mt-5 p-4 rounded-xl border flex items-start gap-3.5 transition-all ${
              verifyResult.isValid
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {verifyResult.isValid ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            )}
            <div className="text-xs space-y-1">
              <p className="font-bold text-sm">
                {verifyResult.isValid
                  ? 'CRYPTOGRAPHIC CHAIN INTACT: VERIFICATION PASSED'
                  : 'TAMPER DETECTED! HASH MISMATCH OR LINKAGE BROKEN'}
              </p>
              <p className="text-gray-300 font-normal">
                {verifyResult.isValid
                  ? 'All sequential blocks, timestamps, and SHA-256 digital seals match perfectly across the database.'
                  : `Chain validation failed at block: ${verifyResult.corruptedAtId || 'Unknown'}. Record contents or hashes were modified!`}
              </p>
              {verifyResult.totalLogs !== undefined && (
                <p className="text-[11px] opacity-75 font-mono">
                  Verified {verifyResult.totalLogs} blocks from genesis forward.
                </p>
              )}
            </div>
          </div>
        )}

        {verifyError && (
          <div className="mt-5 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-3">
            <XCircle className="w-5 h-5 shrink-0" />
            <span>Verification error: {verifyError}</span>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-900/60 p-4 rounded-2xl border border-gray-800">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 bg-gray-950 px-3 py-1.5 rounded-xl border border-gray-800">
            <Filter className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-[11px] text-gray-400">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs text-gray-200 focus:outline-none cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="DENIED">DENIED (Security Checks)</option>
            </select>
          </div>

          {/* User ID Filter */}
          <div className="relative">
            <input
              type="text"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchLogs(1)}
              placeholder="Filter by User ID / email..."
              className="w-48 pl-3 pr-3 py-1.5 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Document ID Filter */}
          <div className="relative">
            <input
              type="text"
              value={documentIdFilter}
              onChange={(e) => setDocumentIdFilter(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchLogs(1)}
              placeholder="Filter by Document ID..."
              className="w-48 pl-3 pr-3 py-1.5 rounded-xl bg-gray-950 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Search Button */}
          <button
            onClick={() => fetchLogs(1)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-xs font-medium transition-colors"
          >
            <Search className="w-3 h-3" />
            Apply Filters
          </button>
        </div>

        <button
          onClick={() => fetchLogs()}
          disabled={loading}
          className="p-2 rounded-xl bg-gray-950 border border-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Refresh Logs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-gray-900/40 rounded-2xl border border-gray-800/80 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-950/70 border-b border-gray-800 text-gray-400 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="px-4 py-3.5">Timestamp</th>
                <th className="px-4 py-3.5">Action</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">User</th>
                <th className="px-4 py-3.5">Target Doc</th>
                <th className="px-4 py-3.5">IP / Context</th>
                <th className="px-4 py-3.5 font-mono">Current Seal (Hash)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50 text-gray-300">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    <div className="w-6 h-6 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mx-auto mb-2"></div>
                    Loading audit trail entries...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    No audit records match the selected criteria.
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const isSuccess = log.status === 'SUCCESS';

                  return (
                    <tr key={log.id} className="hover:bg-gray-800/30 transition-colors">
                      {/* Timestamp */}
                      <td className="px-4 py-3.5 text-gray-400 whitespace-nowrap text-[11px] font-mono">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {getActionBadge(log.action)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                            isSuccess
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}
                        >
                          {isSuccess ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <XCircle className="w-3 h-3 text-rose-400" />
                          )}
                          {log.status}
                        </span>
                      </td>

                      {/* User */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-gray-300 truncate max-w-[150px] block" title={log.userId || 'Anonymous'}>
                          {log.user?.email || (log.userId ? log.userId.slice(0, 12) + '...' : 'System')}
                        </span>
                      </td>

                      {/* Document ID */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className="text-gray-400 truncate max-w-[150px] block" title={log.documentId || 'None'}>
                          {log.document?.title || (log.documentId ? log.documentId.slice(0, 10) + '...' : '-')}
                        </span>
                      </td>

                      {/* IP / Reason */}
                      <td className="px-4 py-3.5 text-gray-400 text-[11px] max-w-xs truncate" title={log.reason || ''}>
                        <span className="font-mono text-[10px] text-gray-500 block">{log.ipAddress || '127.0.0.1'}</span>
                        <span className="truncate block text-gray-400">{log.reason || 'Completed successfully'}</span>
                      </td>

                      {/* Hash Seal */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <button
                          onClick={() => copyToClipboard(log.currentHash)}
                          className="flex items-center gap-1.5 font-mono text-[10px] bg-gray-950 px-2 py-1 rounded border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-indigo-400 transition-colors"
                          title={`Click to copy SHA-256 seal:\n${log.currentHash}`}
                        >
                          <span>{log.currentHash ? log.currentHash.slice(0, 10) + '...' : 'N/A'}</span>
                          {copiedHash === log.currentHash ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-gray-500" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="px-6 py-3.5 border-t border-gray-800 bg-gray-950/60 flex items-center justify-between text-xs text-gray-400">
          <div>
            Showing <span className="font-semibold text-gray-200">{logs.length}</span> of{' '}
            <span className="font-semibold text-gray-200">{total}</span> records
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchLogs(page - 1)}
              disabled={page <= 1 || loading}
              className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 hover:bg-gray-800 disabled:opacity-40 transition-colors"
              title="Previous Page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs font-mono">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => fetchLogs(page + 1)}
              disabled={page >= totalPages || loading}
              className="p-1.5 rounded-lg bg-gray-900 border border-gray-800 hover:bg-gray-800 disabled:opacity-40 transition-colors"
              title="Next Page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
