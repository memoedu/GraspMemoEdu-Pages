import {getLanguage} from './i18n.js?v=dc07b85c3eb4a143';
import {activeFormulaField, prepareVoiceFormula} from './formula-input.js?v=dc07b85c3eb4a143';
import {microphoneIcon, recordingMime} from './microphone-recorder.js?v=dc07b85c3eb4a143';
import {retainMicrophone, segmentMicrophone} from './voice-stream.js?v=dc07b85c3eb4a143';
import {dictationContext, voiceContext} from './voice-context.js?v=dc07b85c3eb4a143';
import {answerTarget, answerConversionChange} from './answer-conversion.js?v=dc07b85c3eb4a143';
import {currentModal} from './question-tools.js?v=dc07b85c3eb4a143';

const answerForms = new WeakSet();
const textTypes = ['text', 'search', 'tel', 'url', 'email', 'number'];
const strings = (zh, en) => getLanguage() === 'en' ? en : zh;
const changed = 'voiceinputchange';
const audioLimitMinutes = 2;
const audioLimitMs = audioLimitMinutes * 60000;
let lastField, current, statusTimer, status = '', available = () => false, identity = () => null, transcribe, streamRequest;
let accountScope = () => null;
let paint = () => {};
let paintDuration = () => {};

function elapsed(job) {
  return Math.min(audioLimitMs, job.elapsed + (job.startedAt == null ? 0 : performance.now() - job.startedAt));
}

function freezeDuration(job) {
  job.elapsed = elapsed(job);
  job.startedAt = null;
  clearTimeout(job.durationTimer);
}

function tickDuration(job) {
  if (current !== job || job.startedAt == null) return;
  const ms = elapsed(job);
  if (ms === audioLimitMs) { stop(true); return; }
  paintDuration();
  job.durationTimer = setTimeout(() => tickDuration(job), 1000 - (ms % 1000));
}

function editable(field) {
  return field?.isConnected && !field.closest('[hidden], [inert], [data-no-voice]') &&
    !field.matches(':disabled, [readonly], [autocomplete*="password"], [autocomplete="one-time-code"]') &&
    field.getClientRects().length > 0 && (field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement && textTypes.includes(field.type)));
}

function destination(field) {
  const formula = activeFormulaField(field);
  if (formula) return {...formula, element: field, context: voiceContext(formula.field), math: field.localName === 'math-field',
    profile: formula.field.form?.dataset.voiceAnswer ? 'answer' : 'general'};
  if (!editable(field)) return null;
  return {field, element: field, context: voiceContext(field), value: field.value, from: field.selectionStart ?? (field.type === 'number' ? 0 : field.value.length),
    to: field.selectionEnd ?? field.value.length,
    profile: field.closest('.questionCalculator,.whiteboardMath') ? 'calculator' : field.form?.dataset.voiceAnswer ? 'answer' : 'general'};
}

function currentDestination() {
  const active = document.activeElement;
  const modal = currentModal();
  const workspace = !modal && active?.closest('.questionWorkspace.whiteboardOpen');
  const board = workspace && (workspace.querySelector('[data-whiteboard-voice-selection]') ||
    workspace.querySelector('[data-whiteboard-expression]'));
  const target = destination(board && active?.matches('iframe') ? board :
    active?.closest('.questionTools') ? (board && !lastField?.closest('.whiteboardMath') ? board : lastField) : active);
  if (target && (!modal || modal.contains(target.field))) return target;
  const answer = !modal && answerTarget(document, {topic: true});
  return answer ? {answer, context: answer.context, unchanged: answer.pin(), profile: answer.voiceProfile} : null;
}

function insert(target, text) {
  if (target.insert) return target.insert(text);
  const {field, value, from, to} = target;
  if (!editable(field) || field.value !== value) return false;
  if (field.maxLength >= 0 && value.length - (to - from) + text.length > field.maxLength) return false;
  if (field.selectionStart !== null) field.setRangeText(text, from, to, 'end');
  else {
    const next = value.slice(0, from) + text + value.slice(to);
    field.value = next;
    if (field.value !== next) { field.value = value; return false; }
  }
  field.dispatchEvent(new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text}));
  if (field.matches('[data-whiteboard-expression], [data-whiteboard-variable]')) {
    field.dispatchEvent(new CustomEvent('whiteboard-dictation', {detail: text}));
  }
  return true;
}

