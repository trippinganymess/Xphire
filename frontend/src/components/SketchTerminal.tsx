import { useState, useEffect, useRef, type FormEvent } from 'react';
import { type SystemStatus } from './SketchHeader';
import './SketchTerminal.css';

export interface UserSession {
  name: string;
  email: string;
  apiKey: string;
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

type AuthStep = 'NAME' | 'EMAIL' | 'PASSWORD' | 'API_KEY' | 'DONE';
type WorkflowStep = 'IDLE' | 'JOB_TITLE' | 'RECIPIENT_EMAIL' | 'FRESHERS' | 'MIN_STARS' | 'CONFIRM' | 'RUNNING';

interface SketchTerminalProps {
  user: UserSession | null;
  onLogin: (user: UserSession) => void;
  onLogout: () => void;
  onStatusChange: (status: SystemStatus) => void;
}

export default function SketchTerminal({
  user,
  onLogin,
  onLogout,
  onStatusChange,
}: SketchTerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [inputVal, setInputVal] = useState('');
  
  // Step state machines
  const [authStep, setAuthStep] = useState<AuthStep>('NAME');
  const [authDraft, setAuthDraft] = useState({ name: '', email: '', password: '', apiKey: '' });

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
        { id: '5', type: 'system', text: 'Please sign up with your credentials (step 1 of 4).' },
        { id: '6', type: 'output', text: ' ' },
      ]);
      setAuthStep('NAME');
    } else {
      setLines([
        { id: '1', type: 'header', text: '==================================================' },
        { id: '2', type: 'header', text: '      XPHIRE AI JOB SCOUT - TERMINAL v2.4       ' },
        { id: '3', type: 'header', text: '==================================================' },
        { id: '4', type: 'success', text: `Welcome back, ${user.name} (${user.email})!` },
        { id: '5', type: 'system', text: "Type 'run' to start a new job search, or 'help' for commands." },
        { id: '6', type: 'output', text: ' ' },
      ]);
      setWorkflowStep('IDLE');
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
        case 'API_KEY':
          return 'Enter API access key:';
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
  const executeWorkflow = (params: WorkflowParams) => {
    setWorkflowStep('RUNNING');
    onStatusChange('running');

    const timestamp = () => new Date().toLocaleTimeString();

    const addLine = (line: Omit<TerminalLine, 'id'>) => {
      setLines((prev) => [...prev, { ...line, id: String(Date.now() + Math.random()) }]);
    };

    addLine({ type: 'system', text: `\n[${timestamp()}] >> [DISPATCH] Triggering GitHub Actions workflow_dispatch 'email_jobs.yml'...` });

    setTimeout(() => {
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Job Title: "${params.jobTitle}"` });
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Recipient: ${params.recipientEmail}` });
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Freshers Only: ${params.freshersOnly}` });
      addLine({ type: 'output', text: `[${timestamp()}] >> [PARAM] Min Stars: ${params.minStars}★` });
    }, 600);

    setTimeout(() => {
      addLine({ type: 'system', text: `[${timestamp()}] >> [CACHE] Checking Supabase Seen_job cache (< 6h old)...` });
    }, 1300);

    setTimeout(() => {
      addLine({ type: 'output', text: `[${timestamp()}] >> [ATS_SCAN] Scanning 850+ ATS endpoints (Greenhouse, Lever, Ashby, SmartRecruiters)...` });
    }, 2200);

    setTimeout(() => {
      addLine({ type: 'output', text: `[${timestamp()}] >> [JOBSPY] Aggregating Google Jobs, LinkedIn & Indeed postings...` });
    }, 3100);

    setTimeout(() => {
      addLine({ type: 'system', text: `[${timestamp()}] >> [AI_REVIEW] Gemini AI evaluating relevance & company ratings...` });
    }, 4000);

    setTimeout(() => {
      addLine({ type: 'output', text: `[${timestamp()}] >> [EMAIL] Compiling HTML digest email with custom rating badges...` });
    }, 4900);

    setTimeout(() => {
      addLine({ type: 'success', text: `[${timestamp()}] >> [SENT] SMTPSecure delivery complete -> Sent to ${params.recipientEmail}!` });
      addLine({ type: 'success', text: `✓ Workflow completed successfully (Run ID: #${Math.floor(100000000 + Math.random() * 900000000)}).` });
      addLine({ type: 'system', text: `\nType 'run' to start another search, or 'help' for options.` });
      addLine({ type: 'output', text: ' ' });

      setWorkflowStep('IDLE');
      onStatusChange('completed');
    }, 5800);
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
        setAuthDraft((d) => ({ ...d, password: trimmed }));
        setAuthStep('API_KEY');
        return;
      }

      if (authStep === 'API_KEY') {
        const finalKey = trimmed || 'XPHIRE-DEFAULT-KEY';
        const session: UserSession = {
          name: authDraft.name,
          email: authDraft.email,
          apiKey: finalKey,
        };
        onLogin(session);
        onStatusChange('online');
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
          { id: String(Date.now() + 2), type: 'output', text: `API Key: ${user!.apiKey.slice(0, 4)}...${user!.apiKey.slice(-4)}` },
        ]);
        break;

      case 'logout':
      case 'signout':
      case 'exit':
        setLines((prev) => [
          ...prev,
          { id: String(Date.now()), type: 'system', text: 'Signing out...' },
        ]);
        onLogout();
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
