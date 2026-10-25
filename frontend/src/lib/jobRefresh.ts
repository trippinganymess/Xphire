import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithSession, functionsUrl, supabase } from './supabase';

const request = fetchWithSession(true);
const POLL_MS = 30_000;
type RefreshStatus = 'idle' | 'started' | 'running' | 'completed' | 'failed';
interface RefreshResponse { status: RefreshStatus; runId?: number; previousRunId?: number }

async function requestRefresh(method: 'GET' | 'POST'): Promise<RefreshResponse> {
  const response = await request(`${functionsUrl}/refresh-jobs`, {
    method,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please sign in through Terminal Access to refresh jobs.');
    throw new Error(method === 'POST'
      ? 'Unable to start the refresh. Please try again.'
      : 'Unable to check refresh status. Please try again.');
  }
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('status' in data)
    || !['idle', 'started', 'running', 'completed', 'failed'].includes(String(data.status))) {
    throw new Error('Unable to check refresh status. Please try again.');
  }
  return { status: data.status as RefreshStatus,
    ...('runId' in data && typeof data.runId === 'number' ? { runId: data.runId } : {}),
    ...('previousRunId' in data && typeof data.previousRunId === 'number' ? { previousRunId: data.previousRunId } : {}),
  };
}

export function useJobRefresh(onComplete: () => void) {
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const active = useRef(false);
  const mounted = useRef(false);
  const complete = useRef(onComplete);
  const observed = useRef<{ runId?: number; previousRunId?: number; requestedAt: number }>({ requestedAt: 0 });

  useEffect(() => { complete.current = onComplete; }, [onComplete]);

  const applyStatus = useCallback((data: RefreshResponse, dispatched = false) => {
    const { status } = data;
    const wasActive = active.current;
    const isActive = status === 'running' || status === 'started';
    if (isActive) {
      if (!wasActive) observed.current = { requestedAt: Date.now() };
      if (data.runId !== undefined) observed.current.runId = data.runId;
      if (data.previousRunId !== undefined) observed.current.previousRunId = data.previousRunId;
    } else if (wasActive && (data.runId === undefined
      || (observed.current.runId !== undefined && data.runId !== observed.current.runId)
      || (observed.current.runId === undefined && data.runId === observed.current.previousRunId))) {
      // An expired dispatch lease plus an OLD completed run is not completion.
      // GitHub can take time to expose the new run. A timeout is uncertainty, not success.
      if (Date.now() - observed.current.requestedAt < 120_000) return;
      active.current = false;
      setRunning(false);
      setError(true);
      setMessage('Unable to confirm whether the refresh started. Please try again.');
      return;
    }
    active.current = isActive;
    setRunning(active.current);
    setError(false);
    if (active.current) {
      setMessage(dispatched && status === 'started'
        ? 'Refresh started. Finding new jobs can take about 15 minutes. You can keep browsing.'
        : 'The page is already refreshing. Finding new jobs can take about 15 minutes. You can keep browsing.');
    } else if (wasActive) {
      setError(status === 'failed');
      setMessage(status === 'failed'
        ? 'The refresh did not finish successfully. You can try again.'
        : 'Refresh complete. The latest jobs are now being loaded.');
      complete.current();
    }
  }, []);

  const checkStatus = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const data = await requestRefresh('GET');
      if (mounted.current) applyStatus(data);
    } catch (err) {
      if (mounted.current) {
        setError(true);
        setMessage(err instanceof Error ? err.message : 'Unable to check refresh status. Please try again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setChecking(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    mounted.current = true;
    void checkStatus();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void checkStatus();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkStatus();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [checkStatus]);

  const startRefresh = async () => {
    if (inFlight.current || active.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please sign in through Terminal Access to refresh jobs.');
      const data = await requestRefresh('POST');
      if (mounted.current) applyStatus(data, true);
    } catch (err) {
      if (mounted.current) {
        setError(true);
        setMessage(err instanceof Error ? err.message : 'Unable to start the refresh. Please try again.');
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { checking, busy, running, message, error, startRefresh };
}
