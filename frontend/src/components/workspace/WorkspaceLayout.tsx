import { useCallback, useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { PDFViewer } from './PDFViewer';
import type { PDFViewerHandle } from './PDFViewerContext';
import { PDFViewerProvider } from './PDFViewerContext';

interface WorkspaceLayoutProps {
  children: ReactNode;
}

export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'workspace-layout',
    storage: localStorage,
  });

  const [pdfHandle, setPdfHandle] = useState<PDFViewerHandle | null>(null);

  const onHandleReady = useCallback((handle: PDFViewerHandle) => {
    setPdfHandle(handle);
  }, []);

  return (
    <PDFViewerProvider value={pdfHandle}>
      <div className="h-[calc(100vh-44px)] bg-[var(--bg)] overflow-hidden">
        <Group
          orientation="horizontal"
          defaultLayout={defaultLayout ?? { pdf: 52, research: 48 }}
          onLayoutChanged={onLayoutChanged}
          className="h-full"
        >
          {/* Left panel: PDF viewer */}
          <Panel id="pdf" minSize="28%">
            <aside className="h-full overflow-hidden flex flex-col">
              <PDFViewer onHandleReady={onHandleReady} />
            </aside>
          </Panel>

          <Separator className="w-[5px] bg-[var(--color-bg4)] hover:bg-[var(--color-gold)]/40 transition-colors cursor-col-resize" />

          {/* Right panel: Research/Historian content */}
          <Panel id="research" minSize="24%">
            <main className="h-full overflow-y-auto flex flex-col min-w-0">
              {children}
            </main>
          </Panel>
        </Group>
      </div>
    </PDFViewerProvider>
  );
}
