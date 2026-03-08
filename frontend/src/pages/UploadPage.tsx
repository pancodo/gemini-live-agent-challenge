import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DropZone } from '../components/upload';
import { useSessionStore } from '../store/sessionStore';
import { useResearchStore } from '../store/researchStore';
import { usePlayerStore } from '../store/playerStore';

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

  const seedPlayer = useCallback(() => {
    seedWorkspace();
    openPlayer('seg_01');
    navigate('/player/seg_01');
  }, [seedWorkspace, openPlayer, navigate]);

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
    </div>
  );
}

export function UploadPage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Top logo/header */}
      <header className="pt-16 pb-4 text-center">
        <h1
          className="text-[11px] uppercase tracking-[0.5em] text-[var(--gold-d)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          AI Historian
        </h1>
        <p
          className="mt-3 text-[22px] text-[var(--text)]"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          Upload a historical document to begin your documentary
        </p>
      </header>

      {/* Centered drop zone */}
      <section className="flex-1 flex items-center justify-center px-8 pb-16">
        <DropZone />
      </section>

      {/* Bottom tagline */}
      <footer className="pb-6 text-center">
        <p className="text-[11px] text-[var(--muted)]/60 font-sans tracking-[0.1em]">
          Powered by Google Gemini &middot; Imagen 3 &middot; Cloud Document AI
        </p>
      </footer>

      <DevSeedBar />
    </main>
  );
}
