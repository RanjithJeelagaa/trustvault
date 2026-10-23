import React, { useState, useEffect } from 'react';
import type { User, Role } from '../types';
import { userApi } from '../services/api';
import {
  X,
  Users,
  ShieldCheck,
  Key,
  Eye,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

interface UserManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User;
  onUserModified?: () => void;
}

export const UserManagementModal: React.FC<UserManagementModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onUserModified,
}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await userApi.getUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch registered users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
      setError(null);
      setSuccess(null);
      setConfirmDeleteId(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleRoleChange = async (targetUser: User, newRole: Role) => {
    if (targetUser.role === newRole) return;

    // Frontend validation guard: Owners cannot alter Admin roles
    if (currentUser.role === 'OWNER' && targetUser.role === 'ADMIN') {
      setError('Owners cannot modify Admin accounts');
      return;
    }

    setUpdatingUserId(targetUser.id);
    setError(null);
    setSuccess(null);

    try {
      const res = await userApi.updateRole(targetUser.id, newRole);
      setSuccess(res.message || `Updated ${targetUser.email} to ${newRole}`);
      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u))
      );
      if (onUserModified) onUserModified();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to update user role');
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDeleteUser = async (targetUser: User) => {
    // Guards
    if (currentUser.id === targetUser.id) {
      setError('Cannot delete your own active session account');
      return;
    }

    if (currentUser.role === 'OWNER' && targetUser.role === 'ADMIN') {
      setError('Cannot delete an Admin account');
      return;
    }

    setDeletingUserId(targetUser.id);
    setError(null);
    setSuccess(null);

    try {
      await userApi.deleteUser(targetUser.id);
      setSuccess(`User ${targetUser.email} deleted successfully`);
      setUsers((prev) => prev.filter((u) => u.id !== targetUser.id));
      setConfirmDeleteId(null);
      if (onUserModified) onUserModified();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete user');
    } finally {
      setDeletingUserId(null);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q);
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <ShieldCheck className="w-3 h-3" />
            ADMIN
          </span>
        );
      case 'OWNER':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Key className="w-3 h-3" />
            OWNER
          </span>
        );
      case 'VIEWER':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Eye className="w-3 h-3" />
            VIEWER
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                User Management & Access Control
                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
                  {users.length} accounts
                </span>
              </h2>
              <p className="text-xs text-gray-400">
                Logged in as <strong className="text-gray-300">{currentUser.email}</strong> (
                <span className="text-indigo-400">{currentUser.role}</span>)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-gray-800/80 bg-gray-950/40 flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search users by email or role..."
              className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-gray-900 border border-gray-800 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>
          <button
            onClick={fetchUsers}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-300 border border-gray-700 transition-colors disabled:opacity-50"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Alerts */}
        {error && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {success && (
          <div className="mx-6 mt-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Table Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && users.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-gray-500 gap-2">
              <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin"></div>
              <span className="text-xs">Loading registered accounts...</span>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-500">
              No matching users found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 uppercase tracking-wider text-[10px] font-semibold">
                    <th className="py-3 px-3">Email Address</th>
                    <th className="py-3 px-3">Current Role</th>
                    <th className="py-3 px-3">Role Promotion / Demotion</th>
                    <th className="py-3 px-3">Registered Date</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {filteredUsers.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    const isTargetAdmin = u.role === 'ADMIN';
                    const isOwnerRequester = currentUser.role === 'OWNER';

                    // Rule: Prevent an OWNER from demoting or modifying an existing ADMIN's role
                    const canModifyRole = !(isOwnerRequester && isTargetAdmin);

                    // Permission Rules for Deleting / Removing Users:
                    // ADMIN: Can remove/delete any user (except self).
                    // OWNER: Can remove/delete any VIEWER or OWNER; CANNOT remove/delete an ADMIN.
                    // Cannot delete own active session account.
                    const canDelete =
                      !isSelf && !(isOwnerRequester && isTargetAdmin);

                    const deleteTooltip = isSelf
                      ? 'Cannot delete your own active session account'
                      : isOwnerRequester && isTargetAdmin
                      ? 'Cannot delete an Admin account'
                      : 'Delete user account';

                    const roleTooltip = !canModifyRole
                      ? 'Owners cannot modify Admin accounts'
                      : 'Change user role';

                    return (
                      <tr
                        key={u.id}
                        className={`hover:bg-gray-800/40 transition-colors ${
                          isSelf ? 'bg-indigo-950/20' : ''
                        }`}
                      >
                        {/* Email */}
                        <td className="py-3.5 px-3">
                          <div className="flex flex-col">
                            <span className="font-medium text-gray-200">
                              {u.email}
                            </span>
                            {isSelf && (
                              <span className="text-[10px] text-indigo-400 font-normal">
                                (You / Current Session)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Current Role Badge */}
                        <td className="py-3.5 px-3">
                          {getRoleBadge(u.role)}
                        </td>

                        {/* Role Change Dropdown */}
                        <td className="py-3.5 px-3">
                          <div className="relative inline-block" title={roleTooltip}>
                            <select
                              value={u.role}
                              disabled={!canModifyRole || updatingUserId === u.id}
                              onChange={(e) =>
                                handleRoleChange(u, e.target.value as Role)
                              }
                              className={`py-1.5 px-2.5 rounded-lg text-xs font-medium bg-gray-900 border transition-colors ${
                                canModifyRole
                                  ? 'border-gray-700 text-gray-200 hover:border-indigo-500 focus:outline-none focus:border-indigo-500 cursor-pointer'
                                  : 'border-gray-800 text-gray-500 cursor-not-allowed bg-gray-900/40'
                              }`}
                            >
                              <option value="VIEWER">VIEWER</option>
                              <option value="OWNER">OWNER</option>
                              <option value="ADMIN">ADMIN</option>
                            </select>
                            {updatingUserId === u.id && (
                              <span className="ml-2 text-[10px] text-indigo-400 animate-pulse">
                                Updating...
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Registered Date */}
                        <td className="py-3.5 px-3 text-gray-400 font-mono text-[11px]">
                          {formatDate(u.createdAt)}
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-3 text-right">
                          {confirmDeleteId === u.id ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <span className="text-[10px] text-rose-400 mr-1">Confirm delete?</span>
                              <button
                                onClick={() => handleDeleteUser(u)}
                                disabled={deletingUserId === u.id}
                                className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold transition-colors disabled:opacity-50"
                              >
                                {deletingUserId === u.id ? 'Deleting...' : 'Yes, Delete'}
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 text-[10px] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (canDelete) setConfirmDeleteId(u.id);
                              }}
                              disabled={!canDelete || deletingUserId === u.id}
                              title={deleteTooltip}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                canDelete
                                  ? 'text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 cursor-pointer'
                                  : 'text-gray-600 cursor-not-allowed opacity-50'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden sm:inline">Delete</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer / Notes */}
        <div className="px-6 py-3 border-t border-gray-800 bg-gray-950/60 flex items-center justify-between text-[11px] text-gray-500">
          <div>
            {currentUser.role === 'ADMIN' ? (
              <span>Admins have full modification rights over all accounts.</span>
            ) : (
              <span>Owners can manage Viewers and Owners. Admin accounts are protected.</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
