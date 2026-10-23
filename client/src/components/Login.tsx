import React, { useState } from 'react';
import {
  Shield,
  Lock,
  Mail,
  ArrowRight,
  ShieldCheck,
  Key,
  Eye,
  AlertCircle,
  CheckCircle2,
  UserPlus,
} from 'lucide-react';
import { authApi } from '../services/api';
import type { User, Role } from '../types';

interface LoginProps {
  onLoginSuccess: (user: User) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) return;

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      if (isSignUp) {
        const data = await authApi.register(cleanEmail, password, 'VIEWER');
        setSuccessMessage(data.message || 'Account created successfully! Please sign in');
        setIsSignUp(false);
        // Retain cleanEmail and password in inputs so user can directly click "Sign In"
      } else {
        const data = await authApi.login(cleanEmail, password);
        onLoginSuccess(data.user);
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (isSignUp ? 'Registration failed. Email may already be in use.' : 'Invalid email or password')
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQuickLogin = async (targetEmail: string, fallbackEmail?: string) => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setIsSignUp(false);
    try {
      try {
        const data = await authApi.login(targetEmail, 'Password123!');
        onLoginSuccess(data.user);
      } catch (err) {
        if (fallbackEmail) {
          const fallbackData = await authApi.login(fallbackEmail, 'Password123!');
          onLoginSuccess(fallbackData.user);
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      setError(err.response?.data?.error || `Failed to sign in as ${targetEmail}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-xl shadow-indigo-600/30 mx-auto mb-4">
          <Shield className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">
          {isSignUp ? 'Create TrustVault Account' : 'TrustVault'}
        </h1>
        <p className="mt-2 text-xs text-gray-400 max-w-xs mx-auto">
          {isSignUp
            ? 'Register dynamic credentials with cryptographic authorization & role assignment'
            : 'Cryptographic Hash-Chained Audit Trail, True MIME Magic-Byte Inspection & Granular RBAC'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="bg-[#111827]/90 backdrop-blur-xl py-8 px-6 sm:px-10 border border-gray-800 rounded-3xl shadow-2xl space-y-6">
          {successMessage && (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Work Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@trustvault.local"
                  required
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-gray-900 border border-gray-700 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </div>

            {/* Notice for new account role assignment */}
            {isSignUp && (
              <div className="p-3 rounded-xl bg-gray-900/80 border border-gray-800 text-xs text-gray-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0"></span>
                <span>New accounts are assigned <strong>VIEWER</strong> role by default.</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition-all cursor-pointer"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : isSignUp ? (
                <>
                  <span>Create Account</span>
                  <UserPlus className="w-4 h-4" />
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Toggle between Login and Register */}
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setSuccessMessage(null);
                }}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer"
              >
                {isSignUp ? 'Already have an account? Sign In' : "Don't have an account? Sign Up"}
              </button>
            </div>
          </form>

          {/* Quick-Login Demo Personas */}
          <div className="pt-5 border-t border-gray-800 space-y-3">
            <span className="block text-[11px] font-semibold text-gray-400 uppercase tracking-wider text-center">
              Quick-Login Demo Personas
            </span>

            <div className="grid grid-cols-1 gap-2">
              {/* Admin Persona */}
              <button
                type="button"
                onClick={() => handleQuickLogin('admin@trustvault.local')}
                disabled={loading}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gray-900/80 hover:bg-gray-800/80 border border-gray-800 hover:border-indigo-500/30 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-200 block group-hover:text-indigo-300">
                      Admin Persona
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">admin@trustvault.local</span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400">
                  ADMIN
                </span>
              </button>

              {/* Owner Persona */}
              <button
                type="button"
                onClick={() => handleQuickLogin('owner@trustvault.local', 'owner_a@trustvault.local')}
                disabled={loading}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gray-900/80 hover:bg-gray-800/80 border border-gray-800 hover:border-emerald-500/30 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-200 block group-hover:text-emerald-300">
                      Owner Persona
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">owner@trustvault.local</span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                  OWNER
                </span>
              </button>

              {/* Viewer Persona */}
              <button
                type="button"
                onClick={() => handleQuickLogin('viewer@trustvault.local')}
                disabled={loading}
                className="w-full flex items-center justify-between p-2.5 rounded-xl bg-gray-900/80 hover:bg-gray-800/80 border border-gray-800 hover:border-cyan-500/30 transition-all text-left group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <Eye className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-gray-200 block group-hover:text-cyan-300">
                      Viewer Persona
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">viewer@trustvault.local</span>
                  </div>
                </div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400">
                  VIEWER
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
