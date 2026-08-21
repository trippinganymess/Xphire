import { supabase } from './supabase';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  last_job_title?: string;
  freshers_only?: boolean;
  min_stars?: number;
  total_runs?: number;
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Error fetching user profile:', error);
    return null;
  }
  return data;
}

export async function updateUserProfile(userId: string, updates: Partial<UserProfile>) {
  const { error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId);

  if (error) {
    console.error('Error updating user profile:', error);
  }
}

export async function incrementUserRuns(userId: string) {
  // Using RPC if you had it, or fetch-then-update
  // For simplicity, we fetch the current value first
  const profile = await fetchUserProfile(userId);
  if (profile) {
    await updateUserProfile(userId, { total_runs: (profile.total_runs || 0) + 1 });
  }
}
