import { Request } from 'express';
import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  document?: any; // Loaded during authorization middleware
}

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  jti: string;
}