function guardInsertion(target) {
  const surface = target.surface || target.field;
  const events = new AbortController();
  let interrupted = false;
  function interrupt() { interrupted = true; }
  for (const type of ['beforeinput', 'compositionstart', 'pointerdown']) {
    surface.addEventListener(type, interrupt, {capture: true, signal: events.signal});
  }
  surface.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || target.field instanceof HTMLInputElement)) return;
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) interrupt();
  }, {capture: true, signal: events.signal});
  return {
    range: target.math && target.readText(),
    close() { events.abort(); },
    get interrupted() { return interrupted; },
  };
}

const canRecord = () => Boolean(available() && (current?.page === location.hash || currentDestination()));
function update(message = '') {
  clearTimeout(statusTimer);
  status = message;
  paint();
  document.dispatchEvent(new Event(changed));
  if (message && !current) statusTimer = setTimeout(() => update(), 3000);
}

function setPhase(job, phase, message) {
  job.phase = phase;
  update(message);
}

async function recordedResult(job, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  if (!active(job)) return null;
  const before = ((job.context?.textbox?.before || '') + job.text).slice(-4096).replace(/^[\uDC00-\uDFFF]/, '');
  const context = job.text && !job.target.answer ? {...job.context, textbox: {
    ...job.context?.textbox, before,
  }} : job.context;
  return transcribe({mime_type: recordingMime(blob), data_base64: btoa(binary), profile: job.target.profile,
    context, segmented: true, ...(!job.target.answer && {live: true})});
}

const active = job => current === job && job.identity === identity();

function recordingMessage(job) {
  if (job.failure) return job.failure;
  if (job.phase === 'paused') return job.processing
    ? strings('录音已暂停，正在转写…', 'Recording paused. Transcribing…')
    : strings('录音已暂停', 'Recording paused');
  return job.processing
    ? strings('正在转写上一段，录音继续', 'Transcribing the previous segment. Still recording.')
    : strings('正在录音', 'Recording');
}

function appendTranscript(job, text) {
  if (!text) return;
  const previous = job.text || job.previousText;
  const separator = !previous ? '' : job.target.answer ? '\n' :
    job.target.profile !== 'calculator' && job.target.field.type !== 'number' &&
      /[a-z0-9]$/i.test(previous) && /^[a-z0-9]/i.test(text) ? ' ' : '';
  const segment = separator + text;
  if (commitSegment(job, segment)) job.previousText = text;
  else job.text += job.text ? segment : text;
}

function commitSegment(job, text) {
  const {target, insertion} = job;
  if (!insertion || insertion.interrupted || job.page !== location.hash ||
      target.context !== voiceContext(target.field)) return false;
  insertion.close();
  job.insertion = null;
  let pinned = target;
  if (insertion.range) {
    // MathLive can finish updating ProseMirror after the previous insertion.
    // Resolve a fresh editor anchor only if its full text and range still match.
    pinned = destination(target.element);
    if (pinned?.field !== target.field || pinned.context !== target.context) return false;
    const range = pinned.readText();
    if (range.before !== insertion.range.before || range.selected !== insertion.range.selected ||
        range.after !== insertion.range.after) return false;
  }
  if (!insert(pinned, text)) return false;
  if (!active(job)) return true;
  // The editor's real selection now follows the inserted segment. Read it
  // back before the next result so only the original segment replaces a range.
  const next = destination(target.element) || destination(document.activeElement);
  if (next?.field === target.field && next.context === target.context) {
    if (next.field.type === 'number') next.from = next.to = next.value.length;
    job.target = next;
    job.insertion = guardInsertion(next);
    job.context = dictationContext(next);
  } else if (job.context) {
    const textbox = job.context.textbox;
    job.context = {...job.context, textbox: {...textbox, selected: '',
      before: ((textbox?.before || '') + text).slice(-4096).replace(/^[\uDC00-\uDFFF]/, '')}};
  }
  return true;
}

function enqueue(job, audio) {
  // Resolve the capture independently of any pending network request.
  job.segments.push(audio.catch(error => ({error})));
  void process(job);
}

