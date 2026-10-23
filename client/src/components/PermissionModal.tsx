import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserPlus,
  Trash2,
  ShieldCheck,
  AlertCircle,
  RefreshCw,
  KeyRound,
  CheckCircle2,
  Search,
  Check,
  Users,
} from 'lucide-react';
import type { DocumentItem, PermissionItem, AccessLevel, User } from '../types';
import { documentApi } from '../services/api';

interface PermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: DocumentItem | null;
}

export const PermissionModal: React.FC<PermissionModalProps> = ({ isOpen, onClose, document }) => {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [selectedEmails, setSelectedEmails] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('READ');
  const [loading, setLoading] = useState(false);
  const [granting, setGranting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && document) {
      loadPermissionsAndUsers();
      setSelectedEmails([]);
      setSearchQuery('');
      setError(null);
      setSuccessMsg(null);
    }
  }, [isOpen, document]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen || !document) return null;

  const loadPermissionsAndUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const [permData, usersData] = await Promise.all([
        documentApi.getPermissions(document.id),
        documentApi.getUsers().catch(() => []),
      ]);
      setPermissions(permData);
      setAvailableUsers(usersData);
    } catch (err: any) {
      console.error('Failed to load permissions/users:', err);
      setError(err.response?.data?.error || 'Failed to fetch document permissions');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUser = (email: string) => {
    const normalized = email.toLowerCase().trim();
    if (selectedEmails.includes(normalized)) {
      setSelectedEmails(selectedEmails.filter((e) => e !== normalized));
    } else {
      setSelectedEmails([...selectedEmails, normalized]);
    }
    setSearchQuery('');
  };

  const handleRemoveEmail = (email: string) => {
    setSelectedEmails(selectedEmails.filter((e) => e !== email));
  };

  const handleAddCustomEmail = () => {
    const raw = searchQuery.trim().toLowerCase();
    if (!raw) return;
    const emailsToAdd = raw
      .split(/[\s,]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0 && e.includes('@'));

    if (emailsToAdd.length === 0) {
      setError('Please enter a valid email address');
      return;
    }

    const uniqueCombined = Array.from(new Set([...selectedEmails, ...emailsToAdd]));
    setSelectedEmails(uniqueCombined);
    setSearchQuery('');
    setIsDropdownOpen(false);
    setError(null);
  };

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEmails.length === 0 && !searchQuery.trim()) {
      setError('Please select or enter at least one user email to grant access.');
      return;
    }

    let finalEmails = [...selectedEmails];
    if (searchQuery.trim() && searchQuery.includes('@')) {
      finalEmails.push(searchQuery.trim().toLowerCase());
    }

    if (finalEmails.length === 0) {
      setError('Please provide at least one valid user email.');
      return;
    }

    setGranting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      await documentApi.grantPermission(document.id, {
        userEmails: finalEmails,
        accessLevel,
      });

      setSuccessMsg(`Successfully granted ${accessLevel} access to ${finalEmails.length} user(s).`);
      setSelectedEmails([]);
      setSearchQuery('');
      setIsDropdownOpen(false);
      await loadPermissionsAndUsers();
    } catch (err: any) {
      console.error('Grant permission error:', err);
      setError(err.response?.data?.error || 'Failed to grant access permissions');
    } finally {
      setGranting(false);
    }
  };

  const handleRevoke = async (userId: string, email?: string) => {
    setRevokingId(userId);
    setError(null);
    setSuccessMsg(null);
    try {
      await documentApi.revokePermission(document.id, userId);
      setSuccessMsg(`Revoked document access for ${email || userId}`);
      await loadPermissionsAndUsers();
    } catch (err: any) {
      console.error('Revoke permission error:', err);
      setError(err.response?.data?.error || 'Failed to revoke document access');
    } finally {
      setRevokingId(null);
    }
  };

  // Filter available registered users (exclude document owner and users who already have active permissions)
  const candidateUsers = availableUsers.filter((u) => {
    const isOwner = document.ownerId === u.id;
    const isGranted = permissions.some((p) => p.userId === u.id || p.user?.email === u.email);
    const matchesSearch =
      u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.role.toLowerCase().includes(searchQuery.toLowerCase());
    return !isOwner && !isGranted && matchesSearch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111827] border border-gray-800 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-100">Document Access & Sharing</h3>
              <p className="text-xs text-gray-400 truncate max-w-sm" title={document.title}>
                {document.title}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Grant Access Section */}
          <div className="p-4 rounded-xl bg-gray-900/60 border border-gray-800 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-2">
                <UserPlus className="w-3.5 h-3.5 text-indigo-400" />
                Add Users & Share Access
              </h4>
              {selectedEmails.length > 0 && (
                <span className="text-[11px] text-indigo-400 font-medium">
                  {selectedEmails.length} user{selectedEmails.length > 1 ? 's' : ''} selected
                </span>
              )}
            </div>

            {/* Selected user chips */}
            {selectedEmails.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-gray-950/60 rounded-xl border border-gray-800 max-h-24 overflow-y-auto">
                {selectedEmails.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-indigo-600/20 text-indigo-300 border border-indigo-500/30"
                  >
                    <span>{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveEmail(email)}
                      className="hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setSelectedEmails([])}
                  className="text-[10px] text-gray-500 hover:text-gray-300 px-1 py-1 underline transition-colors"
                >
                  Clear all
                </button>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleGrant} className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-2.5">
                {/* Search / Multi-select Input */}
                <div className="relative flex-1" ref={dropdownRef}>
                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setIsDropdownOpen(true);
                      }}
                      onFocus={() => setIsDropdownOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomEmail();
                        }
                      }}
                      placeholder="Search registered users or enter email..."
                      className="w-full pl-9 pr-8 py-2 rounded-xl bg-gray-950 border border-gray-700 text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={handleAddCustomEmail}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-indigo-400 font-semibold hover:text-indigo-300 cursor-pointer"
                      >
                        Add
                      </button>
                    )}
                  </div>

                  {/* Autocomplete / Multi-select Dropdown */}
                  {isDropdownOpen && (
                    <div className="absolute z-20 left-0 right-0 mt-1 bg-gray-950 border border-gray-800 rounded-xl shadow-2xl max-h-48 overflow-y-auto divide-y divide-gray-800/60 animate-in fade-in-50 duration-150">
                      {candidateUsers.length > 0 ? (
                        candidateUsers.map((u) => {
                          const isSelected = selectedEmails.includes(u.email.toLowerCase());
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => handleToggleUser(u.email)}
                              className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs text-left transition-colors cursor-pointer ${
                                isSelected ? 'bg-indigo-600/15 text-indigo-300' : 'hover:bg-gray-900 text-gray-200'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{u.email}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase">
                                  {u.role}
                                </span>
                              </div>
                              {isSelected ? (
                                <Check className="w-3.5 h-3.5 text-indigo-400" />
                              ) : (
                                <span className="text-[10px] text-gray-500">+ Select</span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="p-3 text-center text-xs text-gray-500">
                          {searchQuery ? (
                            <div className="space-y-1">
                              <p>No matching registered users</p>
                              <button
                                type="button"
                                onClick={handleAddCustomEmail}
                                className="text-indigo-400 underline hover:text-indigo-300 font-medium cursor-pointer"
                              >
                                Add "{searchQuery}" as recipient
                              </button>
                            </div>
                          ) : (
                            <p>All registered users already have document access.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Permission Level Selector */}
                <select
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(e.target.value as AccessLevel)}
                  className="px-3 py-2 rounded-xl bg-gray-950 border border-gray-700 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="READ">READ (View & Download)</option>
                  <option value="EDIT">EDIT (Modify Metadata & Read)</option>
                </select>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={granting || (selectedEmails.length === 0 && !searchQuery.trim())}
                  className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors shrink-0 shadow-md shadow-indigo-600/20 cursor-pointer"
                >
                  {granting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>{selectedEmails.length > 1 ? `Add Users (${selectedEmails.length})` : 'Grant Access'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Active Grants List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                Active Document Access Grants ({permissions.length})
              </h4>
              <button
                onClick={loadPermissionsAndUsers}
                disabled={loading}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors cursor-pointer"
                title="Refresh Permissions List"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loading ? (
              <div className="py-8 text-center text-gray-500 text-xs">Loading document access grants...</div>
            ) : permissions.length === 0 ? (
              <div className="py-8 text-center bg-gray-900/30 rounded-xl border border-gray-800/80">
                <ShieldCheck className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-400">No delegated users have access to this document.</p>
                <p className="text-[11px] text-gray-500 mt-0.5">Only Document Owner and Admins currently have access.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-800/80 border border-gray-800/80 rounded-xl bg-gray-900/30 overflow-hidden">
                {permissions.map((p) => {
                  const isRevoking = revokingId === p.userId;
                  return (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3.5 hover:bg-gray-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center text-xs font-semibold text-gray-300 uppercase">
                          {p.user?.email ? p.user.email[0] : 'U'}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-200">
                              {p.user?.email || p.userId}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                p.accessLevel === 'EDIT'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              }`}
                            >
                              {p.accessLevel === 'EDIT' ? 'EDIT' : 'VIEW / READ'}
                            </span>
                          </div>
                          <span className="text-[10px] text-gray-500">
                            Granted: {new Date(p.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRevoke(p.userId, p.user?.email)}
                        disabled={isRevoking}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-rose-500/20 transition-colors disabled:opacity-50 cursor-pointer"
                        title="Revoke User Access"
                      >
                        {isRevoking ? (
                          <div className="w-3.5 h-3.5 border-2 border-rose-400/30 border-t-rose-400 rounded-full animate-spin" />
                        ) : (
                          <>
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-800 bg-gray-900/40 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
