import {recordMicrophone} from './microphone-recorder.js?v=6a7af7ba0045af91';

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

export async function streamMicrophone({request, profile, context, signal, maxDurationMs, sameIdentity}) {
  if (!globalThis.AudioWorkletNode || !globalThis.AudioContext || !crypto.randomUUID) {
    return recordMicrophone({signal, maxDurationMs});
  }
  const media = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1}});
  let audio, node, timer;
  const release = () => {
    clearTimeout(timer);
    media.getTracks().forEach(track => track.stop());
    node?.disconnect();
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  };
  try {
    signal.throwIfAborted();
    audio = new AudioContext({sampleRate: 16000});
    if (audio.sampleRate !== 16000) throw Error('Unsupported microphone sample rate');
    await audio.audioWorklet.addModule(new URL('./voice-pcm.js?v=6a7af7ba0045af91', import.meta.url));
    await audio.resume();
    signal.throwIfAborted();
    node = new AudioWorkletNode(audio, 'voice-pcm', {channelCount: 1, channelCountMode: 'explicit'});
    const source = audio.createMediaStreamSource(media);
    const take = crypto.randomUUID();
    const send = body => {
      if (!sameIdentity()) throw DOMException('Account changed', 'AbortError');
      return request({take, ...body});
    };
    let resolveRecording, rejectRecording, resolveTranscript;
    const result = new Promise((resolve, reject) => { resolveRecording = resolve; rejectRecording = reject; });
    const transcript = new Promise(resolve => { resolveTranscript = resolve; });
    let ready = false, sending = false, failed = false, retired = false, captureDone = false;
    let state = 'recording', offset = 0, size = 0, started = performance.now(), remaining = maxDurationMs;
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
      captureDone = true; release();
      if (signal.aborted) rejectRecording(signal.reason);
      else resolveRecording(wave(captured, size));
    }
    const stop = () => {
      if (state === 'finishing' || captureDone) return;
      state = 'finishing'; clearTimeout(timer);
      node.port.postMessage('finish');
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
        const left = 120 * 32000 - size;
        if (data.byteLength > left) data = data.slice(0, left);
        if (data.byteLength) { captured.push(data); size += data.byteLength; if (!failed) queue.push(data); }
        if (size >= 120 * 32000) stop();
      } else if (data !== 'resume') {
        if (!failed) queue.push(data);
        if (data === 'finish') endCapture();
      }
      // Include the last partial worklet frame in finish instead of starting another round trip.
      if (state !== 'finishing' || captureDone) void pump();
    };
    signal.addEventListener('abort', abort, {once: true});
    transcript.then(() => { if (captureDone) signal.removeEventListener('abort', abort); });
    source.connect(node); node.connect(audio.destination);
    timer = setTimeout(stop, remaining);
    void send({op: 'open', profile, context}).then(() => {
      ready = true;
      if (signal.aborted || failed) cancelTake(); else void pump();
    }).catch(failure);
    return {result, transcript, stop, pause() {
      if (state !== 'recording') return;
      state = 'paused'; remaining -= performance.now() - started;
      clearTimeout(timer); node.port.postMessage('pause');
    }, resume() {
      if (state !== 'paused') return;
      state = 'recording'; started = performance.now();
      timer = setTimeout(stop, Math.max(0, remaining)); node.port.postMessage('resume');
    }};
  } catch (error) {
    release();
    throw error;
  }
}
