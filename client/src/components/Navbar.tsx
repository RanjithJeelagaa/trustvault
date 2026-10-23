import React, { useState, useEffect } from 'react';
import type { User, Role } from '../types';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Key,
  Eye,
  LogOut,
  Files,
  ChevronDown,
  UserCheck,
  Users,
} from 'lucide-react';

import { authApi } from '../services/api';

interface NavbarProps {
  user: User;
  activeTab: 'documents' | 'audit';
  setActiveTab: (tab: 'documents' | 'audit') => void;
  onLogout: () => void;
  onSwitchPersona: (email: string) => Promise<void>;
  onOpenUserManagement?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  activeTab,
  setActiveTab,
  onLogout,
  onSwitchPersona,
  onOpenUserManagement,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [userList, setUserList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // RBAC Guard: Quick Persona switcher is strictly available ONLY to ADMIN or OWNER accounts
  const canSwitchPersona = user.role === 'ADMIN' || user.role === 'OWNER';

  useEffect(() => {
    if (canSwitchPersona) {
      setLoadingUsers(true);
      authApi
        .getUsers()
        .then((users) => {
          setUserList(users);
        })
        .catch((err) => {
          console.error('Failed to load users list:', err);
        })
        .finally(() => {
          setLoadingUsers(false);
        });
    }
  }, [canSwitchPersona]);

  const handlePersonaSelect = async (email: string) => {
    setDropdownOpen(false);
    if (email === user.email) return;
    setSwitching(true);
    try {
      await onSwitchPersona(email);
    } finally {
      setSwitching(false);
    }
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'ADMIN':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-sm">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
            ADMIN
          </span>
        );
      case 'OWNER':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-sm">
            <Key className="w-3.5 h-3.5 text-emerald-400" />
            OWNER
          </span>
        );
      case 'VIEWER':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm">
            <Eye className="w-3.5 h-3.5 text-cyan-400" />
            VIEWER
          </span>
        );
    }
  };

  return (
    <nav className="bg-[#111827]/90 backdrop-blur-md border-b border-gray-800 sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Navigation Tabs */}
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-gray-100 to-gray-300 bg-clip-text text-transparent">
                  TrustVault
                </span>
                <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700/50">
                  v3.0
                </span>
              </div>
            </div>

            {/* View Selector Tabs */}
            <div className="hidden sm:flex items-center gap-1 bg-gray-900/60 p-1 rounded-xl border border-gray-800/80">
              <button
                onClick={() => setActiveTab('documents')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === 'documents'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`}
              >
                <Files className="w-4 h-4" />
                Document Hub
              </button>

              {user.role === 'ADMIN' && (
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    activeTab === 'audit'
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                  }`}
                >
                  <ShieldAlert className="w-4 h-4" />
                  Audit Trail
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </button>
              )}
            </div>
          </div>

          {/* User Profile, User Management, Persona Switcher & Logout */}
          <div className="flex items-center gap-3">
            {/* User Management button - strictly guarded for ADMIN or OWNER */}
            {canSwitchPersona && onOpenUserManagement && (
              <button
                onClick={onOpenUserManagement}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/50 transition-colors shadow-sm cursor-pointer"
                title="Manage registered users, roles, and access (ADMIN/OWNER only)"
              >
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Users</span>
              </button>
            )}

            {/* Quick-switch persona dropdown - strictly guarded for ADMIN or OWNER */}
            {canSwitchPersona && (
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  disabled={switching}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800/80 hover:bg-gray-700/80 text-gray-300 border border-gray-700 transition-colors shadow-sm disabled:opacity-50 cursor-pointer"
                  title="Quick-switch role for demo testing (ADMIN/OWNER only)"
                >
                  <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="hidden md:inline">Quick Persona</span>
                  <ChevronDown className="w-3 h-3 text-gray-400" />
                </button>

                {dropdownOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-xl bg-gray-900 border border-gray-800 shadow-2xl py-1 z-50 max-h-80 overflow-y-auto">
                    <div className="px-3 py-2 border-b border-gray-800 text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                      <span>Switch Active User</span>
                      <span className="text-[10px] text-gray-500 font-normal">{userList.length} users</span>
                    </div>

                    {loadingUsers ? (
                      <div className="p-4 text-center text-xs text-gray-400">Loading users...</div>
                    ) : userList.length === 0 ? (
                      <div className="p-4 text-center text-xs text-gray-500">No users found</div>
                    ) : (
                      userList.map((u) => {
                        const isCurrent = u.email === user.email;
                        return (
                          <button
                            key={u.id || u.email}
                            onClick={() => handlePersonaSelect(u.email)}
                            className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between gap-2 hover:bg-gray-800/70 transition-colors cursor-pointer ${
                              isCurrent ? 'bg-indigo-950/40 text-indigo-200 font-medium' : 'text-gray-300'
                            }`}
                          >
                            <div className="flex flex-col min-w-0 pr-2">
                              <span className="truncate font-medium">{u.email}</span>
                              {isCurrent && <span className="text-[10px] text-indigo-400 font-normal">Active Session</span>}
                            </div>
                            <div className="shrink-0">
                              {getRoleBadge(u.role)}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Current user badge */}
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-gray-900/80 border border-gray-800">
              <div className="flex flex-col text-right">
                <span className="text-xs font-medium text-gray-200 truncate max-w-[140px] sm:max-w-[200px]">
                  {user.email}
                </span>
              </div>
              {getRoleBadge(user.role)}
            </div>

            {/* Logout button */}
            <button
              onClick={onLogout}
              className="p-2 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};
