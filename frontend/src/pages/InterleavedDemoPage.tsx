import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { VisualSourceBadge } from '../components/ui';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const PRESET_PROMPTS = [
  {
    label: 'Treaty of Westphalia, 1648',
    prompt:
      'You are the creative director of a cinematic historical documentary. Describe the signing of the Treaty of Westphalia in 1648, then generate a cinematic illustration — candlelit hall, exhausted diplomats, quill touching parchment. Write your creative direction note first, then produce the image.',
  },
  {
    label: 'Construction of the Pyramids',
    prompt:
      'You are the creative director of a cinematic historical documentary. Describe the construction of the Great Pyramid of Giza, then generate a cinematic illustration — thousands of workers hauling limestone blocks under the blazing desert sun, the half-built pyramid rising behind them. Write your creative direction first, then produce the image.',
  },
  {
    label: 'Fall of Constantinople, 1453',
    prompt:
      'You are the creative director of a cinematic historical documentary. Describe the final siege of Constantinople in 1453, then generate a cinematic illustration — Ottoman cannons breaching the Theodosian walls, smoke and fire, defenders on the ramparts at dawn. Write your creative direction first, then produce the image.',
  },
];

interface Part {
  type: 'text' | 'image' | 'config' | 'done' | 'error';
  content?: string;
  dataUrl?: string;
  model?: string;
  responseModalities?: string[];
  prompt?: string;
  totalParts?: number;
  elapsedMs?: number;
  message?: string;
  partIndex?: number;
}

