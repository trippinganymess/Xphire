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

type AuthStep =
  | 'MODE_SELECT'
  | 'SIGNUP_NAME'
  | 'SIGNUP_EMAIL'
  | 'SIGNUP_PASSWORD'
  | 'SIGNUP_CONFIRM_PASSWORD'
  | 'SIGNIN_EMAIL'
  | 'SIGNIN_PASSWORD'
  | 'DONE';
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
  const [authStep, setAuthStep] = useState<AuthStep>('MODE_SELECT');
  const [authDraft, setAuthDraft] = useState({ name: '', email: '', password: '', confirmPassword: '' });

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
        { id: '5', type: 'system', text: 'Please select an option to proceed:' },
        { id: '6', type: 'output', text: '  [1] Sign Up (Create a new account)' },
        { id: '7', type: 'output', text: '  [2] Sign In (Log in with existing credentials)' },
        { id: '8', type: 'output', text: ' ' },
      ]);
      setAuthStep('MODE_SELECT');
      setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
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
        case 'MODE_SELECT':
          return 'Select option [1=Sign Up, 2=Sign In]:';
        case 'SIGNUP_NAME':
          return 'Enter your full name:';
        case 'SIGNUP_EMAIL':
          return 'Enter your email address:';
        case 'SIGNUP_PASSWORD':
          return 'Create a password:';
        case 'SIGNUP_CONFIRM_PASSWORD':
          return 'Confirm your password:';
        case 'SIGNIN_EMAIL':
          return 'Enter your email address:';
        case 'SIGNIN_PASSWORD':
          return 'Enter your password:';
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

      if (error) {
        // FunctionsHttpError wraps the real response in error.context
        // We need to read the body to get the actual error message
        let detail = error.message;
        try {
          const ctx = (error as any).context;
          const body = typeof ctx?.json === 'function' ? await ctx.json() : null;
          detail = body?.error || body?.message || error.message;
        } catch (_) {}
        addLine({ type: 'error', text: `[${timestamp()}] >> [ERROR] Failed to dispatch workflow: ${detail}` });
        setWorkflowStep('IDLE');
        onStatusChange('online');
        return;
      }

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
    const isPasswordPrompt = !user && (
      authStep === 'SIGNUP_PASSWORD' ||
      authStep === 'SIGNUP_CONFIRM_PASSWORD' ||
      authStep === 'SIGNIN_PASSWORD'
    );
    const userLineText = isPasswordPrompt ? '********' : trimmed;
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        type: 'input',
        text: `${currentPrompt} ${userLineText}`,
      },
    ]);
    setInputVal('');

    // Global navigation during authentication
    if (!user && (trimmed.toLowerCase() === 'menu' || trimmed.toLowerCase() === 'back' || trimmed.toLowerCase() === 'restart')) {
      setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
      setAuthStep('MODE_SELECT');
      setLines((prev) => [
        ...prev,
        { id: String(Date.now()), type: 'system', text: '\nReturned to authentication menu:' },
        { id: String(Date.now() + 1), type: 'output', text: '  [1] Sign Up (Create a new account)' },
        { id: String(Date.now() + 2), type: 'output', text: '  [2] Sign In (Log in with existing credentials)\n' },
      ]);
      return;
    }

    // ──────────────────────────────────────────
    // AUTHENTICATION FLOW (Mode Select, Sign Up, Sign In)
    // ──────────────────────────────────────────
    if (!user) {
      // Step 0: Choose Sign Up vs Sign In
      if (authStep === 'MODE_SELECT') {
        const choice = trimmed.toLowerCase();
        if (choice === '1' || choice === 'signup' || choice === 'sign up' || choice === 'register') {
          setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
          setAuthStep('SIGNUP_NAME');
          setLines((prev) => [
            ...prev,
            { id: String(Date.now()), type: 'system', text: '--- Sign Up (Step 1 of 4) ---' },
          ]);
          return;
        } else if (choice === '2' || choice === 'signin' || choice === 'sign in' || choice === 'login') {
          setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
          setAuthStep('SIGNIN_EMAIL');
          setLines((prev) => [
            ...prev,
            { id: String(Date.now()), type: 'system', text: '--- Sign In (Step 1 of 2) ---' },
          ]);
          return;
        } else {
          setLines((prev) => [
            ...prev,
            { id: String(Date.now()), type: 'error', text: "Invalid choice. Please enter '1' for Sign Up or '2' for Sign In." },
          ]);
          return;
        }
      }

      // --- SIGN UP FLOW ---
      if (authStep === 'SIGNUP_NAME') {
        if (!trimmed) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Name cannot be empty. Please enter your name:' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, name: trimmed }));
        setAuthStep('SIGNUP_EMAIL');
        return;
      }

      if (authStep === 'SIGNUP_EMAIL') {
        if (!trimmed || !trimmed.includes('@')) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Please enter a valid email address (e.g. user@example.com):' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, email: trimmed }));
        setAuthStep('SIGNUP_PASSWORD');
        return;
      }

      if (authStep === 'SIGNUP_PASSWORD') {
        if (trimmed.length < 6) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Password must be at least 6 characters. Please re-enter:' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, password: trimmed }));
        setAuthStep('SIGNUP_CONFIRM_PASSWORD');
        return;
      }

      if (authStep === 'SIGNUP_CONFIRM_PASSWORD') {
        if (trimmed.toLowerCase() === 'retry') {
          setAuthStep('SIGNUP_PASSWORD');
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'system', text: 'Please enter a new password:' }]);
          return;
        }

        if (trimmed !== authDraft.password) {
          setLines((prev) => [
            ...prev,
            { id: String(Date.now()), type: 'error', text: 'Passwords do not match. Please re-enter matching password (or type "retry" to start password over):' },
          ]);
          return;
        }
        
        setLines((prev) => [...prev, { id: String(Date.now()), type: 'system', text: 'Passwords matched. Creating account...' }]);
        
        const avatarUrl = getRandomAvatar();
        
        (async () => {
          const { data, error } = await supabase.auth.signUp({
            email: authDraft.email,
            password: authDraft.password,
            options: {
              data: {
                name: authDraft.name,
                avatar_url: avatarUrl,
              },
            },
          });

          if (error) {
            setLines((prev) => [
              ...prev,
              { id: String(Date.now()), type: 'error', text: `Sign up failed: ${error.message}` },
              { id: String(Date.now() + 1), type: 'system', text: "Returning to authentication menu. Select [2] if you have an account or wish to sign in." },
              { id: String(Date.now() + 2), type: 'output', text: '  [1] Sign Up (Create a new account)' },
              { id: String(Date.now() + 3), type: 'output', text: '  [2] Sign In (Log in with existing credentials)\n' },
            ]);
            setAuthStep('MODE_SELECT');
            setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
            return;
          }

          if (data?.session) {
            setLines((prev) => [
              ...prev,
              { id: String(Date.now()), type: 'success', text: '✓ Account created successfully! Logging you in...' },
            ]);
          } else if (data?.user && !data?.session) {
            setLines((prev) => [
              ...prev,
              { id: String(Date.now()), type: 'warning', text: `✓ Confirmation email sent to ${authDraft.email}!` },
              { id: String(Date.now() + 1), type: 'system', text: 'Please check your inbox to confirm your email, then select [2] to Sign In.' },
              { id: String(Date.now() + 2), type: 'output', text: ' ' },
              { id: String(Date.now() + 3), type: 'output', text: '  [1] Sign Up (Create a new account)' },
              { id: String(Date.now() + 4), type: 'output', text: '  [2] Sign In (Log in with existing credentials)\n' },
            ]);
            setAuthStep('MODE_SELECT');
            setAuthDraft({ name: '', email: '', password: '', confirmPassword: '' });
          }
        })();
        
        return;
      }

      // --- SIGN IN FLOW ---
      if (authStep === 'SIGNIN_EMAIL') {
        if (!trimmed || !trimmed.includes('@')) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Please enter a valid email address (e.g. user@example.com):' }]);
          return;
        }
        setAuthDraft((d) => ({ ...d, email: trimmed }));
        setAuthStep('SIGNIN_PASSWORD');
        return;
      }

      if (authStep === 'SIGNIN_PASSWORD') {
        if (!trimmed) {
          setLines((prev) => [...prev, { id: String(Date.now()), type: 'error', text: 'Password cannot be empty. Please enter your password:' }]);
          return;
        }

        setLines((prev) => [...prev, { id: String(Date.now()), type: 'system', text: 'Authenticating credentials...' }]);

        (async () => {
          const { error } = await supabase.auth.signInWithPassword({
            email: authDraft.email,
            password: trimmed,
          });

          if (error) {
            setLines((prev) => [
              ...prev,
              { id: String(Date.now()), type: 'error', text: `Login failed: ${error.message}` },
              { id: String(Date.now() + 1), type: 'system', text: "Please re-enter password, or type 'menu' to choose another option:" },
            ]);
            return;
          }

          setLines((prev) => [
            ...prev,
            { id: String(Date.now()), type: 'success', text: '✓ Credentials verified! Logging you in...' },
          ]);
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
              type={!user && (authStep === 'SIGNUP_PASSWORD' || authStep === 'SIGNUP_CONFIRM_PASSWORD' || authStep === 'SIGNIN_PASSWORD') ? 'password' : 'text'}
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
