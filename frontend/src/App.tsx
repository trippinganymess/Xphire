import { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import SketchHeader, { type SystemStatus } from './components/SketchHeader';
import SketchTerminal, { type UserSession } from './components/SketchTerminal';
import JobBoard from './components/JobBoard';
import { supabase } from './lib/supabase';
import { fetchUserProfile } from './lib/userService';
import './App.css';

// A wrapper component that passes the current route down to the header
function AppLayout() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('online');
  const location = useLocation();
  const isTerminalRoute = location.pathname === '/terminal';

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        handleSupabaseUser(session.user);
      }
    });

    // Listen for changes on auth state (logged in, signed out, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        handleSupabaseUser(session.user);
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSupabaseUser = async (authUser: any) => {
    try {
      const profile = await fetchUserProfile(authUser.id);
      
      const session: UserSession = {
        name: profile?.name || authUser.user_metadata?.name || 'User',
        email: authUser.email,
        avatarUrl: profile?.avatar_url || authUser.user_metadata?.avatar_url,
      };
      
      setUser(session);
    } catch (error) {
      console.error('Error handling user:', error);
    }
  };

  const handleLogout = () => {
    setUser(null);
    setSystemStatus('online');
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
          <Route 
            path="/terminal" 
            element={
              <SketchTerminal
                user={user}
                onLogout={handleLogout}
                onStatusChange={setSystemStatus}
              />
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
