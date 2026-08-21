import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { jobTitle, recipientEmail, freshersOnly, minStars } = await req.json();

    const githubToken = Deno.env.get('GITHUB_PAT');
    const owner = Deno.env.get('GITHUB_OWNER') || 'trippinganymess';
    const repo = Deno.env.get('GITHUB_REPO') || 'Xphire';
    const workflowId = 'email_jobs.yml';

    if (!githubToken) {
      throw new Error('GITHUB_PAT is not set');
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          job_title: jobTitle,
          recipient_email: recipientEmail,
          freshers_only: String(freshersOnly),
          min_stars: String(minStars),
        },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error('GitHub API error:', res.status, errorText);
      throw new Error(`GitHub API returned ${res.status}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error: any) {
    console.error('Error dispatching workflow:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