async function process(job) {
  if (!active(job) || job.processing || job.failure) return;
  job.processing = true;
  if (job.phase === 'recording' || job.phase === 'paused') update(recordingMessage(job));
  try {
    while (active(job) && job.segments.length) {
      const {blob, error, recognized} = await job.segments[0];
      if (!active(job)) return;
      if (error) { job.segments.shift(); throw error; }
      const text = await recognized;
      const result = typeof text === 'string' ? {text} : blob && await recordedResult(job, blob);
      if (!active(job)) return;
      appendTranscript(job, result?.text?.trim());
      job.segments.shift();
    }
  } catch (error) {
    if (active(job)) job.failure = error.message || strings('转写失败，请重试。', 'Transcription failed. Try again.');
  } finally {
    job.processing = false;
  }
  if (!active(job)) return;
  if (!job.captureDone) {
    if (job.phase === 'recording' || job.phase === 'paused') update(recordingMessage(job));
    return;
  }
  if (job.failure) { setPhase(job, 'failed', job.failure); return; }
  if (job.text && job.target.answer) { await fillAnswer(job); return; }
  job.insertion?.close();
  if (job.text) {
    job.submit = null;
    setPhase(job, 'ready', strings('原输入已改变。请选择输入位置后插入转写。', 'The original input changed. Select a destination to insert the transcript.'));
    return;
  }
  current = null;
  update(job.captureError || (job.previousText
    ? strings('已插入转写文字。', 'Transcript inserted.')
    : strings('未识别到文字。', 'No speech was recognized.')));
  const form = job.target.field?.form;
  if (job.previousText && !job.captureError && job.submit?.form === form && form?.isConnected && !job.submit.disabled)
    form.requestSubmit(job.submit);
}

async function fillAnswer(job) {
  setPhase(job, 'converting', strings('正在填写答题控件…', 'Updating answer controls…'));
  const valid = () => current === job && job.identity === identity() && job.page === location.hash && job.target.unchanged();
  const applied = valid() && await job.target.answer.convert(job.text, valid, {speech: true});
  if (current !== job || job.identity !== identity()) return;
  if (applied) {
    current = null;
    update();
  } else if (!valid()) {
    current = null;
    update(strings('作答位置已变化。请在当前题目重新录音。', 'The answer location changed. Record again for the current question.'));
  } else setPhase(job, 'conversion_failed', strings('未能填入答案。可重试填入，或取消后重新录音。', 'Could not fill in the answer. Retry, or cancel and record again.'));
}

async function start() {
  if (current || !available()) return;
  const target = currentDestination();
  if (!target) {
    update(strings('先把光标放在要输入的位置。', 'Place the cursor where you want to type.'));
    return;
  }
  const job = {target, identity: identity(), page: location.hash, abort: new AbortController(), elapsed: 0, segments: [], text: ''};
  current = job;
  if (target.profile === 'answer' && !['literal', 'code'].includes(target.context?.style)) prepareVoiceFormula();
  setPhase(job, 'opening', strings('正在打开麦克风…', 'Opening microphone…'));
  try {
    job.context = dictationContext(target);
    if (!target.answer) job.insertion = guardInsertion(target);
    job.recorder = await segmentMicrophone({scope: microphoneScope(), maxDurationMs: audioLimitMs, signal: job.abort.signal, request: packet => {
      if (job.identity !== identity()) throw DOMException('Account changed', 'AbortError');
      return streamRequest(packet.op === 'open' ? {...packet, profile: target.profile, context: job.context} : packet);
    }});
    if (active(job)) {
      job.startedAt = performance.now();
      setPhase(job, 'recording', strings('正在录音', 'Recording'));
      tickDuration(job);
    }
    const tail = await job.recorder.result;
    freezeDuration(job);
    if (active(job)) {
      job.captureDone = true;
      setPhase(job, 'transcribing', job.submit
        ? strings('已接收提交，转写完成后自动判题。', 'Submission queued. Grading starts after transcription.')
        : strings('正在转写…', 'Transcribing…'));
      enqueue(job, Promise.resolve(tail));
      if (job.failure) setPhase(job, 'failed', job.failure);
    }
  } catch (error) {
    freezeDuration(job);
    if (current !== job) return;
    if (job.recorder && (job.segments.length || job.text || job.previousText)) {
      job.captureDone = true;
      job.captureError = strings('录音设备中断，请重新录音。', 'The microphone stopped. Please record again.');
      setPhase(job, job.failure ? 'failed' : 'transcribing', job.failure || job.captureError);
      void process(job);
      return;
    }
    job.insertion?.close();
    current = null;
    update(error.message === 'Recording is empty'
      ? strings('没有录到声音，请检查麦克风后重试。', 'No audio was captured. Check your microphone and try again.')
      : strings('录音未完成。请检查麦克风权限后重试。', 'Recording failed. Check microphone permissions and try again.'));
  }
}

