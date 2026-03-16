import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  motion,
  useScroll,
  useTransform,
  useMotionValue,
  useSpring,
  useInView,
  useReducedMotion,
  animate,
} from 'motion/react';
import { useTextScramble } from '../hooks/useTextScramble';
import { useTheme } from '../hooks/useTheme';

// ─── CSS variable helpers ─────────────────────────────────────────────────────
// All theme-aware colors resolve through CSS custom properties so both light
// and dark modes are supported without any per-component branching for colors.
const C = {
  bg:           'var(--bg)',
  surface:      'var(--bg2)',
  surface2:     'var(--bg3)',
  surface3:     'var(--bg4)',
  text:         'var(--text)',
  // Secondary text: blend text toward muted for hierarchy
  text2:        'color-mix(in srgb, var(--text) 72%, var(--muted))',
  muted:        'var(--muted)',
  gold:         'var(--gold)',
  // Bright gold for large display numbers; stays readable in both themes
  goldBright:   'color-mix(in srgb, var(--gold) 80%, white)',
  // Border: very low-opacity gold tint
  border:       'color-mix(in srgb, var(--gold) 8%, transparent)',
  borderHover:  'color-mix(in srgb, var(--gold) 18%, transparent)',
} as const;

// Concrete gold values for Motion whileHover (CSS vars not supported in Motion keyframes)
const GOLD_LIGHT   = '#8B5E1A';
const GOLD_BRIGHT_LIGHT  = '#a87230';
const GOLD_DARK    = '#c4956a';
const GOLD_BRIGHT_DARK   = '#e8c9a0';

// ─── Shared animation variants ───────────────────────────────────────────────
const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

const fadeUp = {
  hidden: { opacity: 0, y: 20, filter: 'blur(6px)' },
  visible: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.6, ease: EASE } },
};

const stagger = (delay = 0) => ({
  hidden: {},
  visible: { transition: { staggerChildren: 0.1, delayChildren: delay } },
});

// ─── Animated counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const val = useMotionValue(0);
  const [display, setDisplay] = useState('0');
  const reduced = useReducedMotion();

  useEffect(() => {
    if (!inView) return;
    if (reduced) { setDisplay(`${to}${suffix}`); return; }
    const controls = animate(val, to, {
      duration: 1.8,
      ease: EASE,
      onUpdate: (v) => setDisplay(`${Math.round(v)}${suffix}`),
    });
    return () => controls.stop();
  }, [inView, to, suffix, val, reduced]);

  return <span ref={ref}>{display}</span>;
}

// ─── Word-by-word reveal ─────────────────────────────────────────────────────
function WordReveal({ text, className = '' }: { text: string; className?: string }) {
  const words = text.split(' ');
  return (
    <motion.p
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.5 }}
      variants={{ visible: { transition: { staggerChildren: 0.04, delayChildren: 0.1 } } }}
    >
      {words.map((w, i) => (
        <motion.span
          key={i}
          className="inline-block mr-[0.3em]"
          variants={{
            hidden: { opacity: 0, filter: 'blur(4px)', y: 4 },
            visible: { opacity: 1, filter: 'blur(0px)', y: 0, transition: { duration: 0.28, ease: 'easeOut' } },
          }}
        >
          {w}
        </motion.span>
      ))}
    </motion.p>
  );
}

// ─── 3D tilt card ────────────────────────────────────────────────────────────
function TiltCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const sx = useSpring(rx, { stiffness: 150, damping: 20 });
  const sy = useSpring(ry, { stiffness: 150, damping: 20 });
  const reduced = useReducedMotion();

  const handleMove = (e: React.MouseEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    rx.set(((e.clientY - r.top - r.height / 2) / (r.height / 2)) * 3);
    ry.set(-((e.clientX - r.left - r.width / 2) / (r.width / 2)) * 3);
    ref.current.style.setProperty('--mx', `${e.clientX - r.left}px`);
    ref.current.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <div style={{ perspective: 900 }}>
      <motion.div
        ref={ref}
        className={`relative ${className}`}
        style={{ rotateX: sx, rotateY: sy }}
        onMouseMove={handleMove}
        onMouseLeave={() => { rx.set(0); ry.set(0); }}
      >
        <div
          className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: 'radial-gradient(300px circle at var(--mx,50%) var(--my,50%), rgba(196,149,106,0.1), transparent 60%)',
          }}
        />
        {children}
      </motion.div>
    </div>
  );
}

