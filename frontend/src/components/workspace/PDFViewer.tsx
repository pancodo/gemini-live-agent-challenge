import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSessionStore } from '../../store/sessionStore';
import { Button } from '../ui';
import { Spinner } from '../ui';

// Configure PDF.js worker via CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.25;

export function PDFViewer() {
  const documentUrl = useSessionStore((s) => s.documentUrl);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, { cancel: () => void }>>(new Map());

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
      setError(
        err instanceof Error ? err.message : 'Failed to load PDF document'
      );
    } finally {
      setLoading(false);
    }
  }, [documentUrl]);

  useEffect(() => {
    loadPdf();
  }, [loadPdf]);

  // Render all pages when pdf or zoom changes
  useEffect(() => {
    if (!pdf) return;

    const dpr = window.devicePixelRatio || 1;

    async function renderPage(pageNum: number) {
      const page = await pdf!.getPage(pageNum);
      const canvas = canvasRefs.current.get(pageNum);
      if (!canvas) return;

      // Cancel any ongoing render for this page
      const existing = renderTasksRef.current.get(pageNum);
      if (existing) existing.cancel();

      const viewport = page.getViewport({ scale: zoom * dpr });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const renderTask = page.render({ canvas, canvasContext: ctx, viewport });
      renderTasksRef.current.set(pageNum, renderTask);

      try {
        await renderTask.promise;
      } catch {
        // Render cancelled or failed — ignore
      }
    }

    for (let i = 1; i <= pdf.numPages; i++) {
      renderPage(i);
    }
  }, [pdf, zoom]);

  // Track current page via scroll position
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
      if (el) {
        canvasRefs.current.set(pageNum, el);
      } else {
        canvasRefs.current.delete(pageNum);
      }
    },
    []
  );

  // Loading state
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-3"
        aria-busy="true"
      >
        <Spinner size="lg" />
        <p className="text-[12px] text-[var(--muted)] font-sans uppercase tracking-[0.15em]">
          Loading document...
        </p>
      </div>
    );
  }

  // Error state
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

  // No document state
  if (!pdf) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-[var(--muted)] font-sans">
          No document loaded
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--bg4)] bg-[var(--bg2)] shrink-0">
        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
          >
            -
          </Button>
          <span className="text-[11px] text-[var(--muted)] font-sans tabular-nums min-w-[3.5rem] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
          >
            +
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom(1.0)}
            aria-label="Reset zoom"
          >
            Reset
          </Button>
        </div>

        {/* Page counter */}
        <span className="text-[11px] text-[var(--muted)] font-sans">
          Page {currentPage} of {numPages}
        </span>
      </div>

      {/* Pages container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-4 bg-[var(--bg3)]/30"
        onScroll={handleScroll}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
          <div
            key={pageNum}
            data-page={pageNum}
            className="shadow-sm rounded bg-white"
          >
            <canvas
              ref={setCanvasRef(pageNum)}
              className="block"
            />
            {/* TODO: Add text layer overlay for entity highlighting when scan_agent completes */}
          </div>
        ))}
      </div>
    </div>
  );
}
