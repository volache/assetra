import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const functionPath = `${url}/functions/v1/`;

const developmentFunctionProxy = (input, init) => {
  const requestUrl = input instanceof Request ? input.url : String(input);
  if (import.meta.env.DEV && requestUrl.startsWith(functionPath)) {
    const proxiedPath = requestUrl.replace(functionPath, "/functions/v1/");
    const proxiedUrl = new URL(proxiedPath, window.location.origin).toString();
    // supabase-js may provide a fully composed Request.  Recreate it with the
    // local URL so its method, body and authorization headers are retained.
    if (input instanceof Request) return fetch(new Request(proxiedUrl, input), init);
    return fetch(proxiedUrl, init);
  }
  return fetch(input, init);
};

export const supabase = url && key
  ? createClient(url, key, { global: { fetch: developmentFunctionProxy } })
  : null;

export function authEmailFor(accountCode) {
  const normalized = String(accountCode || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(normalized)) throw new Error('帳號格式不正確。');
  return `${normalized}@assetra.app`;
}