// ─── Floating Nav ────────────────────────────────────────────────────────────
function LandingNav() {
  const [solid, setSolid] = useState(false);
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();

  const goldBrightConcrete = resolvedTheme === 'dark' ? GOLD_BRIGHT_DARK : GOLD_BRIGHT_LIGHT;

  useEffect(() => {
    const handler = () => setSolid(window.scrollY > 60);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.8 }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 transition-all duration-300"
      style={{
        background: solid ? 'color-mix(in srgb, var(--bg) 85%, transparent)' : 'transparent',
        backdropFilter: solid ? 'blur(20px)' : 'none',
        borderBottom: solid ? `1px solid ${C.border}` : 'none',
      }}
    >
      <button
        className="flex items-center gap-2"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <img src="/logo.png" alt="AI Historian" className="h-7 w-auto" />
        <span
          className="text-[13px] tracking-[0.35em] uppercase"
          style={{ fontFamily: 'var(--font-serif)', color: C.goldBright, fontWeight: 300 }}
        >
          AI Historian
        </span>
      </button>

      <div className="flex items-center gap-4">
        <a
          href="#how-it-works"
          className="hidden sm:block text-[11px] uppercase tracking-[0.15em] transition-colors"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
        >
          How it works
        </a>
        <a
          href="https://github.com/pancodo/gemini-live-agent-challenge"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:block text-[11px] uppercase tracking-[0.15em] transition-colors"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
        >
          GitHub
        </a>
        <a
          href="/architecture.html"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:block px-4 py-1.5 rounded text-[11px] uppercase tracking-[0.12em] transition-colors"
          style={{
            fontFamily: 'var(--font-sans)',
            color: C.bg,
            background: C.gold,
            fontWeight: 500,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = goldBrightConcrete)}
          onMouseLeave={(e) => (e.currentTarget.style.background = C.gold)}
        >
          Architecture
        </a>

        {/* Theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="flex items-center justify-center w-8 h-8 rounded-full transition-colors duration-150 cursor-pointer"
          style={{
            background: 'color-mix(in srgb, var(--gold) 10%, transparent)',
            color: C.gold,
          }}
          aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {resolvedTheme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>

        <motion.button
          onClick={() => navigate('/app')}
          className="px-4 py-1.5 rounded text-[11px] uppercase tracking-[0.12em] transition-colors"
          style={{
            fontFamily: 'var(--font-sans)',
            color: C.bg,
            background: C.gold,
            fontWeight: 500,
          }}
          whileHover={{ scale: 1.03, backgroundColor: goldBrightConcrete }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
        >
          Begin
        </motion.button>
      </div>
    </motion.nav>
  );
}

// ─── Hero Section ────────────────────────────────────────────────────────────
function HeroSection() {
  const navigate = useNavigate();
  const [scrambleActive, setScrambleActive] = useState(false);
  const headline = useTextScramble('Every document has a story.', scrambleActive);
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef, offset: ['start start', 'end start'] });
  const cardY = useTransform(scrollYProgress, [0, 1], [0, 60]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const { resolvedTheme } = useTheme();

  const goldConcrete      = resolvedTheme === 'dark' ? GOLD_DARK      : GOLD_LIGHT;
  const goldBrightConcrete = resolvedTheme === 'dark' ? GOLD_BRIGHT_DARK : GOLD_BRIGHT_LIGHT;

  useEffect(() => {
    const t = setTimeout(() => setScrambleActive(true), 400);
    return () => clearTimeout(t);
  }, []);

  return (
    <section
      ref={containerRef}
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden"
      style={{ background: C.bg }}
    >
      {/* Radial spotlights — only render in dark mode (they look washed-out on parchment) */}
      {resolvedTheme === 'dark' && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 80% 50% at 50% 0%, rgba(196,149,106,0.10) 0%, transparent 65%),
              radial-gradient(ellipse 50% 40% at 85% 90%, rgba(30,94,94,0.07) 0%, transparent 55%)
            `,
          }}
        />
      )}

      {/* Slow-drifting accent blobs */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 600, height: 600, top: '-15%', left: '-10%',
          background: resolvedTheme === 'dark'
            ? 'radial-gradient(circle, rgba(139,94,26,0.06), transparent 70%)'
            : 'radial-gradient(circle, rgba(139,94,26,0.04), transparent 70%)',
          animation: 'drift 30s ease-in-out infinite alternate',
          willChange: 'transform',
        }}
      />
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 500, height: 500, bottom: '-10%', right: '-5%',
          background: resolvedTheme === 'dark'
            ? 'radial-gradient(circle, rgba(30,94,94,0.05), transparent 70%)'
            : 'radial-gradient(circle, rgba(30,94,94,0.04), transparent 70%)',
          animation: 'drift 38s ease-in-out infinite alternate-reverse',
          willChange: 'transform',
        }}
      />

      <motion.div
        style={{ opacity: heroOpacity }}
        className="relative z-10 flex flex-col items-center text-center px-6 pt-24 pb-16 max-w-4xl mx-auto"
      >
        {/* Logo */}
        <motion.img
          src="/logo.png"
          alt="AI Historian"
          className="h-20 w-auto mb-6"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.1, ease: EASE }}
        />

        {/* Label */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mb-8 flex items-center gap-3"
        >
          <span className="w-8 h-px" style={{ background: C.gold, opacity: 0.5 }} />
          <span
            className="text-[10px] uppercase tracking-[0.45em]"
            style={{ color: C.gold, fontFamily: 'var(--font-sans)', fontWeight: 500 }}
          >
            Gemini Live Agent Challenge · 2026
          </span>
          <span className="w-8 h-px" style={{ background: C.gold, opacity: 0.5 }} />
        </motion.div>

        {/* Cipher-decode headline */}
        <motion.h1
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.35 }}
          className="mb-6 leading-[1.08]"
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 300,
            fontSize: 'clamp(3rem, 7vw, 5.5rem)',
            color: C.text,
            letterSpacing: '-0.01em',
          }}
        >
          {headline}
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          initial={{ opacity: 0, y: 12, filter: 'blur(6px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 0.6, delay: 0.6, ease: EASE }}
          className="mb-10 max-w-xl mx-auto leading-relaxed"
          style={{ color: C.text2, fontFamily: 'var(--font-sans)', fontSize: 15 }}
        >
          Upload any historical document — PDF, image, or ancient manuscript.
          AI pipeline phases research, fact-check, and illustrate it in parallel while a live voice historian narrates a cinematic documentary.
        </motion.p>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.75 }}
          className="flex flex-col sm:flex-row items-center gap-4"
        >
          <motion.button
            onClick={() => navigate('/app')}
            className="group relative overflow-hidden px-7 py-3 rounded-lg text-[13px] uppercase tracking-[0.12em]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              color: C.bg,
              background: C.gold,
            }}
            whileHover={{ scale: 1.03, backgroundColor: goldBrightConcrete }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          >
            Begin Your Documentary
            <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>
          </motion.button>

          <a
            href="#how-it-works"
            className="text-[12px] uppercase tracking-[0.15em] transition-colors"
            style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          >
            Watch how it works ↓
          </a>
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.0 }}
          className="mt-14 flex items-center gap-8 flex-wrap justify-center"
        >
          {[
            { display: 'XI', label: 'AI pipeline phases' },
            { display: 'IV', label: 'AI modalities' },
            { display: 'I', label: 'Document needed' },
          ].map((stat) => (
            <div key={stat.label} className="text-center">
              <p
                className="text-[22px] leading-none mb-1"
                style={{ fontFamily: 'var(--font-serif)', color: C.goldBright, fontWeight: 300 }}
              >
                {stat.display}
              </p>
              <p
                className="text-[9px] uppercase tracking-[0.2em]"
                style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
              >
                {stat.label}
              </p>
            </div>
          ))}
        </motion.div>
      </motion.div>

      {/* Floating product mockup */}
      <motion.div
        style={{ y: cardY }}
        initial={{ opacity: 0, scale: 0.94, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 1.1, ease: EASE }}
        className="relative z-10 w-full max-w-2xl mx-auto px-6 pb-16"
      >
        <ProductPreviewCard />
      </motion.div>

      {/* Scroll hint */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.8 }}
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2"
        style={{ opacity: heroOpacity as unknown as number }}
      >
        <div
          className="w-px h-8"
          style={{
            background: `linear-gradient(to bottom, transparent, ${goldConcrete})`,
            animation: 'grain-shift 2s ease-in-out infinite alternate',
          }}
        />
      </motion.div>
    </section>
  );
}

// ─── Product preview card ─────────────────────────────────────────────────────
// Uses CSS variables so it responds to light/dark theme.

const SHOWCASE_IMAGES = [
  '/samples/showcase/beat-pompeii-01.jpg',
  '/samples/showcase/cinematic-pompeii-01.jpg',
  '/samples/showcase/beat-ancient-01.jpg',
  '/samples/showcase/frame-pompeii-01.jpg',
  '/samples/showcase/beat-pompeii-02.jpg',
  '/samples/showcase/beat-ancient-02.jpg',
];

function ProductPreviewCard() {
  const [captionIdx, setCaptionIdx] = useState(0);
  const [imageIdx, setImageIdx] = useState(0);
  const captions = [
    'In the shadow of the Hagia Sophia, a decree changed the fate of three provinces...',
    'The Grand Vizier\'s hand moved across the parchment with practiced certainty...',
    'Beneath the volcanic ash, an entire civilization waited to be rediscovered...',
  ];

  useEffect(() => {
    const t = setInterval(() => {
      setCaptionIdx((i) => (i + 1) % captions.length);
      setImageIdx((i) => (i + 1) % SHOWCASE_IMAGES.length);
    }, 3800);
    return () => clearInterval(t);
  }, []);

  return (
    <div
      className="archival-frame rounded-2xl overflow-hidden"
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        boxShadow: '0 32px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.08)',
      }}
    >
      {/* Titlebar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${C.border}`, background: C.surface2 }}
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            {['#3d2a0f', '#3d2a0f', '#2e6e44'].map((c, i) => (
              <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
            ))}
          </div>
        </div>
        <span
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        >
          Documentary Player
        </span>
        <div className="flex items-center gap-1">
          <div className="w-1 h-1 rounded-full animate-pulse" style={{ background: C.gold }} />
          <span className="text-[9px]" style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}>
            LIVE
          </span>
        </div>
      </div>

      {/* Cinematic frame with real generated images */}
      <div className="relative aspect-video overflow-hidden" style={{ background: '#0d0b09' }}>
        {SHOWCASE_IMAGES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
            style={{
              opacity: i === imageIdx ? 1 : 0,
              animation: i === imageIdx ? 'ken-burns-0 20s ease-in-out infinite alternate' : undefined,
            }}
          />
        ))}
        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 85% 85% at 50% 50%, transparent 25%, color-mix(in srgb, var(--bg) 30%, transparent) 65%, color-mix(in srgb, var(--bg) 60%, transparent) 100%)',
          }}
        />

        {/* Segment label */}
        <div className="absolute top-4 left-4">
          <span
            className="text-[9px] uppercase tracking-[0.3em] px-2 py-0.5 rounded"
            style={{
              fontFamily: 'var(--font-sans)',
              color: C.gold,
              background: C.surface2,
              border: `1px solid ${C.border}`,
            }}
          >
            Segment {imageIdx + 1} of {SHOWCASE_IMAGES.length}
          </span>
        </div>

        {/* Caption — white on dark pill for readability on any image */}
        <div className="absolute bottom-0 left-0 right-0 p-5 flex justify-center">
          <motion.p
            key={captionIdx}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5 }}
            className="text-center italic leading-relaxed rounded-lg"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 300,
              fontSize: 15,
              color: 'rgba(255,255,255,0.95)',
              background: 'rgba(0,0,0,0.65)',
              backdropFilter: 'blur(8px)',
              padding: '8px 16px',
              textShadow: '0 1px 6px rgba(0,0,0,0.7)',
            }}
          >
            {captions[captionIdx]}
          </motion.p>
        </div>
      </div>

      {/* Player controls bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderTop: `1px solid ${C.border}` }}
      >
        {/* Waveform */}
        <div className="flex items-end gap-[3px] h-4">
          {[0.4, 0.9, 0.6, 1.0, 0.7, 0.5, 0.8, 0.45, 0.95, 0.6].map((h, i) => (
            <motion.div
              key={i}
              className="w-[3px] rounded-full"
              style={{ background: C.gold }}
              animate={{ scaleY: [h, h * 0.4, h * 1.2, h] }}
              transition={{ duration: 0.8 + i * 0.07, repeat: Infinity, ease: 'easeInOut', delay: i * 0.05 }}
            />
          ))}
        </div>

        <span
          className="text-[10px] uppercase tracking-[0.15em]"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        >
          Historian is speaking
        </span>

        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--green)' }} />
          <span className="text-[9px]" style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}>
            Listening
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Trust Strip ─────────────────────────────────────────────────────────────
function TrustStrip() {
  const logos = [
    { name: 'Google Cloud', icon: '☁' },
    { name: 'Gemini 2.5', icon: '◈' },
    { name: 'Vertex AI', icon: '⬡' },
    { name: 'Document AI', icon: '⊞' },
    { name: 'Imagen 3', icon: '◎' },
    { name: 'Veo 2', icon: '▶' },
    { name: 'Firestore', icon: '⬣' },
  ];

  return (
    <div
      className="py-8 px-6"
      style={{ background: C.surface, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}
    >
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.6 }}
        variants={stagger()}
        className="max-w-4xl mx-auto flex flex-wrap items-center justify-center gap-x-8 gap-y-4"
      >
        <motion.p
          variants={fadeUp}
          className="text-[9px] uppercase tracking-[0.3em] w-full text-center mb-2"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        >
          Built with
        </motion.p>
        {logos.map((l) => (
          <motion.div
            key={l.name}
            variants={fadeUp}
            className="flex items-center gap-1.5 opacity-50 hover:opacity-80 transition-opacity"
          >
            <span style={{ color: C.gold, fontSize: 13 }}>{l.icon}</span>
            <span
              className="text-[11px] uppercase tracking-[0.1em]"
              style={{ color: C.text2, fontFamily: 'var(--font-sans)' }}
            >
              {l.name}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ─── How It Works ────────────────────────────────────────────────────────────
function HowItWorksSection() {
  const steps = [
    {
      n: '01',
      title: 'Upload',
      desc: 'Drop any historical document — PDF, scanned image, or manuscript. Supports any language including Latin, Ottoman Turkish, Ancient Greek, and hieroglyphics.',
      detail: 'Document AI OCR · Multilingual · Any format',
    },
    {
      n: '02',
      title: 'AI Researches',
      desc: 'Multiple pipeline phases fire in parallel — scene research with Google Search grounding, fact validation against sources, geographic mapping, visual storyboarding, and cinematic image generation.',
      detail: 'Multi-phase · Fact-checked · Geo-mapped · Streaming',
    },
    {
      n: '03',
      title: 'Watch & Converse',
      desc: 'A cinematic documentary streams segment by segment as each finishes. Interrupt the historian mid-sentence with your voice. Ask anything. The narrative branches and adapts in real time.',
      detail: 'Gemini Live · Real-time · Streaming delivery',
    },
  ];

  return (
    <section
      id="how-it-works"
      className="py-24 px-6"
      style={{ background: C.bg }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger()}
          className="text-center mb-16"
        >
          <motion.p
            variants={fadeUp}
            className="text-[10px] uppercase tracking-[0.35em] mb-4"
            style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
          >
            How it works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="leading-tight"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 300,
              fontSize: 'clamp(2rem, 4vw, 3.25rem)',
              color: C.text,
            }}
          >
            Document in. Documentary out.
          </motion.h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-px" style={{ background: C.border }}>
          {steps.map((step, i) => (
            <motion.div
              key={step.n}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, amount: 0.4 }}
              variants={{ ...fadeUp, visible: { ...fadeUp.visible, transition: { ...fadeUp.visible.transition, delay: i * 0.12 } } }}
              className="group p-8 relative"
              style={{ background: C.bg }}
            >
              {/* Step connector line (desktop) */}
              {i < 2 && (
                <div
                  className="hidden md:block absolute top-8 right-0 w-px h-8 translate-x-px"
                  style={{ background: `linear-gradient(to bottom, transparent, color-mix(in srgb, var(--gold) 25%, transparent), transparent)` }}
                />
              )}

              <div className="mb-6">
                <span
                  className="text-[11px] tracking-[0.3em] uppercase"
                  style={{ color: C.gold, fontFamily: 'var(--font-serif)' }}
                >
                  {step.n}
                </span>
              </div>

              <h3
                className="mb-3"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 300,
                  fontSize: 22,
                  color: C.text,
                }}
              >
                {step.title}
              </h3>

              <p
                className="mb-5 leading-relaxed"
                style={{ color: C.text2, fontFamily: 'var(--font-sans)', fontSize: 13 }}
              >
                {step.desc}
              </p>

              <p
                className="text-[10px] uppercase tracking-[0.15em]"
                style={{ color: C.gold, fontFamily: 'var(--font-sans)', opacity: 0.7 }}
              >
                {step.detail}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Live Agent Demo ─────────────────────────────────────────────────────────
type AgentState = 'queued' | 'searching' | 'evaluating' | 'done';

interface AgentCard {
  id: string;
  query: string;
  state: AgentState;
  facts: string[];
  logLines: string[];
}

const AGENT_QUERIES = [
  { id: 'a1', query: 'Ottoman trade routes in Anatolia, 1570s', facts: ['Grand Vizier Sokollu controlled northern routes', 'Edirne was secondary capital'], logLines: ['Querying Ottoman archives via Google Search', 'Cross-referencing 3 Venetian sources', '7 facts extracted, 2 verified'] },
  { id: 'a2', query: 'Topkapi Palace administrative hierarchy', facts: ['Divan met weekly under the Grand Vizier', 'Imperial council had 4 viziers'], logLines: ['Wikipedia: Topkapi Palace administration', 'Evaluating British Museum sources', '5 facts extracted, 4 verified'] },
  { id: 'a3', query: 'Siege warfare in 16th century Balkans', facts: ['Ottoman artillery decisive at Belgrade 1521', 'Fortification changed after 1526'], logLines: ['Google Search: Balkan military history', 'Cross-checking with primary sources', '9 facts extracted, 8 verified'] },
  { id: 'a4', query: 'Byzantine legacy in Ottoman Constantinople', facts: ['Hagia Sophia repurposed 1453', 'Greek scribes employed in Ottoman court'], logLines: ['Wikipedia: Byzantine Constantinople', 'Gemini multimodal: manuscript images', '6 facts extracted, 5 verified'] },
];

function AgentDemoSection() {
  const [agents, setAgents] = useState<AgentCard[]>(
    AGENT_QUERIES.map((q) => ({ ...q, state: 'queued', facts: [], logLines: [] })),
  );
  const sectionRef = useRef<HTMLDivElement>(null);
  const inView = useInView(sectionRef, { once: false, amount: 0.3 });
  const cycleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const runCycle = () => {
    setAgents(AGENT_QUERIES.map((q) => ({ ...q, state: 'queued', facts: [], logLines: [] })));

    const steps: Array<[number, () => void]> = [
      [300, () => setAgents((p) => p.map((a, i) => i === 0 ? { ...a, state: 'searching' } : a))],
      [800, () => setAgents((p) => p.map((a, i) => i === 1 ? { ...a, state: 'searching' } : a))],
      [1100, () => setAgents((p) => p.map((a, i) => i === 2 ? { ...a, state: 'searching' } : a))],
      [1400, () => setAgents((p) => p.map((a, i) => i === 3 ? { ...a, state: 'searching' } : a))],
      [1800, () => setAgents((p) => p.map((a, i) => i === 0 ? { ...a, state: 'evaluating', logLines: AGENT_QUERIES[0].logLines.slice(0, 2) } : a))],
      [2400, () => setAgents((p) => p.map((a, i) => i === 0 ? { ...a, state: 'done', facts: AGENT_QUERIES[0].facts, logLines: AGENT_QUERIES[0].logLines } : a))],
      [2600, () => setAgents((p) => p.map((a, i) => i === 1 ? { ...a, state: 'evaluating', logLines: AGENT_QUERIES[1].logLines.slice(0, 2) } : a))],
      [3200, () => setAgents((p) => p.map((a, i) => i === 2 ? { ...a, state: 'evaluating', logLines: AGENT_QUERIES[2].logLines.slice(0, 1) } : a))],
      [3400, () => setAgents((p) => p.map((a, i) => i === 1 ? { ...a, state: 'done', facts: AGENT_QUERIES[1].facts, logLines: AGENT_QUERIES[1].logLines } : a))],
      [3800, () => setAgents((p) => p.map((a, i) => i === 2 ? { ...a, state: 'done', facts: AGENT_QUERIES[2].facts, logLines: AGENT_QUERIES[2].logLines } : a))],
      [4200, () => setAgents((p) => p.map((a, i) => i === 3 ? { ...a, state: 'evaluating', logLines: AGENT_QUERIES[3].logLines.slice(0, 2) } : a))],
      [4900, () => setAgents((p) => p.map((a, i) => i === 3 ? { ...a, state: 'done', facts: AGENT_QUERIES[3].facts, logLines: AGENT_QUERIES[3].logLines } : a))],
    ];

    steps.forEach(([delay, fn]) => {
      cycleRef.current = setTimeout(fn, delay);
    });

    // Restart after all done + 2s pause
    cycleRef.current = setTimeout(() => runCycle(), 7500);
  };

  useEffect(() => {
    if (!inView) return;
    runCycle(); // eslint-disable-line react-hooks/exhaustive-deps
    return () => clearTimeout(cycleRef.current);
  }, [inView]);

  // State dot colors: use CSS variable strings (works in style.background)
  const dotColor: Record<AgentState, string> = {
    queued:     C.muted,
    searching:  '#1E5E5E',
    evaluating: C.gold,
    done:       '#2E6E44',
  };
  const stateLabel: Record<AgentState, string> = {
    queued:     'Queued',
    searching:  'Searching',
    evaluating: 'Evaluating',
    done:       'Done',
  };

  return (
    <section
      ref={sectionRef}
      className="py-24 px-6"
      style={{ background: C.surface }}
    >
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger()}
          className="text-center mb-12"
        >
          <motion.p
            variants={fadeUp}
            className="text-[10px] uppercase tracking-[0.35em] mb-4"
            style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
          >
            Live research pipeline
          </motion.p>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 300,
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              color: C.text,
            }}
          >
            Eleven phases. Parallel execution. Hundreds of verified facts.
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
          className="grid sm:grid-cols-2 gap-3"
        >
          {agents.map((agent) => (
            <motion.div
              key={agent.id}
              variants={fadeUp}
              className={`agent-card rounded-xl p-4 ${agent.state}`}
              style={{ background: C.surface2, border: `1px solid ${C.border}`, minHeight: 120 }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-500"
                    style={{
                      background: dotColor[agent.state],
                      boxShadow: agent.state === 'searching' ? `0 0 6px ${dotColor[agent.state]}` : 'none',
                      animation: agent.state === 'searching' ? 'dot-appear 1.2s ease-in-out infinite alternate' : 'none',
                    }}
                  />
                  <p
                    className="text-[12px] leading-snug truncate"
                    style={{ color: C.text2, fontFamily: 'var(--font-sans)' }}
                  >
                    {agent.query}
                  </p>
                </div>
                <span
                  className="text-[9px] uppercase tracking-[0.15em] flex-shrink-0 transition-colors duration-500"
                  style={{ color: dotColor[agent.state], fontFamily: 'var(--font-sans)' }}
                >
                  {stateLabel[agent.state]}
                </span>
              </div>

              {agent.logLines.length > 0 && (
                <div className="space-y-1 mb-3">
                  {agent.logLines.map((line, i) => (
                    <motion.p
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.15 }}
                      className="text-[10px] leading-snug"
                      style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
                    >
                      › {line}
                    </motion.p>
                  ))}
                </div>
              )}

              {agent.facts.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {agent.facts.map((fact) => (
                    <motion.span
                      key={fact}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-[9px] px-1.5 py-0.5 rounded"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        color: C.gold,
                        background: 'color-mix(in srgb, var(--gold) 8%, transparent)',
                        border: `1px solid ${C.border}`,
                      }}
                    >
                      {fact}
                    </motion.span>
                  ))}
                </div>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Feature Bento ───────────────────────────────────────────────────────────
function FeatureBentoSection() {
  const features = [
    {
      id: 'core',
      span: 'md:col-span-2 md:row-span-2',
      label: 'The transformation',
      title: 'A document becomes cinema.',
      desc: 'Upload any historical document. A multi-phase pipeline researches, fact-checks, geo-maps, storyboards, and illustrates it — streaming each segment the moment it\'s ready. A live historian narrates while you converse.',
      accent: true,
      icon: '◈',
    },
    {
      id: 'ocr',
      span: '',
      label: 'Multilingual OCR',
      title: 'Any script. Any era.',
      desc: 'Any language including dead scripts. Document AI extracts text from Ottoman, Latin, Ancient Greek, hieroglyphics.',
      icon: '⊞',
    },
    {
      id: 'voice',
      span: '',
      label: 'Live voice persona',
      title: 'Interrupt mid-sentence.',
      desc: 'Gemini 2.5 Flash Native Audio. The historian stops, answers, resumes — in real time.',
      icon: '◉',
    },
    {
      id: 'visuals',
      span: 'md:col-span-2',
      label: 'Imagen 3 + Veo 2',
      title: 'Cinematic visuals, generated.',
      desc: 'Beat-aware visual pipeline: Gemini storyboards each scene, Imagen 3 generates period-accurate frames, Veo 2 creates dramatic video clips — all with anachronism guards.',
      icon: '▣',
    },
    {
      id: 'rag',
      span: '',
      label: 'Fact validation & grounding',
      title: 'Every claim verified.',
      desc: 'A hallucination firewall cross-references every narration claim against research evidence. Google Search grounding ensures accuracy.',
      icon: '⬡',
    },
  ];

  return (
    <section className="py-24 px-6" style={{ background: C.bg }}>
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger()}
          className="text-center mb-12"
        >
          <motion.p
            variants={fadeUp}
            className="text-[10px] uppercase tracking-[0.35em] mb-4"
            style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
          >
            Capabilities
          </motion.p>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 300,
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              color: C.text,
            }}
          >
            Every modality. One coherent experience.
          </motion.h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.2 }}
          variants={{ visible: { transition: { staggerChildren: 0.07 } } }}
          className="grid grid-cols-1 md:grid-cols-3 auto-rows-fr gap-3"
        >
          {features.map((f) => (
            <motion.div key={f.id} variants={fadeUp} className={f.span}>
              <TiltCard className={`group h-full ${f.span}`}>
                <div
                  className="archival-frame h-full rounded-xl p-6 flex flex-col"
                  style={{
                    background: f.accent ? C.surface2 : C.surface,
                    border: `1px solid ${C.border}`,
                    minHeight: f.id === 'core' ? 280 : 160,
                  }}
                >
                  {f.accent && (
                    <div
                      className="absolute inset-0 rounded-xl opacity-30 pointer-events-none"
                      style={{
                        background: 'radial-gradient(ellipse 80% 60% at 30% 30%, rgba(196,149,106,0.12), transparent 70%)',
                      }}
                    />
                  )}

                  <div className="flex items-start justify-between mb-auto">
                    <p
                      className="text-[9px] uppercase tracking-[0.2em]"
                      style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
                    >
                      {f.label}
                    </p>
                    <span style={{ color: C.gold, fontSize: 16, opacity: 0.6 }}>{f.icon}</span>
                  </div>

                  <div className="mt-auto pt-6">
                    <h3
                      className="mb-2 leading-tight"
                      style={{
                        fontFamily: 'var(--font-serif)',
                        fontWeight: 300,
                        fontSize: f.accent ? 22 : 17,
                        color: C.text,
                      }}
                    >
                      {f.title}
                    </h3>
                    <p
                      className="leading-relaxed"
                      style={{
                        color: C.text2,
                        fontFamily: 'var(--font-sans)',
                        fontSize: f.accent ? 13 : 12,
                      }}
                    >
                      {f.desc}
                    </p>
                  </div>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

// ─── Before / After ──────────────────────────────────────────────────────────
function BeforeAfterSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitPos, setSplitPos] = useState(50); // percentage 0-100
  const isDragging = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    setSplitPos(Math.max(5, Math.min(95, x)));
  }, []);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <section className="py-24 px-6" style={{ background: C.surface }}>
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, amount: 0.3 }}
          variants={stagger()}
          className="text-center mb-12"
        >
          <motion.p
            variants={fadeUp}
            className="text-[10px] uppercase tracking-[0.35em] mb-4"
            style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
          >
            The transformation
          </motion.p>
          <motion.h2
            variants={fadeUp}
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 300,
              fontSize: 'clamp(1.75rem, 3.5vw, 2.75rem)',
              color: C.text,
            }}
          >
            Raw document. Cinematic documentary.
          </motion.h2>
        </motion.div>

        {/* Drag-to-compare slider */}
        <div
          ref={containerRef}
          className="relative rounded-2xl overflow-hidden aspect-video select-none"
          style={{ border: `1px solid ${C.border}`, cursor: 'col-resize' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* BEFORE — PDF document (full width, always visible) */}
          <div className="absolute inset-0">
            <img
              src="/samples/showcase/pdf-pompeii-page1.jpg"
              alt="Original PDF document"
              className="w-full h-full object-cover"
            />
          </div>

          {/* AFTER — documentary frame (clipped by slider position) */}
          <div
            className="absolute inset-0"
            style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}
          >
            <img
              src="/samples/showcase/cinematic-pompeii-02.jpg"
              alt="AI-generated documentary frame"
              className="absolute inset-0 w-full h-full object-cover"
              style={{ animation: 'ken-burns-1 25s ease-in-out infinite alternate' }}
            />
            {/* Vignette */}
            <div
              className="absolute inset-0"
              style={{
                background: 'radial-gradient(ellipse 85% 85% at 50% 50%, transparent 25%, rgba(13,11,9,0.4) 60%, rgba(13,11,9,0.85) 100%)',
              }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-8 px-8">
              <p
                className="text-center italic mb-3 rounded-lg"
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 300,
                  fontSize: 'clamp(13px, 2vw, 16px)',
                  color: 'rgba(255,255,255,0.95)',
                  background: 'rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(6px)',
                  padding: '6px 14px',
                  textShadow: '0 1px 8px rgba(0,0,0,0.7)',
                }}
              >
                Beneath the volcanic ash, an entire civilization waited to be rediscovered...
              </p>
              <div className="flex items-center gap-4">
                <div
                  className="text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 rounded"
                  style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(13,11,9,0.6)', border: '1px solid rgba(255,255,255,0.15)', fontFamily: 'var(--font-sans)' }}
                >
                  Segment 1 · 42s
                </div>
                <div className="flex items-end gap-[2px] h-3">
                  {[0.5, 0.8, 0.6, 1, 0.7].map((h, i) => (
                    <motion.div
                      key={i}
                      className="w-[3px] rounded-full"
                      style={{ background: 'rgba(255,255,255,0.7)' }}
                      animate={{ scaleY: [h, h * 0.3, h] }}
                      transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.08 }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Draggable divider */}
          <div
            className="absolute inset-y-0 z-10"
            style={{ left: `${splitPos}%`, width: 3, transform: 'translateX(-50%)' }}
          >
            {/* Line */}
            <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.8)', boxShadow: '0 0 8px rgba(0,0,0,0.5)' }} />
            {/* Handle */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
                cursor: 'col-resize',
              }}
              onPointerDown={handlePointerDown}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#333" strokeWidth="1.5" strokeLinecap="round">
                <path d="M5 3L2 8L5 13" />
                <path d="M11 3L14 8L11 13" />
              </svg>
            </div>
          </div>

          {/* Labels */}
          <div className="absolute top-4 left-4 z-10">
            <span
              className="text-[9px] uppercase tracking-[0.2em] px-2 py-1 rounded"
              style={{ color: '#3d2a10', background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(4px)', fontFamily: 'var(--font-sans)' }}
            >
              Before
            </span>
          </div>
          <div className="absolute top-4 right-4 z-10">
            <span
              className="text-[9px] uppercase tracking-[0.2em] px-2 py-1 rounded"
              style={{ color: 'rgba(255,255,255,0.9)', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', fontFamily: 'var(--font-sans)' }}
            >
              After
            </span>
          </div>
        </div>

        <p
          className="text-center mt-4 text-[11px]"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        >
          Drag the slider to compare
        </p>
      </div>
    </section>
  );
}

// ─── Stats Row ───────────────────────────────────────────────────────────────
function StatsSection() {
  const stats = [
    { display: 'XI', label: 'AI pipeline phases' },
    { display: 'IV', label: 'Output modalities' },
    { display: 'IV×', label: 'Imagen frames per segment' },
  ];

  return (
    <section
      className="py-20 px-6"
      style={{ background: C.bg, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}
    >
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.5 }}
        variants={{ visible: { transition: { staggerChildren: 0.1 } } }}
        className="max-w-3xl mx-auto flex flex-wrap justify-center gap-12"
      >
        {stats.map((s) => (
          <motion.div key={s.label} variants={fadeUp} className="text-center">
            <p
              className="text-[2.5rem] leading-none mb-2"
              style={{ fontFamily: 'var(--font-serif)', fontWeight: 300, color: C.goldBright }}
            >
              {s.display}
            </p>
            <p
              className="text-[10px] uppercase tracking-[0.18em]"
              style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
            >
              {s.label}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

// ─── Footer CTA ──────────────────────────────────────────────────────────────
function FooterCTA() {
  const navigate = useNavigate();

  return (
    <section
      className="py-28 px-6 text-center"
      style={{
        background: `
          radial-gradient(ellipse 70% 60% at 50% 0%, color-mix(in srgb, var(--gold) 8%, transparent) 0%, transparent 60%),
          var(--bg2)
        `,
        borderTop: `1px solid ${C.border}`,
      }}
    >
      <motion.div
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.4 }}
        variants={stagger(0.05)}
        className="max-w-2xl mx-auto"
      >
        <motion.p
          variants={fadeUp}
          className="text-[10px] uppercase tracking-[0.35em] mb-6"
          style={{ color: C.gold, fontFamily: 'var(--font-sans)' }}
        >
          Begin your documentary
        </motion.p>

        <motion.h2
          variants={fadeUp}
          className="mb-5 leading-[1.1]"
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 300,
            fontSize: 'clamp(2rem, 5vw, 3.5rem)',
            color: C.text,
          }}
        >
          Ready to see history come alive?
        </motion.h2>

        <WordReveal
          text="No signup required. Upload any historical document and watch eleven AI phases research, fact-check, and illustrate it — a cinematic voice documentary streams as each segment completes."
          className="mb-10 leading-relaxed max-w-lg mx-auto text-[13px]"
        />

        <FooterCTAButtons navigate={navigate} />

        <motion.p
          variants={fadeUp}
          className="text-[10px] uppercase tracking-[0.2em] mb-1"
          style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        >
          No signup · Any language · Streaming documentary
        </motion.p>

        {/* Divider */}
        <motion.div variants={fadeUp} className="my-10 flex items-center gap-4">
          <div className="flex-1 h-px" style={{ background: C.border }} />
          <span style={{ color: C.gold, opacity: 0.4, fontSize: 10 }}>◆</span>
          <div className="flex-1 h-px" style={{ background: C.border }} />
        </motion.div>

        {/* Footer links */}
        <motion.div
          variants={fadeUp}
          className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2"
        >
          <span
            className="text-[10px] uppercase tracking-[0.15em]"
            style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
          >
            Built for Gemini Live Agent Challenge 2026
          </span>
          <span style={{ color: C.border }}>·</span>
          <a
            href="https://github.com/pancodo/gemini-live-agent-challenge"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.15em] transition-colors"
            style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          >
            GitHub
          </a>
          <span style={{ color: C.border }}>·</span>
          <a
            href="https://geminiliveagentchallenge.devpost.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.15em] transition-colors"
            style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
            onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          >
            Devpost
          </a>
          <span style={{ color: C.border }}>·</span>
          <span
            className="text-[10px] uppercase tracking-[0.15em]"
            style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
          >
            Berkay &amp; Efe
          </span>
        </motion.div>
      </motion.div>
    </section>
  );
}

// Extracted to avoid calling useTheme inside FooterCTA's render tree alongside
// motion variants — keeps hooks at consistent call sites.
function FooterCTAButtons({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const { resolvedTheme } = useTheme();
  const goldBrightConcrete = resolvedTheme === 'dark' ? GOLD_BRIGHT_DARK : GOLD_BRIGHT_LIGHT;

  return (
    <motion.div
      variants={fadeUp}
      className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-10"
    >
      <motion.button
        onClick={() => navigate('/app')}
        className="group px-8 py-3.5 rounded-lg text-[13px] uppercase tracking-[0.12em]"
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 500,
          color: C.bg,
          background: C.gold,
        }}
        whileHover={{ scale: 1.03, backgroundColor: goldBrightConcrete }}
        whileTap={{ scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      >
        Upload a Document
        <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">→</span>
      </motion.button>

      <a
        href="https://github.com/pancodo/gemini-live-agent-challenge"
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12px] uppercase tracking-[0.15em] transition-colors"
        style={{ color: C.muted, fontFamily: 'var(--font-sans)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = C.text2)}
        onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
      >
        View on GitHub ↗
      </a>
    </motion.div>
  );
}

// ─── Landing Page ────────────────────────────────────────────────────────────
export function LandingPage() {
  return (
    <div style={{ background: C.bg, minHeight: '100vh' }}>
      <LandingNav />
      <HeroSection />
      <TrustStrip />
      <HowItWorksSection />
      <AgentDemoSection />
      <FeatureBentoSection />
      <BeforeAfterSection />
      <StatsSection />
      <FooterCTA />
    </div>
  );
}
