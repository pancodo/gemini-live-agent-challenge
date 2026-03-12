/**
 * downloadImage — fetches an image URL as a blob and triggers a browser
 * download. For GCS URLs, routes through a backend proxy to avoid
 * cross-origin issues where `a.download` is silently ignored.
 * Falls back to opening in a new tab if everything fails.
 */

const BACKEND_BASE = import.meta.env.VITE_API_URL ?? '';

function isGcsUrl(url: string): boolean {
  return (
    url.startsWith('https://storage.googleapis.com/') ||
    url.startsWith('https://storage.cloud.google.com/')
  );
}

export async function downloadImage(
  url: string,
  filename = 'image.jpg',
): Promise<void> {
  // For GCS URLs, route through backend proxy to avoid cross-origin download issues
  const downloadUrl = isGcsUrl(url)
    ? `${BACKEND_BASE}/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`
    : url;

  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Last resort fallback: open in new tab
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * downloadVideo — downloads a video URL as a blob, using the same
 * proxy logic as downloadImage for GCS URLs.
 */
export async function downloadVideo(
  url: string,
  filename = 'video.mp4',
): Promise<void> {
  return downloadImage(url, filename);
}

/**
 * downloadImages — downloads every URL in the array sequentially with a
 * configurable delay between each to avoid overwhelming the browser's
 * download manager and GCS rate limits.
 */
export async function downloadImages(
  urls: string[],
  filenamePrefix = 'image',
  delayMs = 500,
): Promise<void> {
  for (let i = 0; i < urls.length; i++) {
    const padded = String(i + 1).padStart(2, '0');
    await downloadImage(urls[i], `${filenamePrefix}-${padded}.jpg`);
    if (i < urls.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
