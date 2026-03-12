import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Lazily loads PixiJS + Cubism Core + pixi-live2d-display and creates a
 * Live2D model inside a container element.
 *
 * Loading sequence (all deferred until `enabled` becomes true):
 *  1. Inject Cubism Core runtime script (~200KB JS)
 *  2. Dynamic import('pixi.js') (~500KB)
 *  3. Dynamic import('pixi-live2d-display/cubism4')
 *  4. Create PixiJS Application + load .moc3 model
 *
 * Initial bundle cost: 0 bytes.
 */

interface UseLive2DModelOptions {
  /** Path to model3.json (relative to public/) */
  modelPath: string;
  /** Container element ref to mount the PixiJS canvas into */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Canvas width in CSS pixels */
  width: number;
  /** Canvas height in CSS pixels */
  height: number;
  /** Whether to start loading the model */
  enabled: boolean;
}

interface UseLive2DModelReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any | null;
  isLoaded: boolean;
  error: string | null;
}

/** Loads the Cubism Core script once, caches the promise for subsequent calls */
let cubismCorePromise: Promise<void> | null = null;
function loadCubismCore(): Promise<void> {
  if (cubismCorePromise) return cubismCorePromise;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).Live2DCubismCore) {
    cubismCorePromise = Promise.resolve();
    return cubismCorePromise;
  }

  cubismCorePromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/models/live2dcubismcore.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Cubism Core runtime'));
    document.head.appendChild(script);
  });

  return cubismCorePromise;
}

export function useLive2DModel({
  modelPath,
  containerRef,
  width,
  height,
  enabled,
}: UseLive2DModelOptions): UseLive2DModelReturn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [model, setModel] = useState<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const appRef = useRef<any>(null);
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (appRef.current) {
      try {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
      } catch {
        // already destroyed
      }
      appRef.current = null;
    }
    setModel(null);
    setIsLoaded(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled || !containerRef.current) return;

    let destroyed = false;

    async function init() {
      try {
        // 1. Load Cubism Core runtime (must be on window before importing pixi-live2d-display)
        await loadCubismCore();
        if (destroyed || !mountedRef.current) return;

        // 2. Lazy-load PixiJS
        const PIXI = await import('pixi.js');
        if (destroyed || !mountedRef.current) return;

        // 3. Lazy-load pixi-live2d-display (Cubism 4 only — smaller bundle)
        const { Live2DModel } = await import('pixi-live2d-display/cubism4');
        if (destroyed || !mountedRef.current) return;

        // pixi-live2d-display needs PIXI on window for its internals
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).PIXI = PIXI;

        // Register the PixiJS Ticker for Live2D model updates
        Live2DModel.registerTicker(PIXI.Ticker);

        const container = containerRef.current;
        if (!container) return;

        // Create PixiJS application with transparent background
        const app = new PIXI.Application({
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
        });

        if (destroyed) {
          app.destroy(true);
          return;
        }

        appRef.current = app;
        container.appendChild(app.view as HTMLCanvasElement);

        // Load the Live2D model
        const live2dModel = await Live2DModel.from(modelPath, {
          autoInteract: false,
          autoUpdate: true,
        });

        if (destroyed || !mountedRef.current) {
          app.destroy(true, { children: true, texture: true, baseTexture: true });
          appRef.current = null;
          return;
        }

        // Model is 2400x4500. We want to zoom into the face (top ~20%).
        // Scale 3x wider than canvas so face fills the circle, then
        // offset up+left to center the head in the visible area.
        live2dModel.scale.set(1);
        const trueW = live2dModel.width;  // 2400
        const trueH = live2dModel.height; // 4500

        // Zoom: show head+shoulders for small, more body for large (player)
        const zoom = width <= 200 ? 2.2 : 1.5;
        const s = (width / trueW) * zoom;
        live2dModel.scale.set(s);

        // Center head+shoulders in the visible area
        const scaledW = trueW * s;
        const scaledH = trueH * s;
        live2dModel.x = (width - scaledW) / 2;
        live2dModel.y = width <= 200 ? -(scaledH * 0.03) : -(scaledH * 0.05);

        app.stage.addChild(live2dModel);

        if (mountedRef.current && !destroyed) {
          setModel(live2dModel);
          setIsLoaded(true);
        }
      } catch (err) {
        if (mountedRef.current && !destroyed) {
          const message = err instanceof Error ? err.message : 'Failed to load Live2D model';
          setError(message);
          console.warn('[useLive2DModel] Load error:', message);
        }
      }
    }

    void init();

    return () => {
      destroyed = true;
      mountedRef.current = false;
      cleanup();
    };
  }, [enabled, modelPath, width, height, containerRef, cleanup]);

  // Handle resize
  useEffect(() => {
    if (!appRef.current || !model) return;
    appRef.current.renderer.resize(width, height);
    // Resize repositioning handled by remount
  }, [width, height, model]);

  return { model, isLoaded, error };
}
