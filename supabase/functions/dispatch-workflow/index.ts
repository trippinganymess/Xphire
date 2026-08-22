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

    // Input Validation
    if (typeof jobTitle !== 'string' || jobTitle.trim().length === 0 || jobTitle.length > 100) {
      throw new Error('Invalid jobTitle: must be a non-empty string under 100 characters');
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof recipientEmail !== 'string' || !emailRegex.test(recipientEmail) || recipientEmail.length > 255) {
      throw new Error('Invalid recipientEmail: must be a valid email address under 255 characters');
    }
    
    if (typeof freshersOnly !== 'boolean') {
      throw new Error('Invalid freshersOnly: must be a boolean');
    }
    
    if (typeof minStars !== 'number' || minStars < 1 || minStars > 5) {
      throw new Error('Invalid minStars: must be a number between 1 and 5');
    }

    const githubToken = Deno.env.get('GITHUB_PAT')?.trim();
    const owner = Deno.env.get('GITHUB_OWNER')?.trim() || 'trippinganymess';
    const repo = Deno.env.get('GITHUB_REPO')?.trim() || 'Xphire';
    const workflowId = 'email_jobs.yml';

    if (!githubToken) {
      throw new Error('GITHUB_PAT secret is not set in Supabase');
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `Bearer ${githubToken}`,
        'User-Agent': 'Xphire-Job-Scout',
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
      throw new Error(`GitHub API error (${res.status}): ${errorText}`);
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
