import { createPrivateAccessRequestHandler } from './handler.ts';

Deno.serve(createPrivateAccessRequestHandler({
  supabaseUrl: Deno.env.get('SUPABASE_URL')?.trim() ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '',
  githubToken: Deno.env.get('GITHUB_PAT')?.trim() ?? '',
  owner: Deno.env.get('GITHUB_OWNER')?.trim() || 'trippinganymess',
  repo: Deno.env.get('GITHUB_REPO')?.trim() || 'Xphire',
}));
