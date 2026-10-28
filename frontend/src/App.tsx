import { lazy, Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import SketchHeader, { type SystemStatus } from './components/SketchHeader';
import type { UserSession } from './components/SketchTerminal';
import JobBoard from './components/JobBoard';
import { authCallbackResult, supabase } from './lib/supabase';
import { fetchUserProfile } from './lib/userService';
import './App.css';

const SketchTerminal = lazy(() => import('./components/SketchTerminal'));
const PrivateJobBoard = lazy(() => import('./components/PrivateJobBoard'));
const PrivateAccessRequest = lazy(() => import('./components/PrivateAccessRequest'));

// A wrapper component that passes the current route down to the header
function AppLayout() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('online');
  const location = useLocation();
  const isTerminalRoute = location.pathname === '/terminal';

  useEffect(() => {
    let active = true;
    let userVersion = 0;
    async function handleSupabaseUser(authUser: import('@supabase/auth-js').User) {
      const version = ++userVersion;
      const fallback = {
        name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || 'User',
        email: authUser.email || '',
        avatarUrl: authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture,
      };
      try {
        const profile = await fetchUserProfile(authUser.id);
        if (active && version === userVersion) setUser({
          ...fallback,
          name: profile?.name || fallback.name,
          avatarUrl: profile?.avatar_url || fallback.avatarUrl,
        });
      } catch (error) {
        console.error('Error handling user:', error);
        // A failed optional profile lookup must not invalidate a Google session.
        if (active && version === userVersion) setUser(fallback);
      }
    }

    authCallbackResult.then((error) => { if (active) setAuthError(error); });

    // Ignore stale profile/session results after sign-out or an account change.
    const initialVersion = userVersion;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (active && userVersion === initialVersion && session?.user) {
        handleSupabaseUser(session.user);
      }
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session?.user) {
        setAuthError(null);
        void handleSupabaseUser(session.user);
      } else {
        userVersion++;
        setUser(null);
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = () => {
    setUser(null);
    setAuthError(null);
    setSystemStatus('online');
    // Header sign-out must revoke the SDK session as well as its UI label.
    void supabase.auth.signOut();
  };

  return (
    <div className="sketch-app-container">
      {/* ── Top Header matching the sketch ── */}
      <SketchHeader
        status={systemStatus}
        userName={user?.name}
        userEmail={user?.email}
        avatarUrl={user?.avatarUrl}
        onLogout={user ? handleLogout : undefined}
        isTerminalView={isTerminalRoute}
      />

      {/* ── Main Body matching the sketch ── */}
      <main className="sketch-app-main">
        <Routes>
          <Route path="/" element={<JobBoard />} />
          <Route path="/private-jobs/request-access" element={
            <Suspense fallback={<p role="status">Loading access request...</p>}>
              <PrivateAccessRequest />
            </Suspense>
          } />
          <Route path="/private-jobs" element={
            <Suspense fallback={<p role="status">Loading private board...</p>}><PrivateJobBoard /></Suspense>
          } />
          <Route 
            path="/terminal" 
            element={
              <Suspense fallback={<p role="status">Loading terminal...</p>}>
                <SketchTerminal
                  user={user}
                  authError={authError}
                  onLogout={handleLogout}
                  onStatusChange={setSystemStatus}
                />
              </Suspense>
            } 
          />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
}
