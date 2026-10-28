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

// Supabase may return provider failures in the fragment, which HashRouter also
// owns. Move only auth errors to the query and route callbacks to the terminal
// before React mounts; the SDK remains responsible for exchanging PKCE codes.
const callbackUrl = new URL(window.location.href);
const fragment = new URLSearchParams(callbackUrl.hash.slice(callbackUrl.hash.lastIndexOf('#') + 1));
const authErrorKeys = ['error', 'error_code', 'error_description'];
for (const key of authErrorKeys) {
  const value = fragment.get(key);
  if (value && !callbackUrl.searchParams.has(key)) callbackUrl.searchParams.set(key, value);
}
const legacyAccessToken = fragment.get('access_token');
const legacyRefreshToken = fragment.get('refresh_token');
const isLegacyCallback = !!legacyAccessToken && !!legacyRefreshToken;
const isAuthCallback = isLegacyCallback || callbackUrl.searchParams.has('code')
  || authErrorKeys.some((key) => callbackUrl.searchParams.has(key));
if (isAuthCallback) {
  callbackUrl.hash = '/terminal';
  window.history.replaceState(window.history.state, '', callbackUrl);
}

const auth = new AuthClient({
  url: new URL('auth/v1', baseUrl).href,
  headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}` },
  // Preserve the full SDK's key so existing browser sessions remain signed in.
  storageKey: `sb-${baseUrl.hostname.split('.')[0]}-auth-token`,
  autoRefreshToken: true,
  persistSession: true,
  // Older confirmation links are restored explicitly below, without changing
  // the flow type used by subsequent Google sign-ins in this browser session.
  detectSessionInUrl: !isLegacyCallback,
  flowType: 'pkce',
});

export const authCallbackResult: Promise<string | null> = isAuthCallback
  ? (isLegacyCallback
    ? auth.setSession({ access_token: legacyAccessToken!, refresh_token: legacyRefreshToken! })
    : auth.initialize()).then(async ({ error }) => {
    let message = error?.message ?? null;
    if (!message && callbackUrl.searchParams.has('code')) {
      const { data: { session } } = await auth.getSession();
      if (!session) message = 'This sign-in link has expired or was opened in a different browser. Please try again.';
    }
    // Failed callbacks also need cleanup: refreshing must not retry a used code.
    const cleanUrl = new URL(window.location.href);
    for (const key of ['code', ...authErrorKeys]) cleanUrl.searchParams.delete(key);
    cleanUrl.hash = '/terminal';
    window.history.replaceState(window.history.state, '', cleanUrl);
    return message;
  })
  : Promise.resolve(null);

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
export const supabase = { auth, from: database.from.bind(database), rpc: database.rpc.bind(database) };
export const functionsUrl = new URL('functions/v1', baseUrl).href;
