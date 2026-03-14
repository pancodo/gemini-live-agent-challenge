import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { DropZone, PersonaSelector } from '../components/upload';
import { Badge } from '../components/ui';
import { useSessionStore } from '../store/sessionStore';
import type { RecentSession } from '../store/sessionStore';
import { useResearchStore } from '../store/researchStore';
import { usePlayerStore } from '../store/playerStore';
import { uploadDocument } from '../services/upload';
import type { SessionStatus, PersonaType } from '../types';

/** Prefetch the WorkspacePage chunk so it is cached before navigation */
const prefetchWorkspace = () => import('./WorkspacePage');

const SAMPLE_DOCS = [
  {
    filename: 'sample-pompeii.pdf',
    label: 'Pompeii',
    meta: '29 pages · Roman city buried by Vesuvius, 79 AD',
    language: 'English',
  },
  {
    filename: 'sample-tutankhamun.pdf',
    label: 'Tutankhamun',
    meta: '29 pages · Egyptian pharaoh, golden mask, tomb discovery',
    language: 'English',
  },
  {
    filename: 'sample-fall-of-constantinople.pdf',
    label: 'Fall of Constantinople',
    meta: '28 pages · 1453 · Ottoman siege, end of Byzantium',
    language: 'English',
  },
  {
    filename: 'sample-machu-picchu.pdf',
    label: 'Machu Picchu',
    meta: '26 pages · Inca citadel, Andes mountains',
    language: 'English',
  },
  {
    filename: 'sample-colosseum.pdf',
    label: 'Colosseum',
    meta: '22 pages · Roman amphitheater, gladiators, spectacles',
    language: 'English',
  },
];

