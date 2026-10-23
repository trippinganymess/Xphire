import { createRefreshHandler } from './handler.ts';

Deno.serve(createRefreshHandler({
  supabaseUrl: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  githubToken: Deno.env.get('GITHUB_PAT')?.trim() ?? '',
  owner: Deno.env.get('GITHUB_OWNER')?.trim() || 'trippinganymess',
  repo: Deno.env.get('GITHUB_REPO')?.trim() || 'Xphire',
}));
