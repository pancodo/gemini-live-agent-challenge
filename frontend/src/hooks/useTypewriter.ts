/**
 * Imperative typewriter animation for DOM elements.
 *
 * Inserts characters one-by-one with a blinking cursor span (.tw-cursor).
 * Speed has +-50% jitter per character for an organic feel.
 */
export function typewriteEntry(el: HTMLElement, text: string, speed = 20): void {
  let i = 0;
  el.textContent = '';

  const cursor = document.createElement('span');
  cursor.className = 'tw-cursor';
  el.appendChild(cursor);

  function tick(): void {
    if (i < text.length) {
      el.insertBefore(document.createTextNode(text[i]!), cursor);
      i++;
      const jitter = speed + Math.random() * speed * 0.5;
      setTimeout(tick, jitter);
    } else {
      cursor.remove();
    }
  }

  tick();
}