export function InterleavedDemoPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [promptText, setPromptText] = useState(PRESET_PROMPTS[0].prompt);
  const abortRef = useRef<AbortController | null>(null);

  const startDemo = useCallback(async () => {
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
      return;
    }

    setParts([]);
    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const url = `${API_BASE}/api/demo/interleaved?prompt=${encodeURIComponent(promptText)}`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok || !response.body) {
        setParts([{ type: 'error', message: `HTTP ${response.status}` }]);
        setIsStreaming(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.slice(6)) as Part;
              setParts((prev) => [...prev, parsed]);
            } catch {
              // skip malformed
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setParts((prev) => [...prev, { type: 'error', message: String(err) }]);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [isStreaming, promptText]);

  const configPart = parts.find((p) => p.type === 'config');
  const donePart = parts.find((p) => p.type === 'done');
  const contentParts = parts.filter((p) => p.type === 'text' || p.type === 'image');

  return (
    <div className="min-h-screen bg-[var(--bg)] px-6 py-12 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <p
          className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.3em] mb-2"
        >
          Interleaved Output Demo
        </p>
        <h1 className="font-serif text-[28px] text-[var(--text)] leading-tight mb-2">
          Gemini Interleaved TEXT + IMAGE
        </h1>
        <p className="font-sans text-[13px] text-[var(--muted)] max-w-2xl">
          One model. One API call. Text and imagery composed together in a single reasoning pass.
          This is Gemini&rsquo;s native interleaved output &mdash; the foundation of AI Historian&rsquo;s
          Creative Direction Team.
        </p>
      </div>

      {/* Prompt presets */}
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESET_PROMPTS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setPromptText(preset.prompt)}
            className={`
              px-3 py-1.5 rounded border font-sans text-[11px] uppercase tracking-[0.1em]
              transition-all duration-200
              ${promptText === preset.prompt
                ? 'bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/40'
                : 'bg-[var(--bg2)] text-[var(--muted)] border-[var(--bg4)] hover:border-[var(--gold)]/30'
              }
            `}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Prompt input */}
      <div className="mb-6">
        <textarea
          value={promptText}
          onChange={(e) => setPromptText(e.target.value)}
          rows={3}
          className="w-full bg-[var(--bg2)] border border-[var(--bg4)] rounded-lg px-4 py-3 font-sans text-[13px] text-[var(--text)] resize-none focus:outline-none focus:border-[var(--gold)]/40 transition-colors"
          placeholder="Enter a historical prompt..."
        />
      </div>

      {/* Compose button */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={startDemo}
          className={`
            px-6 py-2.5 rounded-lg font-sans text-[11px] uppercase tracking-[0.2em]
            transition-all duration-200 border
            ${isStreaming
              ? 'bg-red-500/15 text-red-500 border-red-500/30 hover:bg-red-500/25'
              : 'bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/40 hover:bg-[var(--gold)]/25'
            }
          `}
        >
          {isStreaming ? 'Stop' : 'Compose'}
        </button>

        {isStreaming && (
          <VisualSourceBadge source="composing" />
        )}

        {donePart && !isStreaming && (
          <span className="font-sans text-[11px] text-[var(--muted)]">
            {donePart.totalParts} parts &middot; {donePart.elapsedMs}ms
          </span>
        )}
      </div>

      {/* API Config Inspector */}
      <AnimatePresence>
        {configPart && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="mb-8 rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4"
          >
            <p className="font-sans text-[9px] text-[var(--muted)] uppercase tracking-[0.2em] mb-2">
              API Configuration
            </p>
            <pre className="font-mono text-[12px] text-[var(--text)] leading-relaxed overflow-x-auto">
{`model: "${configPart.model}"
config: {
  response_modalities: ${JSON.stringify(configPart.responseModalities)}
  temperature: 0.7
}`}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Interleaved parts display */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {contentParts.map((part, i) => (
            <motion.div
              key={`part-${i}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22, delay: i * 0.05 }}
              className="flex gap-4 items-start"
            >
              {/* Part type indicator */}
              <div className="shrink-0 pt-1">
                <div className="flex flex-col items-center gap-1">
                  <span className="font-sans text-[9px] text-[var(--muted)] uppercase tracking-[0.15em]">
                    Part {(part.partIndex ?? i) + 1}
                  </span>
                  <VisualSourceBadge
                    source={part.type === 'image' ? 'interleaved' : 'composing'}
                  />
                </div>
              </div>

              {/* Connecting line */}
              <div className="shrink-0 w-px bg-[var(--gold)]/20 self-stretch min-h-[40px]" />

              {/* Content */}
              <div className="flex-1 min-w-0">
                {part.type === 'text' && (
                  <div className="rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4">
                    <p className="font-sans text-[9px] text-[var(--muted)] uppercase tracking-[0.2em] mb-2">
                      Text Output
                    </p>
                    <p className="font-sans text-[13px] text-[var(--text)] leading-relaxed whitespace-pre-wrap">
                      {part.content}
                    </p>
                  </div>
                )}

                {part.type === 'image' && (
                  <div className="rounded-lg border border-[var(--gold)]/30 bg-[var(--bg2)] p-2 overflow-hidden">
                    <div className="flex items-center gap-2 px-2 pb-2">
                      <p className="font-sans text-[9px] text-[var(--muted)] uppercase tracking-[0.2em]">
                        Image Output
                      </p>
                      <VisualSourceBadge source="interleaved" />
                    </div>
                    <img
                      src={part.dataUrl}
                      alt="Gemini interleaved output"
                      className="w-full rounded-md"
                    />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Error display */}
        {parts.filter((p) => p.type === 'error').map((err, i) => (
          <div key={`err-${i}`} className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
            <p className="font-sans text-[12px] text-red-500">{err.message}</p>
          </div>
        ))}
      </div>

      {/* Completion summary */}
      <AnimatePresence>
        {donePart && !isStreaming && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, type: 'spring', stiffness: 300, damping: 24 }}
            className="mt-8 rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/5 p-4 text-center"
          >
            <p className="font-serif text-[14px] text-[var(--gold)]">
              Single API call &rarr; {donePart.totalParts} interleaved parts &rarr; {donePart.elapsedMs}ms
            </p>
            <p className="font-sans text-[11px] text-[var(--muted)] mt-1">
              Text and image composed in one reasoning pass &mdash; not separate API calls
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
