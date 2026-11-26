import {t, translateMessage} from './i18n.js?v=e80e3658b4e90a21';
import {recordingPayload} from './microphone-recorder.js?v=e80e3658b4e90a21';
import {releaseMicrophone, segmentMicrophone} from './voice-stream.js?v=e80e3658b4e90a21';

const limit = 120000;
const context = {style: 'literal'};

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function branch(point) {
  const item = element('li', 'duckNode');
  item.dataset.kind = point.type;
  if (point.id) item.dataset.nodeId = point.id;
  item.append(element('span', 'duckNodeText', point.text ?? t('duck.hidden')));
  if (point.children?.length) {
    const children = element('ul', 'duckBranches');
    children.append(...point.children.map(branch));
    item.append(children);
  }
  return item;
}

export function rubberDuck(target, initial, {editable, signedIn, scope, request, check}) {
  const root = element('section', 'duckExercise');
  root.setAttribute('aria-label', t('duck.title'));
  const heading = element('div', 'duckHeading');
  const label = element('h3', 'duckTitle', t('duck.title'));
  const progress = element('span', 'duckProgress');
  progress.setAttribute('role', 'status');
  heading.append(label, progress);
  const tree = element('ul', 'duckTree');
  root.append(heading, tree);
  target.append(root);

  const lifecycle = new AbortController();
  let state = initial;
  let capture = null, captured = null, payload = null;
  let phase = 'idle', message = '', failure = false, busy = false, started = false, heard = initial.answer || '';
  const help = element('p', 'duckHelp', t('duck.help'));
  const actions = element('div', 'duckActions');
  const record = element('button', 'secondaryButton');
  const convert = element('button', 'primaryButton', t('duck.convert'));
  record.type = convert.type = 'button';
  actions.append(record, convert);
  const status = element('p', 'duckStatus');
  status.setAttribute('role', 'status');
  const transcript = element('details', 'duckTranscript');
  const spoken = element('p', 'duckSpoken');
  transcript.append(element('summary', '', t('duck.transcript')), spoken);
  root.append(help, actions, status, transcript);

  function paint() {
    const done = state.phase === 'done';
    actions.hidden = done || !editable;
    help.hidden = done || !editable;
    record.disabled = busy || phase === 'opening' || Boolean(captured || payload);
    record.textContent = t(phase === 'recording' ? 'duck.pause' : started ? 'duck.resume' : 'duck.start');
    convert.disabled = busy || phase === 'opening' || !(capture || captured || payload);
    convert.textContent = t(failure && payload ? 'duck.retry' : 'duck.convert');
    status.textContent = message || (state.outline.feedback ? translateMessage(state.outline.feedback) : '') ||
      (!signedIn ? t('duck.signIn') : !editable && !done ? t('training.noPermission') : '');
    status.classList.toggle('fieldError', failure);
    status.hidden = !status.textContent;
    transcript.hidden = !heard;
    spoken.textContent = heard;
  }

  function update(next) {
    state = next;
    progress.textContent = t('duck.covered', {done: next.outline.covered, total: next.outline.total});
    tree.replaceChildren(branch(next.outline.root));
    paint();
  }

  function dispose() {
    lifecycle.abort();
    clearTimeout(capture?.timer);
    capture?.abort.abort();
    releaseMicrophone(scope);
  }
  addEventListener('pagehide', dispose, {once: true, signal: lifecycle.signal});

  async function recordAudio() {
    if (record.disabled || lifecycle.signal.aborted) return;
    failure = false;
    if (capture?.recorder) {
      if (phase === 'recording') {
        capture.recorder.pause();
        phase = 'paused';
        message = t('duck.paused');
      } else {
        capture.recorder.resume();
        phase = 'recording';
        message = t('duck.recording');
      }
      paint();
      return;
    }

    const job = capture = {abort: new AbortController()};
    phase = 'opening';
    message = t('duck.opening');
    heard = '';
    transcript.open = true;
    paint();
    try {
      job.recorder = await segmentMicrophone({scope, signal: job.abort.signal, maxDurationMs: limit,
        request: body => request('voice-input/stream', {method: 'POST',
          body: body.op === 'open' ? {...body, profile: 'general', context} : body,
          timeout: body.op === 'finish' ? 45000 : 12000}),
        onPreview(text) {
          if (capture !== job || lifecycle.signal.aborted) return;
          heard = text;
          paint();
        }});
      started = true;
      phase = 'recording';
      message = t('duck.recording');
      job.timer = setTimeout(job.recorder.stop, limit);
      job.done = job.recorder.result.then(result => {
        if (!lifecycle.signal.aborted) {
          captured = result;
          if (!busy) message = t('duck.captured');
        }
      }, () => {
        if (!lifecycle.signal.aborted) {
          failure = true;
          message = t('duck.micError');
        }
      }).finally(() => {
        clearTimeout(job.timer);
        if (capture === job) capture = null;
        phase = 'paused';
        if (!lifecycle.signal.aborted) paint();
      });
    } catch {
      capture = null;
      phase = 'idle';
      failure = true;
      message = t('duck.micError');
    }
    if (!lifecycle.signal.aborted) paint();
  }

  async function convertAudio({pending = false} = {}) {
    busy = true;
    failure = false;
    message = t(payload ? 'duck.checking' : 'duck.transcribing');
    paint();
    try {
      if (!payload) {
        if (capture) {
          const job = capture;
          job.recorder.stop();
          await job.done;
        }
        lifecycle.signal.throwIfAborted();
        if (!captured) return;
        let text = await captured.recognized;
        if (typeof text !== 'string' && captured.blob) {
          const recording = await recordingPayload(captured.blob);
          const result = await request('voice-input/transcribe', {method: 'POST', timeout: 180000,
            signal: lifecycle.signal, body: {...recording, profile: 'general', context, segmented: true, live: true}});
          text = result.text;
        }
        lifecycle.signal.throwIfAborted();
        captured = null;
        heard = text?.trim() || '';
        if (!heard) { message = t('duck.empty'); return; }
        transcript.open = true;
        payload = {request_id: crypto.randomUUID(), attempt_id: state.attempt_id, answer: heard};
      }
      message = t('duck.checking');
      paint();
      const next = await check(payload, {pending, signal: lifecycle.signal});
      lifecycle.signal.throwIfAborted();
      failure = next.submission_status === 'error';
      if (!failure) payload = null;
      message = failure ? next.error ? translateMessage(next.error) : t('duck.checkError') : '';
      update(next);
    } catch (error) {
      if (!lifecycle.signal.aborted) {
        failure = true;
        message = translateMessage(error.message || '') || t('duck.checkError');
        // A failed batch transcription can be retried using the captured segment.
      }
    } finally {
      busy = false;
      if (!lifecycle.signal.aborted) paint();
    }
  }

  record.addEventListener('click', () => void recordAudio());
  convert.addEventListener('click', () => { if (!convert.disabled) void convertAudio(); });
  update(initial);
  if (editable && ['pending', 'running', 'error'].includes(initial.submission_status)) {
    payload = {request_id: initial.submission_id, attempt_id: initial.attempt_id, answer: initial.answer};
    if (initial.submission_status === 'error') {
      failure = true;
      message = translateMessage(initial.error);
      paint();
    } else {
      void convertAudio({pending: true});
    }
  }
  return {dispose, get busy() { return busy; }};
}