function SampleDocuments() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const persona = useSessionStore((s) => s.persona) as PersonaType;
  const researchMode = useSessionStore((s) => s.researchMode);
  const resetResearch = useResearchStore((s) => s.reset);
  const [loading, setLoading] = useState<string | null>(null);

  const handleSample = useCallback(
    async (doc: (typeof SAMPLE_DOCS)[number]) => {
      setLoading(doc.filename);
      prefetchWorkspace();
      try {
        const res = await fetch(`/samples/${doc.filename}`);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const file = new File([blob], doc.filename, { type: 'application/pdf' });
        const { sessionId, gcsPath } = await uploadDocument(file, doc.language, persona, undefined, researchMode);
        resetResearch();
        setSession({ sessionId, gcsPath, status: 'processing', documentLabel: doc.label });
        navigate('/workspace');
      } catch (err) {
        setLoading(null);
        toast.error('Failed to load sample document', {
          description: err instanceof Error ? err.message : 'Is the backend running?',
        });
      }
    },
    [navigate, setSession, persona, researchMode, resetResearch]
  );

  return (
    <div className="w-full max-w-xl mt-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-sans mb-2 text-center">
        or try a sample
      </p>
      <div className="flex flex-col gap-1.5">
        {SAMPLE_DOCS.map((doc) => (
          <button
            key={doc.filename}
            onClick={() => handleSample(doc)}
            disabled={loading !== null}
            className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] hover:border-[var(--gold)]/40 hover:bg-[var(--bg3)] transition-colors text-left disabled:opacity-50"
          >
            <div>
              <p className="text-[13px] text-[var(--text)] font-sans">{doc.label}</p>
              <p className="text-[11px] text-[var(--muted)] font-sans mt-0.5">{doc.meta}</p>
            </div>
            {loading === doc.filename ? (
              <span className="inline-block w-3.5 h-3.5 border border-[var(--muted)]/40 border-t-[var(--gold)] rounded-full animate-spin flex-shrink-0" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-[var(--muted)] flex-shrink-0">
                <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

const STATUS_VARIANTS: Record<SessionStatus, 'gold' | 'teal' | 'green' | 'muted' | 'red'> = {
  idle: 'muted',
  uploading: 'teal',
  processing: 'teal',
  ready: 'green',
  playing: 'gold',
  error: 'red',
};

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function RecentSessions() {
  const navigate = useNavigate();
  const recentSessions = useSessionStore((s) => s.recentSessions);
  const setSession = useSessionStore((s) => s.setSession);

  if (recentSessions.length === 0) return null;

  const visible = recentSessions.slice(0, 3);

  const handleResume = (entry: RecentSession) => {
    setSession({
      sessionId: entry.sessionId,
      gcsPath: entry.gcsPath,
      language: entry.language,
      status: 'processing',
    });
    navigate('/workspace');
  };

  return (
    <div className="w-full max-w-xl mt-6">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-sans mb-2 text-center">
        Recent Sessions
      </p>
      <div className="flex flex-col gap-1.5">
        {visible.map((entry) => (
          <button
            key={entry.sessionId}
            onClick={() => handleResume(entry)}
            className="flex items-center justify-between px-4 py-2.5 rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] hover:border-[var(--gold)]/40 hover:bg-[var(--bg3)] transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="min-w-0">
                <p className="text-[13px] text-[var(--text)] font-sans truncate">
                  {entry.label}
                </p>
                <p className="text-[11px] text-[var(--muted)] font-sans mt-0.5">
                  {formatRelativeTime(entry.createdAt)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
              <Badge variant={STATUS_VARIANTS[entry.status]}>
                {entry.status}
              </Badge>
              <span className="text-[11px] text-[var(--muted)] font-sans whitespace-nowrap">
                Resume &rarr;
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DevSeedBar() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const setAgent = useResearchStore((s) => s.setAgent);
  const setSegment = useResearchStore((s) => s.setSegment);
  const updateStats = useResearchStore((s) => s.updateStats);
  const addPhaseMessage = useResearchStore((s) => s.addPhaseMessage);
  const openPlayer = usePlayerStore((s) => s.open);

  const seedWorkspace = useCallback(() => {
    setSession({
      sessionId: 'dev-session-001',
      status: 'ready',
      language: 'Ottoman Turkish',
      documentUrl: null,
    });
    setAgent('scan_agent', { id: 'scan_agent', query: 'Scan document', status: 'done', logs: [], elapsed: 4200, facts: ['Grand Vizier', 'Edirne', 'Topkapi Palace'] });
    setAgent('research_0', { id: 'research_0', query: 'Who was Grand Vizier Sokollu Mehmed Pasha?', status: 'done', logs: [], elapsed: 18400, facts: ['Served as Grand Vizier 1565–1579', 'Born in Bosnia c.1506', 'Assassinated by a dervish'] });
    setAgent('research_1', { id: 'research_1', query: 'Edirne in the 1570s: political context', status: 'done', logs: [], elapsed: 22100, facts: ['Second capital of the Ottoman Empire', 'Site of Selimiye Mosque construction 1569–1575'] });
    setAgent('research_2', { id: 'research_2', query: 'Topkapi Palace administrative structure', status: 'searching', logs: [], elapsed: 9800 });
    setAgent('script_agent', { id: 'script_agent', query: 'Generate documentary script', status: 'done', logs: [], elapsed: 31000 });
    setAgent('visual_director', { id: 'visual_director', query: 'Generate cinematic visuals', status: 'searching', logs: [], elapsed: 12000 });
    setSegment('seg_01', { id: 'seg_01', title: 'The Grand Vizier\'s Decree', status: 'ready', imageUrls: ['https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Topkapi_palace_from_bosphorus.jpg/640px-Topkapi_palace_from_bosphorus.jpg'], script: 'In the waning days of Suleiman\'s empire, a document emerged from the imperial chancery that would reshape the borders of three provinces...', mood: 'Intrigue', sources: [], graphEdges: [] });
    setSegment('seg_02', { id: 'seg_02', title: 'The Road to Edirne', status: 'ready', imageUrls: ['https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Selimiye_Mosque%2C_Edirne%2C_Turkey.jpg/640px-Selimiye_Mosque%2C_Edirne%2C_Turkey.jpg'], script: 'The imperial road stretched northward through Thrace, each milestone a reminder of the empire\'s reach...', mood: 'Epic', sources: [], graphEdges: [] });
    setSegment('seg_03', { id: 'seg_03', title: 'The Fall of the Vizier', status: 'generating', imageUrls: [], script: '', mood: '', sources: [], graphEdges: [] });
    updateStats({ sourcesFound: 14, factsVerified: 28, segmentsReady: 2 });
    addPhaseMessage(1, 'Translation & Scan', 'Ottoman imperial decree (ferman), circa 16th century');
    addPhaseMessage(1, 'Translation & Scan', '3 entities identified · 2 geographic references · 4 knowledge gaps');
    addPhaseMessage(2, 'Field Research', '5 research agents dispatched in parallel');
    addPhaseMessage(3, 'Synthesis', 'Combining 28 verified facts into narrative arc...');
    navigate('/workspace');
  }, [setSession, setAgent, setSegment, updateStats, addPhaseMessage, navigate]);

  const setSegmentGeo = usePlayerStore((s) => s.setSegmentGeo);
  const setMapViewMode = usePlayerStore((s) => s.setMapViewMode);

  const seedPlayer = useCallback(() => {
    seedWorkspace();
    // Pre-seed geo data so the map works without a Gemini API key
    setSegmentGeo('seg_01', {
      segmentId: 'seg_01',
      center: [41.0, 29.0],
      zoom: 6,
      events: [
        { name: 'Constantinople', lat: 41.0082, lng: 28.9784, type: 'city', era: '1566', description: 'Seat of the Ottoman Empire' },
        { name: 'Topkapi Palace', lat: 41.0115, lng: 28.9833, type: 'city', era: '16th c.', description: 'Imperial residence and chancery' },
        { name: 'Edirne', lat: 41.6818, lng: 26.5623, type: 'city', era: '1570s', description: 'Second capital, site of Selimiye Mosque' },
      ],
      routes: [
        {
          name: 'Imperial Road',
          points: [[41.01, 28.98], [41.28, 28.02], [41.68, 26.56]],
          style: 'military',
        },
      ],
    });
    setSegmentGeo('seg_02', {
      segmentId: 'seg_02',
      center: [41.4, 27.5],
      zoom: 7,
      events: [
        { name: 'Edirne', lat: 41.6818, lng: 26.5623, type: 'city', era: '1575', description: 'Selimiye Mosque completed' },
        { name: 'Lüleburgaz', lat: 41.4036, lng: 27.3569, type: 'city', era: '16th c.', description: 'Waypoint on the imperial road' },
        { name: 'Constantinople', lat: 41.0082, lng: 28.9784, type: 'city', era: '16th c.', description: 'Starting point of the journey' },
      ],
      routes: [
        {
          name: 'Road to Edirne',
          points: [[41.01, 28.98], [41.20, 28.30], [41.40, 27.36], [41.68, 26.56]],
          style: 'trade',
        },
      ],
    });
    setMapViewMode('split');
    openPlayer('seg_01');
    navigate('/player/seg_01');
  }, [seedWorkspace, openPlayer, navigate, setSegmentGeo, setMapViewMode]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-50">
      <button
        onClick={seedWorkspace}
        className="px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.1em] bg-[var(--bg4)] border border-[var(--gold)]/40 text-[var(--gold)] rounded hover:bg-[var(--gold)]/10 transition-colors"
      >
        Dev → Workspace
      </button>
      <button
        onClick={seedPlayer}
        className="px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.1em] bg-[var(--bg4)] border border-[var(--gold)]/40 text-[var(--gold)] rounded hover:bg-[var(--gold)]/10 transition-colors"
      >
        Dev → Player
      </button>
      <button
        onClick={() => navigate('/test-map')}
        className="px-3 py-1.5 text-[11px] font-sans uppercase tracking-[0.1em] bg-[var(--bg4)] border border-[var(--teal)]/40 text-[var(--teal)] rounded hover:bg-[var(--teal)]/10 transition-colors"
      >
        Dev → Map
      </button>
    </div>
  );
}

function ResearchModeToggle() {
  const mode = useSessionStore((s) => s.researchMode);
  const setSession = useSessionStore((s) => s.setSession);

  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] font-sans">
        Research depth
      </span>
      <div className="flex rounded-md border border-[var(--bg4)] overflow-hidden">
        {(['test', 'normal'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setSession({ researchMode: m })}
            className={`px-3 py-1 text-[11px] font-sans uppercase tracking-[0.1em] transition-colors ${
              mode === m
                ? m === 'test'
                  ? 'bg-[var(--teal)] text-white'
                  : 'bg-[var(--gold)] text-white'
                : 'bg-[var(--bg2)] text-[var(--muted)] hover:bg-[var(--bg3)]'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
      <span className="text-[10px] text-[var(--muted)]/70 font-sans">
        {mode === 'test' ? '1 scene · 1 search · fast & cheap' : 'up to 4 scenes · 3 searches each'}
      </span>
    </div>
  );
}

export function UploadPage() {
  const persona = useSessionStore((s) => s.persona) as PersonaType;
  const setSession = useSessionStore((s) => s.setSession);

  return (
    <main className="h-full bg-[var(--bg)] flex flex-col overflow-y-auto">
      <section className="flex-1 flex flex-col items-center justify-center px-8 pb-8 pt-8">
        <img src="/logo.png" alt="AI Historian" className="h-14 w-auto mb-5" />
        <h1
          className="text-[22px] text-[var(--text)] text-center mb-2"
          style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}
        >
          Upload a historical document
        </h1>
        <p className="text-[13px] text-[var(--muted)] font-sans text-center mb-6">
          Begin your documentary in under 45 seconds
        </p>
        <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] font-sans mb-3 text-center">
          Choose your historian
        </p>
        <div className="mb-6">
          <PersonaSelector
            value={persona}
            onChange={(p) => setSession({ persona: p })}
          />
        </div>
        <ResearchModeToggle />
        <DropZone />
        <SampleDocuments />
        <RecentSessions />
      </section>

      <footer className="pb-6 text-center">
        <p className="text-[11px] text-[var(--muted)]/60 font-sans tracking-[0.1em]">
          Powered by Google Gemini &middot; Imagen 3 &middot; Cloud Document AI
        </p>
      </footer>

      <DevSeedBar />
    </main>
  );
}
