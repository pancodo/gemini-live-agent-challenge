import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useSessionStore } from '../../store/sessionStore';
import { useResearchStore } from '../../store/researchStore';
import { Button, Spinner } from '../ui';

// Serve worker from the local pdfjs-dist package (CDN may not have this version yet)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.25;

// ── Entity Highlighting ──────────────────────────────────────────

/**
 * Walk the text layer DOM and wrap any text node that contains an entity term
 * with a <mark> element carrying the `entity-highlight` class.
 * Runs after pdf.js has rendered text layer spans.
 */
function applyEntityHighlights(container: HTMLDivElement, entities: string[]): void {
  if (entities.length === 0) return;

  const escaped = entities
    .filter((e) => e.trim().length > 0)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (escaped.length === 0) return;

  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const spans = container.querySelectorAll('span');
  spans.forEach((span) => {
    const textNode = span.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent ?? '';
    pattern.lastIndex = 0;
    if (!pattern.test(text)) return;

    pattern.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const mark = document.createElement('mark');
      mark.className = 'entity-highlight';
      mark.textContent = match[0];
      fragment.appendChild(mark);
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    span.replaceChildren(fragment);
  });
}

// ── Component ────────────────────────────────────────────────────

export function PDFViewer() {
  const documentUrl = useSessionStore((s) => s.documentUrl);
  const scanEntities = useResearchStore((s) => s.scanEntities);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
  const highlightedPagesRef = useRef<Set<number>>(new Set());

  // Load PDF document
  const loadPdf = useCallback(async () => {
    if (!documentUrl) return;

    setLoading(true);
    setError(null);

    try {
      const doc = await pdfjsLib.getDocument(documentUrl).promise;
      setPdf(doc);
      setNumPages(doc.numPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PDF document');
    } finally {
      setLoading(false);
    }
  }, [documentUrl]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf]);

  // Render a single page: canvas layer + text layer
  const renderPage = useCallback(
    async (pageNum: number, page: PDFPageProxy, dpr: number) => {
      const canvas = canvasRefs.current.get(pageNum);
      const textLayerDiv = textLayerRefs.current.get(pageNum);
      if (!canvas) return;

      const existing = renderTasksRef.current.get(pageNum);
      if (existing) existing.cancel();

      const viewport = page.getViewport({ scale: zoom * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const cssWidth = `${viewport.width / dpr}px`;
      const cssHeight = `${viewport.height / dpr}px`;
      canvas.style.width = cssWidth;
      canvas.style.height = cssHeight;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderTask = page.render({ canvas, canvasContext: ctx, viewport });
      renderTasksRef.current.set(pageNum, renderTask);

      try {
        await renderTask.promise;
      } catch {
        return; // Cancelled or failed
      }

      // Text layer overlay
      if (textLayerDiv) {
        textLayerDiv.style.width = cssWidth;
        textLayerDiv.style.height = cssHeight;
        textLayerDiv.replaceChildren();
        highlightedPagesRef.current.delete(pageNum);

        const textContent = await page.getTextContent();

        // pdf.js 4.x+ TextLayer API
        const TextLayerCtor = (pdfjsLib as unknown as {
          TextLayer: new (opts: {
            container: HTMLDivElement;
            viewport: unknown;
            textContentSource: unknown;
          }) => { render: () => Promise<void> };
        }).TextLayer;
        if (TextLayerCtor) {
          const textLayer = new TextLayerCtor({
            container: textLayerDiv,
            viewport,
            textContentSource: textContent,
          });
          await textLayer.render();
        }

        if (scanEntities.length > 0) {
          applyEntityHighlights(textLayerDiv, scanEntities);
          highlightedPagesRef.current.add(pageNum);
        }
      }
    },
    [zoom, scanEntities],
  );

  // Re-render all pages on pdf/zoom/renderPage changes
  useEffect(() => {
    if (!pdf) return;
    const dpr = window.devicePixelRatio || 1;

    async function renderAll() {
      for (let i = 1; i <= pdf!.numPages; i++) {
        const page = await pdf!.getPage(i);
        renderPage(i, page, dpr);
      }
    }

    renderAll();
  }, [pdf, zoom, renderPage]);

  // Apply highlights to already-rendered text layers when entities arrive
  useEffect(() => {
    if (scanEntities.length === 0) return;
    textLayerRefs.current.forEach((div, pageNum) => {
      if (!highlightedPagesRef.current.has(pageNum) && div.childElementCount > 0) {
        applyEntityHighlights(div, scanEntities);
        highlightedPagesRef.current.add(pageNum);
      }
    });
  }, [scanEntities]);

  // Track current page via scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const children = container.querySelectorAll('[data-page]');

    let closest = 1;
    let closestDistance = Infinity;

    children.forEach((child) => {
      const el = child as HTMLElement;
      const pageNum = parseInt(el.dataset.page ?? '1', 10);
      const distance = Math.abs(el.offsetTop - scrollTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = pageNum;
      }
    });

    setCurrentPage(closest);
  }, []);

  const setCanvasRef = useCallback(
    (pageNum: number) => (el: HTMLCanvasElement | null) => {
      if (el) canvasRefs.current.set(pageNum, el);
      else canvasRefs.current.delete(pageNum);
    },
    [],
  );

  const setTextLayerRef = useCallback(
    (pageNum: number) => (el: HTMLDivElement | null) => {
      if (el) textLayerRefs.current.set(pageNum, el);
      else {
        textLayerRefs.current.delete(pageNum);
        highlightedPagesRef.current.delete(pageNum);
      }
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" aria-busy="true">
        <Spinner size="lg" />
        <p className="text-[12px] text-[var(--muted)] font-sans uppercase tracking-[0.15em]">
          Loading document...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <p className="text-[14px] text-red-600 font-sans text-center">{error}</p>
        <Button variant="secondary" size="sm" onClick={loadPdf}>
          Retry
        </Button>
      </div>
    );
  }

  if (!pdf) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-[var(--muted)] font-sans">No document loaded</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--bg4)] bg-[var(--bg2)] shrink-0 gap-3">
        {/* Zoom control group */}
        <div className="flex items-center gap-0 rounded border border-[var(--bg4)] bg-[var(--bg)] overflow-hidden shrink-0">
          <button
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className="px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors border-r border-[var(--bg4)]"
          >
            −
          </button>
          <button
            onClick={() => setZoom(1.0)}
            aria-label="Reset zoom"
            className="px-2.5 py-1.5 text-[11px] font-sans tabular-nums text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)] transition-colors border-r border-[var(--bg4)] min-w-[3.5rem] text-center"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className="px-2.5 py-1.5 text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            +
          </button>
        </div>

        {/* Right side: entities + page counter */}
        <div className="flex items-center gap-3 min-w-0">
          {scanEntities.length > 0 && (
            <span className="text-[10px] text-[var(--gold)] font-sans uppercase tracking-[0.15em] shrink-0">
              {scanEntities.length} entities
            </span>
          )}
          <span className="text-[11px] text-[var(--muted)] font-sans tabular-nums shrink-0">
            {currentPage} / {numPages}
          </span>
        </div>
      </div>

      {/* Pages container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-5 flex flex-col items-center gap-5 bg-[var(--bg3)]/40"
        onScroll={handleScroll}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <div
            key={pageNum}
            data-page={pageNum}
            className="relative bg-white rounded-sm"
            style={{ boxShadow: '0 2px 12px rgba(30,23,12,0.12), 0 1px 3px rgba(30,23,12,0.08)' }}
          >
            <canvas
              ref={setCanvasRef(pageNum)}
              className="block"
            />
            {/* Text layer overlay for entity highlighting */}
            <div
              ref={setTextLayerRef(pageNum)}
              className="pdf-text-layer absolute top-0 left-0 overflow-hidden select-text pointer-events-none"
              aria-hidden="true"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
