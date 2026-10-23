export type Role = 'ADMIN' | 'OWNER' | 'VIEWER';
export type AccessLevel = 'READ' | 'EDIT';
export type AuditStatus = 'SUCCESS' | 'DENIED';

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt?: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  category?: string | null;
  originalName?: string | null;
  mimeType: string;
  size: number;
  ownerId: string;
  ownerEmail?: string | null;
  userAccessLevel?: 'ADMIN' | 'OWNER' | 'EDIT' | 'READ' | null;
  canView?: boolean;
  canEdit?: boolean;
  canShare?: boolean;
  canDelete?: boolean;
  permissions?: PermissionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface PermissionItem {
  id: string;
  documentId: string;
  userId: string;
  accessLevel: AccessLevel;
  createdAt: string;
  user?: {
    id: string;
    email: string;
    role: Role;
  };
}

export interface AuditLogItem {
  id: string;
  timestamp: string;
  action: string;
  status: AuditStatus;
  userId?: string | null;
  documentId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  reason?: string | null;
  previousHash: string;
  currentHash: string;
  user?: {
    id: string;
    email: string;
    role: Role;
  };
  document?: {
    id: string;
    title: string;
  };
}

export interface AuditVerifyResponse {
  isValid: boolean;
  status?: string;
  message?: string;
  corruptedAtId?: string;
  totalLogs?: number;
}
