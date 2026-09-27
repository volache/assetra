import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && key ? createClient(url, key) : null;

export function authEmailFor(accountCode) {
  const normalized = String(accountCode || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(normalized)) throw new Error('帳號格式不正確。');
  return `${normalized}@assetra.app`;
}
