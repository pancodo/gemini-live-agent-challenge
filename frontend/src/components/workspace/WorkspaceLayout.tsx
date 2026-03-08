import type { ReactNode } from 'react';
import { PDFViewer } from './PDFViewer';

interface WorkspaceLayoutProps {
  children: ReactNode;
}

export function WorkspaceLayout({ children }: WorkspaceLayoutProps) {
  return (
    <div className="flex h-[calc(100vh-44px)] bg-[var(--bg)] overflow-hidden">
      {/* Left panel: PDF viewer (45%) */}
      <aside className="w-[45%] border-r border-[var(--bg4)] overflow-hidden flex flex-col">
        <PDFViewer />
      </aside>

      {/* Right panel: Research/Historian content (55%) */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        {children}
      </main>
    </div>
  );
}
