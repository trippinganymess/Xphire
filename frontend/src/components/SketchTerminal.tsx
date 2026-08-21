import { useState, useEffect, useRef, type FormEvent } from 'react';
import { type SystemStatus } from './SketchHeader';
import { supabase } from '../lib/supabase';
import { incrementUserRuns } from '../lib/userService';
import './SketchTerminal.css';

// Load all user avatars from assets/Users
const avatarModules = import.meta.glob<string>('../assets/Users/*.png', {
  eager: true,
  import: 'default',
});
const avatarList: string[] = Object.values(avatarModules);

function getRandomAvatar(): string | undefined {
  if (avatarList.length === 0) return undefined;
  const randomIndex = Math.floor(Math.random() * avatarList.length);
  return avatarList[randomIndex];
}

export interface UserSession {
  name: string;
  email: string;
  avatarUrl?: string;
}

interface TerminalLine {
  id: string;
  type: 'system' | 'input' | 'output' | 'success' | 'warning' | 'error' | 'header';
  text: string;
}

interface WorkflowParams {
  jobTitle: string;
  recipientEmail: string;
  freshersOnly: boolean;
  minStars: number;
}

type AuthStep = 'NAME' | 'EMAIL' | 'PASSWORD' | 'DONE';
type WorkflowStep = 'IDLE' | 'JOB_TITLE' | 'RECIPIENT_EMAIL' | 'FRESHERS' | 'MIN_STARS' | 'CONFIRM' | 'RUNNING';

interface SketchTerminalProps {
  user: UserSession | null;
  onLogin: (user: UserSession) => void;
  onLogout: () => void;
  onStatusChange: (status: SystemStatus) => void;
}

