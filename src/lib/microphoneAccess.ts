const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

/**
 * Request microphone access with Safari/iOS-specific handling.
 * On iOS Safari, getUserMedia must be called from a user gesture context.
 * If called outside a gesture (e.g. from a timer or async callback),
 * it will throw NotAllowedError.
 */
export async function requestMicrophoneAccess(): Promise<MediaStream> {
  if (!window.isSecureContext) {
    throw new Error(
      'Microphone requires a secure context (HTTPS). Open the app in a regular HTTPS browser tab.',
    );
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Microphone API not available in this browser. Try Chrome, Safari, or Firefox.',
    );
  }

  try {
    return await navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
  } catch (err) {
    // Re-throw with a more specific message for Safari's audio context issues
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // Check if this is a gesture-context issue (common on iOS Safari)
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (isSafari) {
        throw new Error(
          'Safari blocked microphone access. Tap the mic button directly to start Dave — voice activation may not work on Safari.',
        );
      }
    }
    throw err;
  }
}

export function releaseMicrophoneStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function classifyMicrophoneAccessError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  if (/NotAllowedError|Permission denied|user agent or the platform in the current context/i.test(message)) {
    return 'Microphone access blocked. Allow microphone for this site in your browser settings, then try again.';
  }

  if (/NotFoundError|no audio/i.test(message)) {
    return 'No microphone found on this device.';
  }

  if (/NotReadableError|TrackStartError|device in use/i.test(message)) {
    return 'Microphone is in use by another app or tab. Close it there and try again.';
  }

  if (/AbortError|aborted/i.test(message)) {
    return 'Microphone request was cancelled. Please try again.';
  }

  if (/OverconstrainedError/i.test(message)) {
    return 'Microphone does not support the requested audio settings. Try a different device.';
  }

  // Pass through specific messages (from requestMicrophoneAccess above)
  if (/Safari blocked|secure context|Microphone API/i.test(message)) {
    return message;
  }

  return `Microphone error: ${message}`;
}