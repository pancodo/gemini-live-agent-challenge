import { createSession } from './api';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

function getAccessHeaders(): Record<string, string> {
  const code = localStorage.getItem('ai-historian-access');
  return code ? { 'X-Access-Code': code } : {};
}

export async function uploadDocument(
  file: File,
  language?: string,
  persona?: string,
  onProgress?: (pct: number) => void,
  mode?: string,
  label?: string,
): Promise<{ sessionId: string; gcsPath: string }> {
  const docLabel = label || file.name.replace(/\.pdf$/i, '').replace(/^sample-/, '').replace(/-/g, ' ');
  const { sessionId, uploadUrl, gcsPath } = await createSession(file.name, language, persona, mode, docLabel);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });

  // Trigger the agent pipeline
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAccessHeaders() },
    body: JSON.stringify({ gcsPath, mode: mode || 'normal' }),
  });
  if (!res.ok) throw new Error(`Pipeline trigger failed: ${res.status}`);

  return { sessionId, gcsPath };
}
