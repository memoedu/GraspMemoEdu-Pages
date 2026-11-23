import {recordMicrophone} from './microphone-recorder.js?v=a3cb9e57123710a9';

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

function recognizeSegments(request, signal) {
  const take = crypto.randomUUID();
  const send = async body => request({take, ...body});
  const queue = [];
  let offset = 0, part = 0, opened = false, busy = false, retired = false;
  let cancellation;

  function retire() {
    if (retired) return cancellation;
    retired = true;
    signal.removeEventListener('abort', retire);
    cancellation = opened ? send({op: 'cancel'}).catch(() => {}) : Promise.resolve();
    for (const item of queue.splice(0)) {
      if (item.done) void cancellation.then(() => item.done());
    }
    return cancellation;
  }

  async function pump() {
    if (!opened || busy || retired) return;
    busy = true;
    let marker;
    try {
      while (queue.length && !retired) {
        let data = '', size = 0;
        marker = null;
        while (queue.length) {
          const item = queue[0];
          if (item.op) { marker = queue.shift(); break; }
          if (item.byteLength + size > 64000) break;
          size += item.byteLength;
          data += String.fromCharCode(...new Uint8Array(queue.shift()));
        }
        const op = marker?.op || 'audio';
        const boundary = op === 'cut' || op === 'finish';
        const answer = await send({op, offset, pcm: btoa(data), ...(boundary && {part})});
        if (answer.offset !== offset + size || boundary && typeof answer.text !== 'string') {
          throw Error('Invalid transcription response');
        }
        offset = answer.offset;
        if (boundary) { part++; marker.done(retired ? undefined : answer.text); }
        if (op === 'finish') {
          opened = false;
          retire();
        }
      }
    } catch {
      await retire();
      marker?.done?.();
    } finally {
      busy = false;
    }
  }

  signal.addEventListener('abort', retire, {once: true});
  void send({op: 'open', manual: true}).then(answer => {
    opened = true;
    if (retired) { void send({op: 'cancel'}).catch(() => {}); return; }
    if (answer.offset !== 0) { retire(); return; }
    void pump();
  }).catch(retire);
  return {
    audio(frame) { if (!retired) { queue.push(frame); void pump(); } },
    mark(op) {
      if (retired) return Promise.resolve(cancellation).then(() => undefined);
      return new Promise(done => { queue.push({op, done}); void pump(); });
    },
    retire,
  };
}

async function containerSegments(media, signal, release) {
  // MediaRecorder timeslices are dependent on their container header. Open the
  // next recorder on the same track before closing the previous container.
  const open = async () => {
    const recorder = await recordMicrophone({signal, media, wholeRecording: true, keepStream: true});
    const result = recorder.result.then(blob => ({blob})).catch(error => {
      if (error.message === 'Recording is empty') return {blob:null};
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
      if (finishing) return Promise.resolve({blob:null});
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

export async function segmentMicrophone({signal, maxDurationMs, request}) {
  let audio, node, source, setupTimer;
  function releaseGraph() {
    source?.disconnect();
    node?.disconnect();
    if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
  }
  async function prepareGraph() {
    if (!globalThis.AudioWorkletNode || !globalThis.AudioContext) throw Error('AudioWorklet unavailable');
    const options = {sampleRate: 16000, latencyHint: 'interactive'};
    if ('setSinkId' in AudioContext.prototype) {
      try { audio = new AudioContext({...options, sinkId: {type: 'none'}}); }
      catch { /* Restricted output selection can still capture the microphone. */ }
    }
    audio ||= new AudioContext(options);
    if (audio.sampleRate !== 16000) throw Error('Unsupported microphone sample rate');
    // Start both while the click still carries user activation, alongside the permission request.
    await Promise.all([audio.resume(), audio.audioWorklet.addModule(new URL('./voice-pcm.js?v=a3cb9e57123710a9', import.meta.url))]);
  }
  signal.throwIfAborted();
  const microphone = navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, latency: {ideal: .02}}});
  const graph = prepareGraph().then(() => true, () => false);
  let media;
  const release = () => media?.getTracks().forEach(track => track.stop());
  let online;
  try {
    media = await microphone;
    signal.throwIfAborted();
    const ready = await Promise.race([graph, new Promise(done => { setupTimer = setTimeout(() => done(false), 850); })]);
    if (!ready) throw Error('Capture graph unavailable');
    signal.throwIfAborted();
    node = new AudioWorkletNode(audio, 'voice-pcm', {channelCount: 1, channelCountMode: 'explicit'});
    source = audio.createMediaStreamSource(media);
    source.connect(node); node.connect(audio.destination);
    if (request && crypto.randomUUID) online = recognizeSegments(request, signal);
  } catch (error) {
    clearTimeout(setupTimer);
    releaseGraph();
    if (media && !signal.aborted && globalThis.MediaRecorder) {
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
  function seal(op) {
    const blob = wave(frames, size);
    frames = []; size = 0;
    return {blob, recognized: op ? online?.mark(op) : undefined};
  }
  function close(error, complete = false) {
    if (closed) return;
    closed = true;
    clearTimeout(finishTimer);
    signal.removeEventListener('abort', abort);
    release(); releaseGraph();
    if (!complete) online?.retire();
    while (cuts.length) {
      const cut = cuts.shift();
      if (error) cut.reject(error);
      else cut.resolve(seal());
    }
    if (error) reject(error);
    else resolve(seal(complete ? 'finish' : undefined));
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
        const frame = length === data.byteLength ? data : data.slice(0, length);
        frames.push(frame);
        online?.audio(frame);
        size += length; total += length;
      }
      if (total >= capacity) stop();
    } else if (data === 'cut') {
      cuts.shift()?.resolve(seal(size ? 'cut' : undefined));
    } else if (data === 'pause') {
      void online?.mark('pause');
    } else if (data === 'finish') close(null, true);
  };
  signal.addEventListener('abort', abort, {once: true});
  media.getAudioTracks().forEach(track => track.addEventListener('ended', stop, {once: true}));
  return {
    result, stop,
    cut() {
      if (finishing || closed) return Promise.resolve({blob:null});
      return new Promise((resolve, reject) => {
        cuts.push({resolve, reject});
        node.port.postMessage('cut');
      });
    },
    pause() { if (!finishing && !closed) node.port.postMessage('pause'); },
    resume() { if (!finishing && !closed) node.port.postMessage('resume'); },
  };
}
