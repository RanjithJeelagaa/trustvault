import axios from 'axios';
import type { User, DocumentItem, PermissionItem, AuditLogItem, AuditVerifyResponse } from '../types';

export const API_BASE = '/api';

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

let onUnauthorizedCallback: (() => void) | null = null;

export function setUnauthorizedHandler(callback: () => void) {
  onUnauthorizedCallback = callback;
}

// Request interceptor: Attach JWT Bearer token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('trustvault_token');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: Auto logout on 401
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('trustvault_token');
      localStorage.removeItem('trustvault_user');
      if (onUnauthorizedCallback) {
        onUnauthorizedCallback();
      }
    }
    return Promise.reject(error);
  }
);

// Auth Endpoints
export const authApi = {
  register: async (
    email: string,
    password: string,
    role: 'ADMIN' | 'OWNER' | 'VIEWER' = 'VIEWER'
  ): Promise<{ message: string; user: User }> => {
    const res = await apiClient.post('/auth/register', { email, password, role });
    return res.data;
  },

  login: async (email: string, password = 'Password123!'): Promise<{ token: string; user: User }> => {
    const res = await apiClient.post('/auth/login', { email, password });
    if (res.data.token) {
      localStorage.setItem('trustvault_token', res.data.token);
      localStorage.setItem('trustvault_user', JSON.stringify(res.data.user));
    }
    return res.data;
  },

  logout: async (): Promise<void> => {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network errors on logout
    } finally {
      localStorage.removeItem('trustvault_token');
      localStorage.removeItem('trustvault_user');
    }
  },

    getCurrentUser: (): User | null => {
    const userStr = localStorage.getItem('trustvault_user');
    if (!userStr) return null;
    try {
      return JSON.parse(userStr) as User;
    } catch {
      return null;
    }
  },

  switchPersona: async (email: string): Promise<{ token: string; user: User }> => {
    const res = await apiClient.post('/auth/switch-persona', { email });
    if (res.data.token) {
      localStorage.setItem('trustvault_token', res.data.token);
      localStorage.setItem('trustvault_user', JSON.stringify(res.data.user));
    }
    return res.data;
  },

  getUsers: async (): Promise<User[]> => {
    try {
      const res = await apiClient.get('/users');
      return res.data.users || [];
    } catch {
      const fallback = await apiClient.get('/documents/users');
      return fallback.data.users || [];
    }
  },
};

// User Management Endpoints (Owners & Admins)
export const userApi = {
  getUsers: async (): Promise<User[]> => {
    const res = await apiClient.get('/users');
    return res.data.users || [];
  },

  updateRole: async (userId: string, newRole: 'VIEWER' | 'OWNER' | 'ADMIN'): Promise<{ message: string; user: User }> => {
    const res = await apiClient.patch(`/users/${userId}/role`, { newRole });
    return res.data;
  },

  deleteUser: async (userId: string): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/users/${userId}`);
    return res.data;
  },
};

// Document Management Endpoints
export const documentApi = {
  list: async (params?: { title?: string; category?: string }): Promise<DocumentItem[]> => {
    const res = await apiClient.get('/documents', { params });
    return res.data.documents || [];
  },

  getUsers: async (): Promise<User[]> => {
    try {
      const res = await apiClient.get('/users');
      return res.data.users || [];
    } catch {
      const res = await apiClient.get('/documents/users');
      return res.data.users || [];
    }
  },

  viewBlob: async (id: string): Promise<{ blobUrl: string; mimeType: string; size: number; blob: Blob }> => {
    const res = await apiClient.get(`/documents/${id}/view`, {
      responseType: 'blob',
    });
    const mimeHeader = res.headers['content-type'];
    const mimeType = typeof mimeHeader === 'string' ? mimeHeader.split(';')[0].trim() : 'application/octet-stream';
    const blob: Blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type: mimeType });
    const blobUrl = window.URL.createObjectURL(blob);
    return { blobUrl, mimeType, size: blob.size, blob };
  },

  upload: async (file: File, title: string, category: string): Promise<DocumentItem> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('category', category);

    const res = await apiClient.post('/documents', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data.document || res.data;
  },

  download: async (id: string, filename = 'document.bin'): Promise<void> => {
    const res = await apiClient.get(`/documents/${id}/download`, {
      responseType: 'blob',
    });

    // Create a temporary link element to trigger browser download
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);
  },

  update: async (id: string, data: { title?: string; category?: string }): Promise<DocumentItem> => {
    const res = await apiClient.put(`/documents/${id}`, data);
    return res.data.document || res.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/documents/${id}`);
  },

  getPermissions: async (documentId: string): Promise<PermissionItem[]> => {
    const res = await apiClient.get(`/documents/${documentId}/access`);
    return res.data.permissions || res.data.access || [];
  },

  grantPermission: async (
    documentId: string,
    data: { userEmail?: string; userEmails?: string[]; accessLevel: 'READ' | 'EDIT' }
  ): Promise<PermissionItem[]> => {
    const payload: any = { accessLevel: data.accessLevel };
    if (data.userEmails && data.userEmails.length > 0) {
      payload.emails = data.userEmails;
    } else if (data.userEmail) {
      payload.email = data.userEmail;
    }

    const res = await apiClient.post(`/documents/${documentId}/access`, payload);
    return res.data.permissions || (res.data.permission ? [res.data.permission] : []);
  },

  revokePermission: async (documentId: string, userId: string): Promise<void> => {
    await apiClient.delete(`/documents/${documentId}/access/${userId}`);
  },
};

// Admin Endpoints
export const adminApi = {
  getAuditLogs: async (params?: {
    page?: number;
    limit?: number;
    userId?: string;
    documentId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    logs: AuditLogItem[];
  }> => {
    const res = await apiClient.get('/admin/audit-logs', { params });
    return res.data;
  },

  verifyAuditChain: async (): Promise<AuditVerifyResponse> => {
    const res = await apiClient.get('/admin/audit-logs/verify');
    return res.data;
  },
};
