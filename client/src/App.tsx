import React, { useState, useEffect } from 'react';
import type { User } from './types';
import { authApi, setUnauthorizedHandler } from './services/api';
import { Navbar } from './components/Navbar';
import { DocumentHub } from './components/DocumentHub';
import { AuditViewer } from './components/AuditViewer';
import { Login } from './components/Login';
import { UserManagementModal } from './components/UserManagementModal';

export const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'documents' | 'audit'>('documents');
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);
  const [initLoading, setInitLoading] = useState(true);

  useEffect(() => {
    // Configure automatic logout on 401 responses
    setUnauthorizedHandler(() => {
      setUser(null);
    });

    const existingUser = authApi.getCurrentUser();
    if (existingUser) {
      setUser(existingUser);
    }
    setInitLoading(false);
  }, []);

  const handleLogout = async () => {
    await authApi.logout();
    setUser(null);
    setActiveTab('documents');
  };

  const handleSwitchPersona = async (email: string) => {
    try {
      const data = await authApi.switchPersona(email);
      setUser(data.user);
      // If switched away from Admin, ensure activeTab resets to documents
      if (data.user.role !== 'ADMIN') {
        setActiveTab('documents');
      }
    } catch (err: any) {
      alert(`Could not switch persona: ${err.response?.data?.error || err.message}`);
    }
  };

  if (initLoading) {
    return (
      <div className="min-h-screen bg-[#0B0F17] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={(u) => setUser(u)} />;
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] flex flex-col text-gray-100">
      <Navbar
        user={user}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLogout={handleLogout}
        onSwitchPersona={handleSwitchPersona}
        onOpenUserManagement={() => setIsUserManagementOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'audit' && user.role === 'ADMIN' ? (
          <AuditViewer />
        ) : (
          <DocumentHub user={user} />
        )}
      </main>

      {/* User Management Modal for ADMIN & OWNER */}
      {(user.role === 'ADMIN' || user.role === 'OWNER') && (
        <UserManagementModal
          isOpen={isUserManagementOpen}
          onClose={() => setIsUserManagementOpen(false)}
          currentUser={user}
          onUserModified={async () => {
            // Re-fetch current user profile in case active user's role was changed
            const updated = authApi.getCurrentUser();
            if (updated) setUser(updated);
          }}
        />
      )}

      <footer className="border-t border-gray-800/80 bg-gray-950/60 py-4 text-center text-xs text-gray-500">
        TrustVault Architecture: Zero Public URLs • Synchronous DB Revocation Checks • Hash-Chained Audit Trail
      </footer>
    </div>
  );
};

export default App;
