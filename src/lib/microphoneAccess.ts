const MICROPHONE_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export async function requestMicrophoneAccess() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Microphone access is unavailable in this browser context. Open the app in a regular HTTPS browser tab and try again.',
    );
  }

  return navigator.mediaDevices.getUserMedia(MICROPHONE_CONSTRAINTS);
}

export function releaseMicrophoneStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function classifyMicrophoneAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');

  if (/NotAllowedError|Permission denied|user agent or the platform in the current context/i.test(message)) {
    return 'Browser blocked microphone access. Allow the microphone for this site, then try again.';
  }

  if (/NotFoundError|no audio/i.test(message)) {
    return 'No microphone was found on this device.';
  }

  if (/NotReadableError|TrackStartError|device in use/i.test(message)) {
    return 'Your microphone is busy in another app or browser tab. Close it there and try again.';
  }

  return message;
}