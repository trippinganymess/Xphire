import { AuthClient } from '@supabase/auth-js';
import { PostgrestClient } from '@supabase/postgrest-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. The app will load but auth/database features will not work.');
}

// Keep the shell renderable without local credentials, as with the full SDK.
const baseUrl = new URL(`${(supabaseUrl || 'https://placeholder.supabase.co').replace(/\/+$/, '')}/`);
const apiKey = supabaseAnonKey || 'placeholder-anon-key';

const auth = new AuthClient({
  url: new URL('auth/v1', baseUrl).href,
  headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
  // Preserve the full SDK's key so existing browser sessions remain signed in.
  storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  detectSessionInUrl: true,
  flowType: 'implicit',
});

// Resolve the session per request, not once at client creation: sign-in,
// refresh and sign-out must immediately change database/function credentials.
export function fetchWithSession(omitApiKeyAsBearer = false): typeof fetch {
  const allowKeyAsBearer = !(omitApiKeyAsBearer
    && (apiKey.startsWith('sb_publishable_') || apiKey.startsWith('sb_secret_')));
  return async (input, init) => {
    const { data: { session } } = await auth.getSession();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    if (!headers.has('apikey')) headers.set('apikey', apiKey);
    if (!headers.has('Authorization')) {
      const token = session?.access_token ?? (allowKeyAsBearer ? apiKey : null);
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };
}

const database = new PostgrestClient(new URL('rest/v1', baseUrl).href, {
  schema: 'public',
  fetch: fetchWithSession(),
});

// Only services used by this application; no Storage or Realtime constructors.
export const supabase = { auth, from: database.from.bind(database) };
export const functionsUrl = new URL('functions/v1', baseUrl).href;
