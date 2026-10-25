import { createDispatchHandler } from './handler.ts';

const env = (name: string): string => Deno.env.get(name)?.trim() ?? '';
const config = {
  supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
  anonKey: env('SUPABASE_ANON_KEY'),
  serviceKey: env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY'),
  githubToken: env('GITHUB_PAT'),
  owner: env('GITHUB_OWNER') || 'trippinganymess',
  repo: env('GITHUB_REPO') || 'Xphire',
};

Deno.serve(createDispatchHandler(config));
