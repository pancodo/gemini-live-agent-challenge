import { createSession } from './api';

export async function uploadDocument(
  file: File,
  language?: string,
  onProgress?: (pct: number) => void
): Promise<{ sessionId: string; gcsPath: string }> {
  const { sessionId, uploadUrl, gcsPath } = await createSession(file.name, language);

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

  return { sessionId, gcsPath };
}
