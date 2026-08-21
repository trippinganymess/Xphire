import { useState } from 'react';
import SketchHeader, { type SystemStatus } from './components/SketchHeader';
import SketchTerminal, { type UserSession } from './components/SketchTerminal';
import './App.css';

export default function App() {
  const [user, setUser] = useState<UserSession | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>('online');

  const handleLogin = (newUser: UserSession) => {
    setUser(newUser);
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
        onLogout={user ? handleLogout : undefined}
      />

      {/* ── Main Terminal Body matching the sketch ── */}
      <main className="sketch-app-main">
        <SketchTerminal
          user={user}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onStatusChange={setSystemStatus}
        />
      </main>
    </div>
  );
}
