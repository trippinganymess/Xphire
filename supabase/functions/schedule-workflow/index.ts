import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const VALID_UTC_HOURS = [0, 6, 12, 18];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { jobTitle, recipientEmail, freshersOnly, minStars, preferredUtcHour, action } = body;

    // Authenticate the calling user via their JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing Authorization header');

    const supabaseUrl      = Deno.env.get('SUPABASE_URL')!;
    const serviceKey       = Deno.env.get('SUPABASE_SERVICE_KEY')!;
    const anonKey          = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Resolve user identity from the user-supplied JWT (anon key)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error('Unauthorized: invalid or expired token');

    // Admin client for writing (bypasses RLS via service role)
    const adminClient = createClient(supabaseUrl, serviceKey);

    // ----------------------------------------------------------------
    // SUBSCRIBE
    // ----------------------------------------------------------------
    if (action === 'subscribe') {
      if (typeof jobTitle !== 'string' || !jobTitle.trim()) {
        throw new Error('Invalid jobTitle: must be a non-empty string');
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (typeof recipientEmail !== 'string' || !emailRegex.test(recipientEmail)) {
        throw new Error('Invalid recipientEmail');
      }
      if (typeof freshersOnly !== 'boolean') {
        throw new Error('freshersOnly must be a boolean');
      }
      if (typeof minStars !== 'number' || minStars < 1 || minStars > 5) {
        throw new Error('minStars must be a number between 1 and 5');
      }
      if (!VALID_UTC_HOURS.includes(preferredUtcHour)) {
        throw new Error('preferredUtcHour must be one of: 0, 6, 12, 18');
      }

      const { error } = await adminClient
        .from('email_subscriptions')
        .upsert(
          {
            user_id:            user.id,
            recipient_email:    recipientEmail.trim(),
            job_title:          jobTitle.trim(),
            freshers_only:      freshersOnly,
            min_stars:          minStars,
            preferred_utc_hour: preferredUtcHour,
            active:             true,
            updated_at:         new Date().toISOString(),
          },
          { onConflict: 'user_id' }
        );

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, action: 'subscribed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // ----------------------------------------------------------------
    // UNSUBSCRIBE
    // ----------------------------------------------------------------
    if (action === 'unsubscribe') {
      const { error } = await adminClient
        .from('email_subscriptions')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('user_id', user.id);

      if (error) throw error;

      return new Response(
        JSON.stringify({ success: true, action: 'unsubscribed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    throw new Error('Invalid action. Expected "subscribe" or "unsubscribe".');

  } catch (err: any) {
    console.error('[schedule-workflow] Error:', err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    );
  }
});
