import { useEffect } from 'react';
import { useVoiceStore } from '../store/voiceStore';

/**
 * Drives Live2D model lip sync from an AnalyserNode's frequency data.
 *
 * Hooks into pixi-live2d-display's `beforeModelUpdate` event so the
 * mouth parameter is written at exactly the right point in the update
 * pipeline — after motions/physics/blink but before the Cubism renderer
 * reads parameter values.
 *
 * Eye blink and breathing are handled by the library's built-in systems
 * (EyeBlink group + CubismBreath in model3.json).
 */

interface UseLipSyncOptions {
  /** Live2D model instance from useLive2DModel */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any | null;
  /** AnalyserNode from audio playback — null when not playing */
  analyserNode: AnalyserNode | null;
}

export function useLipSync({ model, analyserNode }: UseLipSyncOptions): void {
  useEffect(() => {
    if (!model) return;

    const internalModel = model.internalModel;
    if (!internalModel) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const coreModel = internalModel.coreModel as any;
    const rawModel = coreModel?._model;
    if (!rawModel?.parameters) return;

    // Pre-resolve mouth parameter index
    const params = rawModel.parameters;
    let mouthIdx = -1;
    for (let i = 0; i < params.count; i++) {
      const id = params.ids[i];
      if (id === 'PARAM_MOUTH_OPEN_Y' || id === 'ParamMouthOpenY') {
        mouthIdx = i;
        break;
      }
    }

    if (mouthIdx < 0) return;

    // Reusable frequency data buffer
    let freqData: Uint8Array | null = null;

    // Hook into the model's update pipeline — fires after motions/physics/blink
    // but before the Cubism renderer reads parameter values (perfect timing).
    const onBeforeModelUpdate = () => {
      const currentAnalyser = analyserNode ?? useVoiceStore.getState().analyserNode;

      let energy = 0;
      if (currentAnalyser) {
        if (!freqData || freqData.length !== currentAnalyser.frequencyBinCount) {
          freqData = new Uint8Array(currentAnalyser.frequencyBinCount);
        }
        currentAnalyser.getByteFrequencyData(freqData as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) {
          sum += freqData[i];
        }
        energy = sum / (freqData.length * 255);
      }

      params.values[mouthIdx] = Math.min(1, energy * 2.5);
    };

    internalModel.on('beforeModelUpdate', onBeforeModelUpdate);

    return () => {
      internalModel.off('beforeModelUpdate', onBeforeModelUpdate);
      params.values[mouthIdx] = 0;
    };
  }, [model, analyserNode]);
}
