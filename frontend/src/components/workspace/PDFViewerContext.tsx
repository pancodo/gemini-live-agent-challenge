import { createContext, useContext } from 'react';

export interface PDFViewerHandle {
  scrollToEntity: (text: string) => void;
}

const PDFViewerContext = createContext<PDFViewerHandle | null>(null);

export const PDFViewerProvider = PDFViewerContext.Provider;

export function usePDFViewer(): PDFViewerHandle | null {
  return useContext(PDFViewerContext);
}
