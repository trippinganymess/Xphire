import { FunctionsClient } from '@supabase/functions-js';
import { fetchWithSession, functionsUrl } from './supabase';

// Imported only by the lazy terminal route. New-format API keys belong in
// apikey, never in the Functions Bearer header when there is no user session.
export const functions = new FunctionsClient(functionsUrl, {
  customFetch: fetchWithSession(true),
});
