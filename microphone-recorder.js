// Browser recording shared with DecisionWorkbench. The caller owns transport and UI.
export const microphoneIcon = 'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8';
const formats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/ogg;codecs=opus'];

export async function recordMicrophone({prepare, maxDurationMs, signal, media, wholeRecording = false} = {}) {
  const stream = media || await navigator.mediaDevices.getUserMedia({audio: true});
  const release = () => stream.getTracks().forEach(track => track.stop());
  try {
    signal?.throwIfAborted();
    await prepare?.();
    signal?.throwIfAborted();
    const supported = wholeRecording ? [formats[1], formats[0], formats[2]] : formats;
    const mimeType = supported.find(type => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
    const chunks = [];
    let timer, startedAt, remaining = maxDurationMs;
    const stop = () => { if (recorder.state !== 'inactive') recorder.stop(); };
    const startTimer = () => {
      if (remaining == null) return;
      startedAt = performance.now();
      timer = setTimeout(stop, Math.max(0, remaining));
    };
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      release();
    };
    const result = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', event => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', event => {
        finish();
        reject(event.error || Error('Recording failed'));
      }, {once: true});
      recorder.addEventListener('stop', () => {
        finish();
        const blob = new Blob(chunks, {type: chunks[0]?.type || recorder.mimeType || mimeType});
        if (signal?.aborted) reject(signal.reason);
        else if (blob.size) resolve(blob);
        else reject(Error('Recording is empty'));
      }, {once: true});
    });
    // Safari may deliver only the final chunk. The voice textbox needs one
    // complete container, while other consumers retain periodic collection.
    if (wholeRecording) recorder.start();
    else recorder.start(1000);
    signal?.addEventListener('abort', stop, {once: true});
    startTimer();
    return {result, stop, pause() {
      if (recorder.state !== 'recording') return;
      recorder.pause();
      if (remaining != null) remaining -= performance.now() - startedAt;
      clearTimeout(timer);
    }, resume() {
      if (recorder.state !== 'paused') return;
      recorder.resume();
      startTimer();
    }};
  } catch (error) {
    release();
    throw error;
  }
}

export function recordingMime(blob) {
  return blob.type.split(';', 1)[0];
}

export async function recordingDigest(blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}
