import { createPrivateJobBoardHandler } from './handler.ts';

Deno.serve(createPrivateJobBoardHandler({
  supabaseUrl: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, ''),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '',
  theirStackKey: Deno.env.get('THEIRSTACK_API_KEY')?.trim()
    || Deno.env.get('THEIR_STACK_API_KEY')?.trim() || '',
}));
