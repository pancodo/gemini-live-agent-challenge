import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { useSessionStore } from '../../store/sessionStore';
import { useResearchStore } from '../../store/researchStore';
import { usePDFHighlights } from '../../hooks/usePDFHighlights';
import { Button, Spinner } from '../ui';
import type { PDFViewerHandle } from './PDFViewerContext';
import type { EntityHighlight } from '../../types';

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
 * Highlight entity terms in the PDF text layer using the CSS Custom Highlight API.
 * This avoids DOM mutations, so highlights survive pdf.js text layer re-renders
 * and don't interfere with text selection or accessibility.
 *
 * Falls back to DOM-mutation highlighting for browsers without CSS.highlights.
 */
function highlightEntities(container: HTMLDivElement, entities: string[]): void {
  // CSS Custom Highlight API — no DOM mutation
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete('entity-matches');
    if (entities.length === 0) return;

    const escaped = entities
      .filter((e) => e.trim().length > 0)
      .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

    if (escaped.length === 0) return;

    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const text = node.textContent ?? '';
      let m: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((m = pattern.exec(text)) !== null) {
        const r = new Range();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + m[0].length);
        ranges.push(r);
      }
    }

    if (ranges.length > 0) {
      CSS.highlights.set('entity-matches', new Highlight(...ranges));
    }
    return;
  }

  // Fallback: DOM mutation for older browsers
  applyEntityHighlightsFallback(container, entities);
}

/**
 * Legacy fallback: walk the text layer DOM and wrap entity terms with <mark>
 * elements. Used only when CSS Custom Highlight API is unavailable.
 */
function applyEntityHighlightsFallback(container: HTMLDivElement, entities: string[]): void {
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

// ── Narration-Synchronized Highlighting ─────────────────────────

/**
 * Highlight entities from the active narration segment on their respective
 * PDF pages. Uses the CSS Custom Highlight API with a distinct highlight
 * name ('narration-entity') so narration highlights coexist with scan
 * entity highlights. Falls back to DOM <mark> elements with a pulsing
 * gold animation for browsers without CSS.highlights.
 */
function highlightNarrationEntities(
  textLayerRefs: Map<number, HTMLDivElement>,
  highlights: EntityHighlight[],
): void {
  // CSS Custom Highlight API path
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete('narration-entity');
    if (highlights.length === 0) return;

    const ranges: Range[] = [];

    for (const hl of highlights) {
      const textLayerDiv = textLayerRefs.get(hl.pageNumber + 1); // pages are 1-indexed in refs
      if (!textLayerDiv) continue;

      const textLower = hl.text.toLowerCase();
      const walker = document.createTreeWalker(textLayerDiv, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const content = node.textContent ?? '';
        const idx = content.toLowerCase().indexOf(textLower);
        if (idx < 0) continue;

        const r = new Range();
        r.setStart(node, idx);
        r.setEnd(node, idx + hl.text.length);
        ranges.push(r);
        break; // one match per entity per page
      }
    }

    if (ranges.length > 0) {
      CSS.highlights.set('narration-entity', new Highlight(...ranges));
    }
    return;
  }

  // Fallback: DOM mutation with <mark> elements
  // First, remove previous narration marks
  textLayerRefs.forEach((div) => {
    const marks = div.querySelectorAll('mark.narration-highlight');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark);
        parent.normalize();
      }
    });
  });

  if (highlights.length === 0) return;

  for (const hl of highlights) {
    const textLayerDiv = textLayerRefs.get(hl.pageNumber + 1);
    if (!textLayerDiv) continue;

    const textLower = hl.text.toLowerCase();
    const spans = textLayerDiv.querySelectorAll('span');

    for (const span of spans) {
      const textNode = span.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

      const content = textNode.textContent ?? '';
      const idx = content.toLowerCase().indexOf(textLower);
      if (idx < 0) continue;

      const before = content.slice(0, idx);
      const match = content.slice(idx, idx + hl.text.length);
      const after = content.slice(idx + hl.text.length);

      const fragment = document.createDocumentFragment();
      if (before) fragment.appendChild(document.createTextNode(before));

      const mark = document.createElement('mark');
      mark.className = 'narration-highlight';
      mark.textContent = match;
      fragment.appendChild(mark);

      if (after) fragment.appendChild(document.createTextNode(after));
      span.replaceChildren(fragment);
      break; // one match per entity
    }
  }
}

// ── Component ────────────────────────────────────────────────────

interface PDFViewerProps {
  onHandleReady?: (handle: PDFViewerHandle) => void;
}

