import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import platformConfig from '../config/platform.config.js';

function parseEnvironmentFile(contents) {
  const parsedEntries = {};
  const lines = contents.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    let value = trimmedLine.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsedEntries[key] = value;
  }

  return parsedEntries;
}

function loadEnvironmentFile() {
  const environmentFilePath = path.join(platformConfig.rootDirectory, '.env');

  if (!fs.existsSync(environmentFilePath)) {
    return;
  }

  const parsedEntries = parseEnvironmentFile(
    fs.readFileSync(environmentFilePath, 'utf8'),
  );

  for (const [key, value] of Object.entries(parsedEntries)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function createClientOptions(accessToken = '') {
  const headers = {};

  if (typeof accessToken === 'string' && accessToken.trim().length > 0) {
    headers.Authorization = `Bearer ${accessToken.trim()}`;
  }

  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers,
    },
  };
}

loadEnvironmentFile();

export const SUPABASE_URL = process.env.SUPABASE_URL?.trim() ?? '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY?.trim() ?? '';
export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
export const isSupabaseConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
export const isSupabaseAdminConfigured =
  SUPABASE_URL.length > 0 && SUPABASE_SERVICE_ROLE_KEY.length > 0;

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, createClientOptions())
  : null;

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      createClientOptions(),
    )
  : null;

export function createScopedSupabaseClient(accessToken = '') {
  if (!isSupabaseConfigured) {
    return null;
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    createClientOptions(accessToken),
  );
}

export function createServiceRoleSupabaseClient() {
  if (!isSupabaseAdminConfigured) {
    return null;
  }

  return createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    createClientOptions(),
  );
}

export default supabase;
