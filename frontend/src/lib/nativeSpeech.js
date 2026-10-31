import { Capacitor, registerPlugin } from '@capacitor/core';

// Native plugin implemented in frontend/android/.../NativeSpeechPlugin.java.
// It uses Android's on-device SpeechRecognizer because webkitSpeechRecognition
// is not exposed inside the Capacitor WebView.
const NativeSpeech = registerPlugin('NativeSpeech');

export function hasNativeSpeech() {
  return Capacitor.isNativePlatform();
}

export async function nativeSpeechAvailable() {
  if (!hasNativeSpeech()) return false;
  try {
    const result = await NativeSpeech.available();
    return !!result?.available;
  } catch {
    return false;
  }
}

export async function ensureMicPermission() {
  if (!hasNativeSpeech()) return true;
  try {
    const current = await NativeSpeech.checkPermissions();
    if (current?.microphone === 'granted') return true;
    const asked = await NativeSpeech.requestPermissions();
    return asked?.microphone === 'granted';
  } catch {
    return false;
  }
}

/**
 * Start one native recognition session. Returns a handle with stop()/cancel().
 * Callbacks keep the same shape as the Web Speech API so AvatarPage can share
 * its microphone state machine.
 */
export async function startNativeRecognition({ language = 'en-IN', onResult, onPartial, onError, onEnd }) {
  const listeners = [];
  const removeListeners = () => {
    listeners.splice(0).forEach((listener) => {
      try { listener.remove(); } catch { /* already removed */ }
    });
  };

  listeners.push(await NativeSpeech.addListener('result', (event) => {
    const text = String(event?.text || '').trim();
    if (text) onResult?.(text);
  }));
  listeners.push(await NativeSpeech.addListener('partial', (event) => {
    const text = String(event?.text || '').trim();
    if (text) onPartial?.(text);
  }));
  listeners.push(await NativeSpeech.addListener('error', (event) => {
    onError?.(String(event?.error || 'speech-error'));
  }));
  listeners.push(await NativeSpeech.addListener('end', () => {
    // Always detach this session's listeners, otherwise every retry leaks four
    // listeners and a stale session can deliver a duplicate transcript.
    removeListeners();
    onEnd?.();
  }));

  try {
    await NativeSpeech.start({ language, partialResults: false });
  } catch (error) {
    removeListeners();
    throw error;
  }

  return {
    stop: async () => {
      try { await NativeSpeech.stop(); } catch { /* noop */ }
      removeListeners();
    },
    cancel: async () => {
      try { await NativeSpeech.cancel(); } catch { /* noop */ }
      removeListeners();
    },
  };
}
