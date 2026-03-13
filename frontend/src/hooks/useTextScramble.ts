import { useState, useEffect, useRef, startTransition } from 'react';

// Ancient Greek + Cyrillic glyphs for the cipher effect
const CIPHER_CHARS =
  '\u0391\u0392\u0393\u0394\u0395\u0396\u0397\u0398\u0399\u039A' +
  '\u039B\u039C\u039D\u039E\u039F\u03A0\u03A1\u03A3\u03A4\u03A5' +
  '\u03A6\u03A7\u03A8\u03A9\u03B1\u03B2\u03B3\u03B4\u03B5\u03B6' +
  '\u03B7\u03B8\u0410\u0411\u0412\u0413\u0414\u0416\u0417\u0418';

/**
 * Imperative scramble-to animation.
 * Drives text from random cipher glyphs → target string over `duration` ms.
 * Caller supplies an `onUpdate` callback that receives each intermediate frame.
 */
export function scrambleTo(
  target: string,
  onUpdate: (text: string) => void,
  duration = 600,
): void {
  const start = performance.now();

  function frame(now: number): void {
    const progress = Math.min((now - start) / duration, 1);
    const resolvedCount = Math.floor(progress * target.length);

    let result = '';
    for (let i = 0; i < target.length; i++) {
      if (i < resolvedCount) {
        result += target[i];
      } else if (target[i] === ' ') {
        result += ' ';
      } else {
        result += CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
      }
    }

    onUpdate(result);
    if (progress < 1) requestAnimationFrame(frame);
    else onUpdate(target); // guarantee exact final text
  }

  requestAnimationFrame(frame);
}

/**
 * React hook that returns a display string which starts as random cipher
 * glyphs and decodes into `finalText` over 600ms. Activates when
 * `active` becomes true (e.g. on segment status → 'ready' transition).
 */
export function useTextScramble(finalText: string, active: boolean): string {
  const [display, setDisplay] = useState(finalText);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!active || !finalText) {
      setDisplay(finalText);
      return;
    }

    const duration = 600;
    startRef.current = performance.now();

    function step(now: number): void {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const resolvedCount = Math.floor(progress * finalText.length);

      let result = '';
      for (let i = 0; i < finalText.length; i++) {
        if (i < resolvedCount) {
          result += finalText[i];
        } else if (finalText[i] === ' ') {
          result += ' ';
        } else {
          result += CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
        }
      }

      if (progress < 1) {
        startTransition(() => setDisplay(result));
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(finalText);
      }
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [finalText, active]);

  return display;
}