export function voiceAnswerPending(form) {
  return Boolean(form && answerForms.has(form) && current?.target.field?.form === form &&
    ['recording', 'paused', 'finishing', 'transcribing'].includes(current.phase));
}

export function enableVoiceAnswer(form, {defer = false} = {}) {
  form.dataset.voiceAnswer = 'true';
  if (!defer) return;
  answerForms.add(form);
  form.addEventListener('submit', event => {
    if (!voiceAnswerPending(form) || !event.submitter || event.submitter.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (current.submit) return;
    current.submit = event.submitter;
    if (['recording', 'paused'].includes(current.phase)) stop();
    update(strings('已接收提交，转写完成后自动判题。', 'Submission queued. Grading starts after transcription.'));
  }, true);
}

function stop(atLimit = false) {
  freezeDuration(current);
  setPhase(current, 'finishing', atLimit
    ? strings('已到录音上限，正在结束录音…', 'Recording limit reached. Finishing…')
    : strings('正在结束录音…', 'Finishing recording…'));
  current.recorder.stop();
}

export function resetVoiceInput() {
  if (current) {
    const job = current;
    current = null;
    freezeDuration(job);
    job.insertion?.close();
    job.abort.abort();
  }
  lastField = null;
  update();
}

function microphoneScope() {
  if (!available()) return undefined;
  const path = location.hash.split('?')[0];
  const topic = path.match(/^#(?:\/subjects\/[^/]+)?\/(?:topic|review)\/[^/]+/);
  return JSON.stringify([accountScope(), topic?.[0] || path]);
}

export function installVoiceInput({canUse, getIdentity, getAccountScope = getIdentity, request}) {
  available = canUse;
  identity = getIdentity;
  accountScope = getAccountScope;
  transcribe = body => request('voice-input/transcribe', {method: 'POST', body, timeout: 180000});
  streamRequest = body => request('voice-input/stream', {method: 'POST', body,
    timeout: body.op === 'cut' || body.op === 'finish' ? 45000 : 12000});
  document.addEventListener('focusin', event => {
    if (editable(event.target) || activeFormulaField(event.target)) lastField = event.target;
    else if (!event.target.closest('.questionTools') && current?.phase !== 'ready') lastField = null;
    paint();
  });
  document.addEventListener('focusout', event => {
    if (!event.relatedTarget) queueMicrotask(paint);
  });
  document.addEventListener(answerConversionChange, paint);
  document.addEventListener(changed, () => {
    for (const form of document.querySelectorAll('[data-voice-answer]')) form.dispatchEvent(new Event(changed));
  });
  // The toolbar occupies space on pages and in dialogs. Keep its footprint
  // until a pressed control has received its click.
  let pointerActive = false;
  const voice = voiceControls(() => pointerActive);
  document.addEventListener('pointerdown', event => {
    if (event.isPrimary) pointerActive = !voice.hidden;
  }, true);
  const finishPointer = () => {
    if (!pointerActive) return;
    pointerActive = false;
    paint();
  };
  for (const name of ['pointerup', 'pointercancel']) addEventListener(name, event => {
    if (event.isPrimary) setTimeout(finishPointer, 0);
  }, true);
  addEventListener('blur', finishPointer);
  new MutationObserver(() => {
    if (!pointerActive && voice.hidden === canRecord()) paint();
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden']});
  addEventListener('pagehide', () => { resetVoiceInput(); retainMicrophone(); });
  addEventListener('hashchange', () => {
    if (current && current.page !== location.hash) resetVoiceInput();
    else paint();
    retainMicrophone(microphoneScope());
  });
  return voice;
}

export function refreshVoiceInput() {
  if (current && (!available() || current.identity !== identity())) resetVoiceInput();
  else paint();
  retainMicrophone(microphoneScope());
}

export function voiceFieldPending(field) {
  return current?.target.field === field && !['ready', 'failed'].includes(current.phase);
}

function voiceControls(holdLayout) {
  const root = document.createElement('div');
  root.className = 'voiceTool';
  root.addEventListener('pointerdown', event => {
    // Keep the text selection until the voice action captures it.
    if (event.target.closest('button')) event.preventDefault();
  });
  const button = (label, action, path) => {
    const control = document.createElement('button');
    control.className = path ? 'questionToolButton' : 'secondaryButton';
    control.type = 'button';
    if (path) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
      const line = document.createElementNS(svg.namespaceURI, 'path');
      line.setAttribute('d', path); svg.append(line); control.append(svg);
    }
    control.addEventListener('click', action);
    const name = label();
    control.title = name;
    control.setAttribute('aria-label', name);
    if (!path) control.textContent = name;
    return control;
  };
  const mic = button(() => strings('录音输入', 'Voice input'), () => void start(), microphoneIcon);
  const pause = button(() => '', () => {
    const job = current;
    if (job.phase === 'paused') {
      job.recorder.resume();
      job.startedAt = performance.now();
      job.phase = 'recording';
      update(recordingMessage(job));
      tickDuration(job);
    } else {
      job.recorder.pause();
      freezeDuration(job);
      job.phase = 'paused';
      update(recordingMessage(job));
    }
  });
  const end = button(() => strings('结束录音', 'Stop recording'), () => stop());
  const cut = button(() => strings('转写', 'Transcribe'), () => {
    const job = current;
    const recording = job.phase === 'recording';
    freezeDuration(job);
    job.elapsed = 0;
    if (recording) job.startedAt = performance.now();
    enqueue(job, job.recorder.cut());
    paintDuration();
    tickDuration(job);
  });
  const retry = button(() => strings('重试转写', 'Retry transcription'), () => {
    if (current.phase === 'conversion_failed') void fillAnswer(current);
    else {
      current.failure = null;
      if (current.captureDone) setPhase(current, 'transcribing', strings('正在转写…', 'Transcribing…'));
      void process(current);
    }
  });
  const use = button(() => strings('插入转写文字', 'Insert transcript'), () => {
    const target = destination(lastField);
    if (!target || target.profile !== current.target.profile || !insert(target, current.text)) {
      update(strings('请选择可用的同类输入位置。', 'Select an available input of the same kind.')); return;
    }
    current = null; update(strings('已插入转写文字。', 'Transcript inserted.'));
  });
  const cancel = button(() => strings('取消', 'Cancel'), resetVoiceInput);
  const panel = document.createElement('div'); panel.className = 'voiceToolPanel';
  const message = document.createElement('span'); message.setAttribute('role', 'status');
  const duration = document.createElement('span'); duration.className = 'voiceDuration';
  panel.append(message, duration, pause, cut, end, retry, use, cancel); root.append(mic, panel);
  paintDuration = () => {
    duration.hidden = !current?.recorder || !['recording', 'paused', 'finishing', 'transcribing'].includes(current.phase);
    if (duration.hidden) return;
    const seconds = Math.floor(elapsed(current) / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    duration.textContent = strings(
      mm + ' 分钟: ' + ss + ' 秒 / ' + audioLimitMinutes + ' 分钟', mm + ':' + ss + ' / ' + audioLimitMinutes + ' min');
  };
  paint = () => {
    const phase = current?.phase;
    const recording = phase === 'recording' || phase === 'paused';
    const hidden = !canRecord();
    if (root.hidden !== hidden && !(hidden && holdLayout())) root.hidden = hidden;
    mic.disabled = phase === 'opening';
    mic.setAttribute('aria-pressed', String(Boolean(recording)));
    const label = strings('录音输入', 'Voice input'); mic.title = label; mic.setAttribute('aria-label', label);
    panel.hidden = !status;
    if (message.textContent !== status) message.textContent = status;
    paintDuration();
    pause.hidden = cut.hidden = end.hidden = !recording;
    cut.disabled = !recording;
    const pauseLabel = phase === 'paused' ? strings('继续录音', 'Resume recording') : strings('暂停录音', 'Pause recording');
    if (pause.textContent !== pauseLabel) pause.textContent = pauseLabel;
    pause.setAttribute('aria-label', pause.textContent);
    retry.hidden = !(current?.failure && !current.processing && (recording || phase === 'failed')) &&
      (phase !== 'conversion_failed' || !current.target.unchanged());
    const retryLabel = phase === 'conversion_failed' ? strings('重试填入', 'Retry filling controls')
      : current?.submit ? strings('重试转写并提交', 'Retry transcription and submit') : strings('重试转写', 'Retry transcription');
    if (retry.textContent !== retryLabel) retry.textContent = retryLabel;
    retry.setAttribute('aria-label', retry.textContent);
    use.hidden = phase !== 'ready'; cancel.hidden = !phase;
  };
  paint();
  return root;
}
