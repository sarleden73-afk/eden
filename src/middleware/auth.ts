import { Request, Response, NextFunction } from 'express';
import { supabase } from '../lib/supabase-server.js';

export interface AuthUser {
  uid: string;
  email?: string;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.split('Bearer ')[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    console.error('Error verifying Supabase token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = { uid: data.user.id, email: data.user.email };
  next();
};