export default function SketchTerminal({
  user,
  onLogout,
  onStatusChange,
}: Omit<SketchTerminalProps, 'onLogin'>) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [inputVal, setInputVal] = useState('');
  
  // Step state machines
  const [authStep, setAuthStep] = useState<AuthStep>('NAME');
  const [authDraft, setAuthDraft] = useState({ name: '', email: '', password: '' });

  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('IDLE');
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowParams>({
    jobTitle: '',
    recipientEmail: '',
    freshersOnly: false,
    minStars: 3,
  });

  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on output
  useEffect(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on click
  const handleTerminalClick = () => {
    inputRef.current?.focus();
  };

  // Initial welcome greeting
  useEffect(() => {
    if (!user) {
      setLines([
        { id: '1', type: 'header', text: '==================================================' },
        { id: '2', type: 'header', text: '      XPHIRE AI JOB SCOUT - TERMINAL v2.4       ' },
        { id: '3', type: 'header', text: '==================================================' },
        { id: '4', type: 'system', text: 'System ready. Authentication required to continue.' },
        { id: '5', type: 'system', text: 'Please sign up with your credentials (step 1 of 3).' },
        { id: '6', type: 'output', text: ' ' },
      ]);
      setAuthStep('NAME');
    } else {
      setLines([
        { id: '1', type: 'header', text: '==================================================' },
        { id: '2', type: 'header', text: '      XPHIRE AI JOB SCOUT - TERMINAL v2.4       ' },
        { id: '3', type: 'header', text: '==================================================' },
        { id: '4', type: 'success', text: `✓ Authentication complete. Welcome, ${user.name}!` },
        { id: '5', type: 'system', text: 'Configure your Job Scout search parameters below (step 1 of 4):' },
        { id: '6', type: 'output', text: ' ' },
      ]);
      setWorkflowDraft({
        jobTitle: '',
        recipientEmail: user.email,
        freshersOnly: false,
        minStars: 3,
      });
      setWorkflowStep('JOB_TITLE');
    }
  }, [user]);

  // Determine current prompt prefix
  const getPromptLabel = (): string => {
    if (!user) {
      switch (authStep) {
        case 'NAME':
          return 'Enter your full name:';
        case 'EMAIL':
          return 'Enter your email address:';
        case 'PASSWORD':
          return 'Create a password:';
        default:
          return 'auth >';
      }
    } else {
      switch (workflowStep) {
        case 'JOB_TITLE':
          return 'Job title to search [e.g. Software Engineer]:';
        case 'RECIPIENT_EMAIL':
          return `Recipient email [default: ${user.email}]:`;
        case 'FRESHERS':
          return 'Freshers / Entry-level roles only? (y/n) [default: n]:';
        case 'MIN_STARS':
          return 'Minimum company rating (1-5 stars) [default: 3]:';
        case 'CONFIRM':
          return 'Dispatch workflow with these parameters? (y/n) [default: y]:';
        case 'RUNNING':
          return 'Executing...';
        case 'IDLE':
        default:
          return `${user.name.toLowerCase().replace(/\s+/g, '_')}@xphire:~$`;
      }
    }
  };

  // Run execution simulation
  const executeWorkflow = async (params: WorkflowParams) => {
    setWorkflowStep('RUNNING');
    onStatusChange('running');

    const timestamp = () => new Date().toLocaleTimeString();

    const addLine = (line: Omit<TerminalLine, 'id'>) => {
      setLines((prev) => [...prev, { ...line, id: String(Date.now() + Math.random()) }]);
    };

    addLine({ type: 'system', text: `\n[${timestamp()}] >> [DISPATCH] Triggering GitHub Actions via Edge Function...` });

    try {
      const { error } = await supabase.functions.invoke('dispatch-workflow', {
        body: {
          jobTitle: params.jobTitle,
          recipientEmail: params.recipientEmail,
          freshersOnly: params.freshersOnly,
          minStars: params.minStars
        }
      });

      if (error) throw error;

      addLine({ type: 'success', text: `[${timestamp()}] >> [SUCCESS] Workflow dispatched successfully!` });
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Job Title: "${params.jobTitle}"` });
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Recipient: ${params.recipientEmail}` });
      
      // Update user runs in background
      if (user) {
        // Find user ID from session to increment runs
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user) {
            incrementUserRuns(session.user.id);
          }
        });
      }

      // We still simulate the streaming logs for the UI experience, 
      // but the actual run is happening on GitHub Actions.
      setTimeout(() => {
        addLine({ type: 'system', text: `[${timestamp()}] >> [CACHE] Checking Supabase Seen_job cache (< 6h old)...` });
      }, 1500);

      setTimeout(() => {
        addLine({ type: 'output', text: `[${timestamp()}] >> [ATS_SCAN] Scanning 850+ ATS endpoints...` });
      }, 3000);

      setTimeout(() => {
        addLine({ type: 'system', text: `[${timestamp()}] >> Note: Actual execution takes 2-5 minutes. You will receive an email at ${params.recipientEmail} when complete.` });
      }, 4500);

      setTimeout(() => {
        addLine({ type: 'success', text: `✓ Job Scout pipeline is running in the background.` });
        addLine({ type: 'system', text: `\nType 'run' to start another search, or 'help' for options.` });
        addLine({ type: 'output', text: ' ' });

        setWorkflowStep('IDLE');
        onStatusChange('completed'); // or online
      }, 6000);

    } catch (err: any) {
      addLine({ type: 'error', text: `[${timestamp()}] >> [ERROR] Failed to dispatch workflow: ${err.message}` });
      setWorkflowStep('IDLE');
      onStatusChange('online');
    }
  };

  const handleCommandSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (workflowStep === 'RUNNING') return;

    const trimmed = inputVal.trim();
    const currentPrompt = getPromptLabel();

    // Log the user's input line
    const userLineText = authStep === 'PASSWORD' && !user ? '********' : trimmed;
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        type: 'input',
        text: `${currentPrompt} ${userLineText}`,
      },
    ]);
    setInputVal('');

    // ──────────────────────────────────────────
    // AUTHENTICATION FLOW (One-by-one inputs)
    // ──────────────────────────────────────────
    if (!user) {
      if (authStep === 'NAME') {
        if (!trimmed) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Name cannot be empty. Please enter your name:' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, name: trimmed }));
        setAuthStep('EMAIL');
        return;
      }

      if (authStep === 'EMAIL') {
        if (!trimmed || !trimmed.includes('@')) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Please enter a valid email address (e.g. user@example.com):' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, email: trimmed }));
        setAuthStep('PASSWORD');
        return;
      }

      if (authStep === 'PASSWORD') {
        if (trimmed.length < 6) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Password must be at least 6 characters. Please re-enter:' }]);
          return;
        }
        
        setLines((prev) => [...prev, { id: String(Date.now()), type: 'system', text: 'Authenticating...' }]);
        
        const avatarUrl = getRandomAvatar();
        
        // Use an async IIFE to handle the Supabase call
        (async () => {
          const { error } = await supabase.auth.signUp({
            email: authDraft.email,
            password: trimmed,
            options: {
              data: {
                name: authDraft.name,
                avatar_url: avatarUrl
              }
            }
          });

          if (error) {
            // Check if user already exists
            if (error.message.includes('already registered') || error.message.includes('User already exists')) {
              setLines((prev) => [...prev, 
                { id: String(Date.now()), type: 'system', text: 'User already exists. Attempting login...' }
              ]);
              
              const { error: signInError } = await supabase.auth.signInWithPassword({
                email: authDraft.email,
                password: trimmed,
              });
              
              if (signInError) {
                setLines((prev) => [...prev, 
                  { id: String(Date.now()), type: 'error', text: `Login failed: ${signInError.message}. Restarting auth.` },
                  { id: String(Date.now() + 1), type: 'system', text: 'Enter your full name:' }
                ]);
                setAuthStep('NAME');
                setAuthDraft({ name: '', email: '', password: '' });
                return;
              }
              
              // We'll let App.tsx handle the onLogin when the auth state change fires
              return;
            }
            
            setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: `Auth failed: ${error.message}. Try again:` }]);
            return;
          }

          // We'll let App.tsx handle the onLogin when the auth state change fires
        })();
        
        return;
      }
    }

    // ──────────────────────────────────────────
    // WORKFLOW CONFIGURATION FLOW (One-by-one)
    // ──────────────────────────────────────────
    if (workflowStep === 'JOB_TITLE') {
      const title = trimmed || 'Software Engineer';
      setWorkflowDraft((d) => ({ ...d, jobTitle: title }));
      setWorkflowStep('RECIPIENT_EMAIL');
      return;
    }

    if (workflowStep === 'RECIPIENT_EMAIL') {
      const email = trimmed || user!.email;
      setWorkflowDraft((d) => ({ ...d, recipientEmail: email }));
      setWorkflowStep('FRESHERS');
      return;
    }

    if (workflowStep === 'FRESHERS') {
      const isFreshers = trimmed.toLowerCase().startsWith('y') || trimmed.toLowerCase() === 'true';
      setWorkflowDraft((d) => ({ ...d, freshersOnly: isFreshers }));
      setWorkflowStep('MIN_STARS');
      return;
    }

    if (workflowStep === 'MIN_STARS') {
      const parsedStars = parseInt(trimmed, 10);
      const stars = !isNaN(parsedStars) && parsedStars >= 1 && parsedStars <= 5 ? parsedStars : 3;
      const updatedParams = { ...workflowDraft, minStars: stars };
      setWorkflowDraft(updatedParams);

      setLines((prev) => [
        ...prev,
        { id: String(Date.now()), type: 'system', text: '\n--- Workflow Review ---' },
        { id: String(Date.now() + 1), type: 'output', text: `• Job Title: ${updatedParams.jobTitle}` },
        { id: String(Date.now() + 2), type: 'output', text: `• Recipient: ${updatedParams.recipientEmail}` },
        { id: String(Date.now() + 3), type: 'output', text: `• Freshers Only: ${updatedParams.freshersOnly ? 'Yes' : 'No'}` },
        { id: String(Date.now() + 4), type: 'output', text: `• Min Stars: ${updatedParams.minStars}★` },
        { id: String(Date.now() + 5), type: 'system', text: '-----------------------\n' },
      ]);
      setWorkflowStep('CONFIRM');
      return;
    }

    if (workflowStep === 'CONFIRM') {
      if (trimmed.toLowerCase().startsWith('n')) {
        setLines((prev) => [...prev, { id: String(Date.now()), type: 'warning', text: "Workflow dispatch cancelled. Type 'run' to configure again." }]);
        setWorkflowStep('IDLE');
        return;
      }
      executeWorkflow(workflowDraft);
      return;
    }

    // ──────────────────────────────────────────
    // GENERAL COMMAND MODE
    // ──────────────────────────────────────────
    const cmd = trimmed.toLowerCase();

    switch (cmd) {
      case 'run':
      case 'start':
      case 'scout':
        setWorkflowDraft({
          jobTitle: '',
          recipientEmail: user!.email,
          freshersOnly: false,
          minStars: 3,
        });
        setWorkflowStep('JOB_TITLE');
        break;

      case 'clear':
      case 'cls':
        setLines([
          { id: String(Date.now()), type: 'system', text: "Terminal cleared. Type 'run' or 'help'." },
        ]);
        break;

      case 'status':
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'system', text: `System Status: ONLINE` },
          { id: String(Date.now() + 1), type: 'output', text: `Active Agent: ${user!.name} <${user!.email}>` },
          { id: String(Date.now() + 2), type: 'output', text: `ATS Endpoints: 850+ Connected` },
          { id: String(Date.now() + 3), type: 'output', text: `AI Review Engine: Gemini 2.5 Flash` },
        ]);
        break;

      case 'whoami':
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'output', text: `Agent Name: ${user!.name}` },
          { id: String(Date.now() + 1), type: 'output', text: `Agent Email: ${user!.email}` },
        ]);
        break;

      case 'logout':
      case 'signout':
      case 'exit':
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'system', text: 'Signing out...' },
        ]);
        (async () => {
          await supabase.auth.signOut();
          onLogout();
        })();
        break;

      case 'help':
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'system', text: 'Available Commands:' },
          { id: String(Date.now() + 1), type: 'output', text: '  run      - Start interactive Job Scout parameter prompt' },
          { id: String(Date.now() + 2), type: 'output', text: '  status   - Show pipeline and system status' },
          { id: String(Date.now() + 3), type: 'output', text: '  whoami   - Display active user profile' },
          { id: String(Date.now() + 4), type: 'output', text: '  clear    - Clear terminal screen' },
          { id: String(Date.now() + 5), type: 'output', text: '  logout   - Switch account / sign out' },
          { id: String(Date.now() + 6), type: 'output', text: '  help     - Show this help manual' },
        ]);
        break;

      case '':
        break;

      default:
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'error', text: `Command not recognized: '${trimmed}'. Type 'help' for available commands or 'run' to start.` },
        ]);
        break;
    }
  };

  return (
    <div className="sketch-terminal" onClick={handleTerminalClick}>
      {/* ── Hand-Drawn Window Title Header ── */}
      <div className="sketch-terminal__topbar">
        <span className="sketch-terminal__title">Terminal commands</span>
      </div>

      {/* ── Scrollable Terminal Output Screen ── */}
      <div className="sketch-terminal__body" ref={terminalBodyRef}>
        {lines.map((line) => (
          <div key={line.id} className={`terminal-line terminal-line--${line.type}`}>
            {line.text}
          </div>
        ))}

        {/* ── Active Prompt Input Line ── */}
        <form className="terminal-prompt" onSubmit={handleCommandSubmit}>
          <span className="terminal-prompt__label">{getPromptLabel()}</span>
          <div className="terminal-prompt__input-wrapper">
            <input
              ref={inputRef}
              type={!user && authStep === 'PASSWORD' ? 'password' : 'text'}
              className="terminal-prompt__input"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              disabled={workflowStep === 'RUNNING'}
            />
            <span className="terminal-cursor" aria-hidden="true">█</span>
          </div>
        </form>
      </div>
    </div>
  );
}