export function PDFViewer({ onHandleReady }: PDFViewerProps) {
  const documentUrl = useSessionStore((s) => s.documentUrl);
  const scanEntities = useResearchStore((s) => s.scanEntities);
  const narrationHighlights = usePDFHighlights();

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  // Base zoom offset so the PDF fills the panel better at "100%".
  // The UI displays (zoom - ZOOM_BASE_OFFSET) so the user sees "100%".
  const ZOOM_BASE_OFFSET = 0.25;
  const [zoom, setZoom] = useState(1.0 + ZOOM_BASE_OFFSET);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());
  const highlightedPagesRef = useRef<Set<number>>(new Set());

  // ── scrollToEntity: find text in rendered pages and scroll + pulse ──
  const scrollToEntity = useCallback((text: string) => {
    const container = containerRef.current;
    if (!container) return;

    const textLower = text.toLowerCase();

    // Search through all text layer divs in page order
    const sortedPages = Array.from(textLayerRefs.current.entries()).sort(
      ([a], [b]) => a - b,
    );

    for (const [, textLayerDiv] of sortedPages) {
      const walker = document.createTreeWalker(textLayerDiv, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const content = node.textContent ?? '';
        const idx = content.toLowerCase().indexOf(textLower);
        if (idx < 0) continue;

        // Found a match — scroll into view
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + text.length);
        const rect = range.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        container.scrollTop += rect.top - containerRect.top - containerRect.height / 2;

        // Create a temporary pulse highlight span
        const span = document.createElement('span');
        span.className = 'entity-highlight entity-pulse';
        try {
          range.surroundContents(span);
        } catch {
          // surroundContents can throw if range crosses element boundaries
          break;
        }

        // Remove the pulse span after animation completes
        const cleanup = setTimeout(() => {
          const parent = span.parentNode;
          if (parent) {
            parent.replaceChild(
              document.createTextNode(span.textContent ?? ''),
              span,
            );
            parent.normalize();
          }
        }, 1600);

        // Store timeout ref for cleanup if component unmounts
        return () => clearTimeout(cleanup);
      }
    }
  }, []);

  // Expose the handle to parent
  const handle: PDFViewerHandle = useMemo(
    () => ({ scrollToEntity }),
    [scrollToEntity],
  );

  useEffect(() => {
    onHandleReady?.(handle);
  }, [handle, onHandleReady]);

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
          highlightEntities(textLayerDiv, scanEntities);
          highlightedPagesRef.current.add(pageNum);
        }
      }
    },
    [zoom, scanEntities],
  );

  // Re-render all pages on pdf/zoom/renderPage changes
  useEffect(() => {
    if (!pdf) return;
    // Render at slightly higher resolution than display for crisper text.
    // Native PDF viewers use their own high-res engines; pdfjs needs help.
    const rawDpr = window.devicePixelRatio || 1;
    const dpr = rawDpr < 1.5 ? rawDpr * 1.5 : rawDpr;

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
        highlightEntities(div, scanEntities);
        highlightedPagesRef.current.add(pageNum);
      }
    });
  }, [scanEntities]);

  // Apply narration-synchronized entity highlights when active segment changes
  useEffect(() => {
    highlightNarrationEntities(textLayerRefs.current, narrationHighlights);
  }, [narrationHighlights]);

  // Track current page and reading progress via scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const scrollTop = container.scrollTop;
    const scrollableHeight = container.scrollHeight - container.clientHeight;
    const children = container.querySelectorAll('[data-page]');

    // Reading progress
    const progress = scrollableHeight > 0
      ? (scrollTop / scrollableHeight) * 100
      : 0;
    setScrollProgress(Math.min(100, Math.max(0, progress)));

    // Current page detection
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
        {/* Reading progress bar */}
        <div className="h-[2px] bg-[var(--bg4)] shrink-0" role="progressbar" aria-valuenow={Math.round(scrollProgress)} aria-valuemin={0} aria-valuemax={100} aria-label="Reading progress">
          <div
            className="h-full bg-[var(--gold)] transition-[width] duration-200 ease-out"
            style={{ width: `${scrollProgress}%` }}
          />
        </div>

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
              onClick={() => setZoom(1.0 + ZOOM_BASE_OFFSET)}
              aria-label="Reset zoom"
              className="px-2.5 py-1.5 text-[11px] font-sans tabular-nums text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)] transition-colors border-r border-[var(--bg4)] min-w-[3.5rem] text-center"
            >
              {Math.round((zoom - ZOOM_BASE_OFFSET) * 100)}%
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

export type { PDFViewerHandle };
