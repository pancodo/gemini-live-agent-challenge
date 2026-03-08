import { DropZone } from '../components/upload';

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
    </main>
  );
}
