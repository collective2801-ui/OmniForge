import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { getCurrentUser, signIn, signOut, signUp } from '../backend/auth.js';
import { isSupabaseConfigured } from '../backend/supabaseClient.js';

const users = [];

function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

function getJwtSecret() {
  return process.env.JWT_SECRET?.trim() || 'secret';
}

function resolveCompatError(error, fallbackMessage) {
  const message = error?.message ?? fallbackMessage;
  const normalizedMessage = String(message).toLowerCase();

  if (normalizedMessage.includes('already')) {
    return 'User already exists';
  }

  if (normalizedMessage.includes('invalid login credentials')) {
    return 'Invalid credentials';
  }

  return message;
}

export { signUp, signIn, signOut, getCurrentUser };
export { users };

export async function authenticate({
  email = '',
  password = '',
} = {}) {
  return signIn(email, password);
}

export async function register(email, password) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error('Email is required');
  }

  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password is required');
  }

  if (isSupabaseConfigured) {
    const result = await signUp(normalizedEmail, password);

    if (!result.ok) {
      throw new Error(resolveCompatError(result.error, 'Unable to register user.'));
    }

    return {
      id: result.user?.id ?? uuid(),
      email: result.user?.email ?? normalizedEmail,
      password: '[managed-by-supabase]',
      provider: 'supabase',
      session: result.session ?? null,
    };
  }

  const existingUser = users.find((user) => user.email === normalizedEmail);

  if (existingUser) {
    throw new Error('User already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    email: normalizedEmail,
    password: hashedPassword,
  };

  users.push(user);

  return user;
}

export async function login(email, password) {
  const normalizedEmail = normalizeEmail(email);

  if (isSupabaseConfigured) {
    const result = await signIn(normalizedEmail, password);

    if (!result.ok) {
      throw new Error(resolveCompatError(result.error, 'Unable to sign in user.'));
    }

    const accessToken = result.session?.accessToken?.trim() ?? '';

    return {
      token: accessToken || jwt.sign({ id: result.user?.id ?? normalizedEmail }, getJwtSecret()),
      refreshToken: result.session?.refreshToken ?? null,
      user: result.user ?? null,
      provider: 'supabase',
    };
  }

  const user = users.find((candidate) => candidate.email === normalizedEmail);

  if (!user) {
    throw new Error('User not found');
  }

  const valid = await bcrypt.compare(password, user.password);

  if (!valid) {
    throw new Error('Invalid credentials');
  }

  const token = jwt.sign({ id: user.id }, getJwtSecret());

  return { token };
}

export default {
  authenticate,
  register,
  login,
  users,
  signUp,
  signIn,
  signOut,
  getCurrentUser,
};
