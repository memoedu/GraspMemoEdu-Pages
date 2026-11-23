import {recordMicrophone} from './microphone-recorder.js?v=3f4192d65a1ad037';

function wave(frames, size) {
  if (!size) return null;
  const header = new ArrayBuffer(44), view = new DataView(header);
  const label = (offset, word) => [...word].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + size, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, size, true);
  return new Blob([header, ...frames], {type: 'audio/wav'});
}

async function containerSegments(media, signal, release) {
  // MediaRecorder timeslices are dependent on their container header. Open the
  // next recorder on the same track before closing the previous container.
  const open = async () => {
    const recorder = await recordMicrophone({signal, media, wholeRecording: true, keepStream: true});
    const result = recorder.result.catch(error => {
      if (error.message === 'Recording is empty') return null;
      throw error;
    });
    void result.catch(() => {});
    return {...recorder, result};
  };
  let current = await open(), paused = false, finishing = false;
  let boundary = Promise.resolve();
  let resolve, reject;
  const result = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  function stop() {
    if (finishing) return;
    finishing = true;
    void boundary.then(async () => {
      current.stop();
      return current.result;
    }).then(resolve, reject).finally(release);
  }
  signal.addEventListener('abort', stop, {once: true});
  media.getAudioTracks().forEach(track => track.addEventListener('ended', stop, {once: true}));
  return {
    result, stop,
    cut() {
      if (finishing) return Promise.resolve(null);
      const captured = boundary.then(async () => {
        signal.throwIfAborted();
        const previous = current;
        current = await open();
        if (paused) current.pause();
        previous.stop();
        return previous;
      });
      boundary = captured.then(() => {}, () => {});
      return captured.then(previous => previous.result);
    },
    pause() { paused = true; current.pause(); },
    resume() { paused = false; current.resume(); },
  };
}

export async function segmentMicrophone({signal, maxDurationMs}) {
  const media = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, latency: {ideal: .02}}});
  const release = () => media.getTracks().forEach(track => track.stop());
  let audio, node, source, setupTimer;
  function releaseGraph() {
    source?.disconnect();
    node?.disconnect();
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  }
  try {
    signal.throwIfAborted();
    if (!globalThis.AudioWorkletNode || !globalThis.AudioContext) throw Error('AudioWorklet unavailable');
    const options = {sampleRate: 16000, latencyHint: 'interactive'};
    if ('setSinkId' in AudioContext.prototype) {
      try { audio = new AudioContext({...options, sinkId: {type: 'none'}}); }
      catch { /* Restricted output selection can still capture the microphone. */ }
    }
    audio ||= new AudioContext(options);
    if (audio.sampleRate !== 16000) throw Error('Unsupported microphone sample rate');
    await Promise.race([
      audio.audioWorklet.addModule(new URL('./voice-pcm.js?v=3f4192d65a1ad037', import.meta.url)).then(() => audio.resume()),
      new Promise((_, reject) => {
        setupTimer = setTimeout(() => reject(Error('Microphone audio graph did not start')), 1200);
      }),
    ]);
    signal.throwIfAborted();
    node = new AudioWorkletNode(audio, 'voice-pcm', {channelCount: 1, channelCountMode: 'explicit'});
    source = audio.createMediaStreamSource(media);
    source.connect(node); node.connect(audio.destination);
  } catch (error) {
    releaseGraph();
    if (!signal.aborted && globalThis.MediaRecorder) {
      try { return await containerSegments(media, signal, release); }
      catch (fallbackError) { release(); throw fallbackError; }
    }
    release(); throw error;
  } finally {
    clearTimeout(setupTimer);
  }

  let resolve, reject;
  const result = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  let frames = [], size = 0, total = 0, finishTimer, finishing = false, closed = false;
  const cuts = [], capacity = maxDurationMs * 32;
  function seal() {
    const blob = wave(frames, size);
    frames = []; size = 0;
    return blob;
  }
  function close(error) {
    if (closed) return;
    closed = true;
    clearTimeout(finishTimer);
    signal.removeEventListener('abort', abort);
    release(); releaseGraph();
    while (cuts.length) {
      const cut = cuts.shift();
      if (error) cut.reject(error);
      else cut.resolve(seal());
    }
    if (error) reject(error);
    else resolve(seal());
  }
  function abort() { close(signal.reason); }
  function stop() {
    if (finishing || closed) return;
    finishing = true;
    node.port.postMessage('finish');
    // Backgrounded mobile audio graphs can stop delivering messages.
    finishTimer = setTimeout(close, 500);
  }
  node.onprocessorerror = () => close(Error('录音设备中断，请重新录音。'));
  node.port.onmessage = ({data}) => {
    if (closed) return;
    if (data instanceof ArrayBuffer) {
      const length = Math.min(data.byteLength, capacity - total);
      if (length > 0) {
        frames.push(length === data.byteLength ? data : data.slice(0, length));
        size += length; total += length;
      }
      if (total >= capacity) stop();
    } else if (data === 'cut') {
      cuts.shift()?.resolve(seal());
    } else if (data === 'finish') close();
  };
  signal.addEventListener('abort', abort, {once: true});
  media.getAudioTracks().forEach(track => track.addEventListener('ended', stop, {once: true}));
  return {
    result, stop,
    cut() {
      if (finishing || closed) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        cuts.push({resolve, reject});
        node.port.postMessage('cut');
      });
    },
    pause() { if (!finishing && !closed) node.port.postMessage('pause'); },
    resume() { if (!finishing && !closed) node.port.postMessage('resume'); },
  };
}
