/**
 * downloadImage — fetches an image URL as a blob and triggers a browser
 * download. Falls back to a direct anchor-click if the fetch fails (e.g.
 * CORS-restricted GCS URL where the Content-Disposition header is not set).
 */
export async function downloadImage(
  url: string,
  filename = 'image.jpg',
): Promise<void> {
  try {
    const response = await fetch(url);
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
    // Fallback: direct link — browser will open in new tab; some servers
    // send Content-Disposition: attachment which triggers a download anyway.
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
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
