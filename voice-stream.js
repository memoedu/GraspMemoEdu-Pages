import {recordMicrophone} from './microphone-recorder.js?v=0ce6a54ba2b5b0b6';

function wave(frames, size) {
  const header = new ArrayBuffer(44), view = new DataView(header);
  const label = (offset, word) => [...word].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  label(0, 'RIFF'); view.setUint32(4, 36 + size, true); label(8, 'WAVE'); label(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); label(36, 'data'); view.setUint32(40, size, true);
  return new Blob([header, ...frames], {type: 'audio/wav'});
}

function encoded(frames) {
  let bytes = '';
  for (const frame of frames) bytes += String.fromCharCode(...new Uint8Array(frame));
  return btoa(bytes);
}

export async function streamMicrophone({request, profile, context, signal, maxDurationMs, sameIdentity, onPreview}) {
  const fallback = media => recordMicrophone({signal, media, wholeRecording: true});
  if (!globalThis.AudioWorkletNode || !globalThis.AudioContext || !crypto.randomUUID) {
    return fallback();
  }
  const media = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, latency: {ideal: .02}}});
  let audio, node, source, finishTimer;
  const releaseGraph = () => {
    source?.disconnect();
    node?.disconnect();
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  };
  const release = () => {
    clearTimeout(finishTimer);
    media.getTracks().forEach(track => track.stop());
    releaseGraph();
  };
  let setupTimer;
  try {
    signal.throwIfAborted();
    // A capture graph needs a clock, not a speaker. Avoid the output device's playout buffer.
    const options = {sampleRate: 16000, latencyHint: 'interactive'};
    if ('setSinkId' in AudioContext.prototype) {
      try { audio = new AudioContext({...options, sinkId: {type: 'none'}}); }
      catch { /* Browsers with restricted output selection can still capture the input. */ }
    }
    audio ||= new AudioContext(options);
    if (audio.sampleRate !== 16000) throw Error('Unsupported microphone sample rate');
    await Promise.race([
      audio.audioWorklet.addModule(new URL('./voice-pcm.js?v=0ce6a54ba2b5b0b6', import.meta.url)).then(() => audio.resume()),
      new Promise((_, reject) => {
        setupTimer = setTimeout(() => reject(Error('Microphone audio graph did not start')), 1200);
      }),
    ]);
    signal.throwIfAborted();
    node = new AudioWorkletNode(audio, 'voice-pcm', {channelCount: 1, channelCountMode: 'explicit',
      processorOptions: {samples: onPreview ? 800 : 1600}});
    source = audio.createMediaStreamSource(media);
  } catch (error) {
    if (signal.aborted || !globalThis.MediaRecorder) { release(); throw error; }
    releaseGraph();
    return fallback(media);
  } finally {
    clearTimeout(setupTimer);
  }
  try {
    const take = crypto.randomUUID();
    const send = body => {
      if (!sameIdentity()) throw DOMException('Account changed', 'AbortError');
      return request({take, ...body});
    };
    let resolveRecording, rejectRecording, resolveTranscript;
    const result = new Promise((resolve, reject) => { resolveRecording = resolve; rejectRecording = reject; });
    const transcript = new Promise(resolve => { resolveTranscript = resolve; });
    let ready = false, sending = false, failed = false, retired = false, captureDone = false;
    let state = 'recording', offset = 0, size = 0;
    const capacity = Math.min(120000, maxDurationMs) * 32;
    const captured = [], queue = [];
    const cancelTake = () => {
      if (ready && !retired && sameIdentity()) {
        retired = true;
        void send({op: 'cancel'}).catch(() => {});
      }
    };
    function failure(error) {
      failed = true; queue.length = 0;
      resolveTranscript({error});
      cancelTake();
    }
    async function pump() {
      if (!ready || sending || failed || signal.aborted) return;
      sending = true;
      try {
        while (queue.length && !signal.aborted) {
          const frames = [];
          let size = 0, op = 'audio';
          while (queue.length) {
            const item = queue[0];
            if (typeof item === 'string') { op = queue.shift(); break; }
            if (size + item.byteLength > 64000) break;
            frames.push(queue.shift()); size += item.byteLength;
          }
          const reply = await send({op, offset, pcm: encoded(frames)});
          if (reply.offset !== offset + size) throw Error('录音片段未完整接收。');
          offset = reply.offset;
          if (!signal.aborted && sameIdentity() && typeof reply.preview === 'string') onPreview?.(reply.preview);
          if (op === 'finish') {
            retired = true;
            resolveTranscript({reply});
          }
        }
      } catch (error) { failure(error); }
      finally { sending = false; }
    }
    function endCapture() {
      if (captureDone) return;
      captureDone = true; state = 'finishing'; release();
      if (signal.aborted) rejectRecording(signal.reason);
      else if (!size) { failure(Error('Recording is empty')); rejectRecording(Error('Recording is empty')); }
      else resolveRecording(wave(captured, size));
    }
    const stop = () => {
      if (state === 'finishing' || captureDone) return;
      state = 'finishing';
      node.port.postMessage('finish');
      // A suspended graph on a phone might never acknowledge stop.
      finishTimer = setTimeout(() => {
        if (!failed) queue.push('finish');
        endCapture();
        void pump();
      }, 500);
    };
    function abort() {
      failure(signal.reason); endCapture();
    }
    node.onprocessorerror = () => {
      const error = Error('录音设备中断，请重新录音。');
      failure(error); rejectRecording(error); endCapture();
    };
    node.port.onmessage = ({data}) => {
      if (captureDone || signal.aborted) return;
      if (data instanceof ArrayBuffer) {
        const left = capacity - size;
        if (data.byteLength > left) data = data.slice(0, left);
        if (data.byteLength) { captured.push(data); size += data.byteLength; if (!failed) queue.push(data); }
        if (size >= capacity) stop();
      } else if (data !== 'resume') {
        if (!failed) queue.push(data);
        if (data === 'finish') endCapture();
      }
      // Include the last partial worklet frame in finish instead of starting another round trip.
      if (state !== 'finishing' || captureDone) void pump();
    };
    signal.addEventListener('abort', abort, {once: true});
    media.getAudioTracks().forEach(track => track.addEventListener('ended', stop, {once: true}));
    transcript.then(() => { if (captureDone) signal.removeEventListener('abort', abort); });
    source.connect(node); node.connect(audio.destination);
    void send({op: 'open', profile, context, ...(onPreview && {live: true})}).then(() => {
      ready = true;
      if (signal.aborted || failed) cancelTake(); else void pump();
    }).catch(failure);
    return {result, transcript, stop, pause() {
      if (state !== 'recording') return;
      state = 'paused'; node.port.postMessage('pause');
    }, resume() {
      if (state !== 'paused') return;
      state = 'recording'; node.port.postMessage('resume');
    }};
  } catch (error) {
    release();
    throw error;
  }
}
