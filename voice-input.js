import {getLanguage} from './i18n.js?v=bca9627f8ea46c76';
import {microphoneIcon, recordMicrophone, recordingMime} from './microphone-recorder.js?v=bca9627f8ea46c76';

const answerForms = new WeakSet();
const textTypes = ['text', 'search', 'tel', 'url', 'email', 'number'];
const strings = (zh, en) => getLanguage() === 'en' ? en : zh;
const changed = 'voiceinputchange';
const audioLimitMs = 119000;
let lastField, current, statusTimer, status = '', available = () => false, identity = () => null, transcribe;
let paint = () => {};

function editable(field) {
  return field?.isConnected && !field.closest('[hidden], [inert], [data-no-voice]') &&
    !field.matches(':disabled, [readonly], [autocomplete*="password"], [autocomplete="one-time-code"]') &&
    field.getClientRects().length > 0 && (field instanceof HTMLTextAreaElement ||
      (field instanceof HTMLInputElement && textTypes.includes(field.type)));
}

function destination(field) {
  if (!editable(field)) return null;
  return {field, value: field.value, from: field.selectionStart ?? (field.type === 'number' ? 0 : field.value.length),
    to: field.selectionEnd ?? field.value.length,
    profile: field.closest('.questionCalculator') ? 'calculator' : field.form?.dataset.voiceAnswer ? 'answer' : 'general'};
}

function insert(target, text) {
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
  return true;
}

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

async function process(job) {
  setPhase(job, 'transcribing', job.submit
    ? strings('已接收提交，转写完成后自动判题。', 'Submission queued. Grading starts after transcription.')
    : strings('正在转写…', 'Transcribing…'));
  try {
    const bytes = new Uint8Array(await job.blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const result = await transcribe({mime_type: recordingMime(job.blob), data_base64: btoa(binary), profile: job.target.profile});
    if (current !== job || job.identity !== identity()) return;
    if (!result?.text?.trim()) throw Error(strings('未识别到文字。', 'No speech was recognized.'));
    job.text = result.text;
    const {field} = job.target, form = field.form;
    if (insert(job.target, job.text)) {
      current = null;
      update(strings('已插入转写文字。', 'Transcript inserted.'));
      if (job.submit?.form === form && form?.isConnected && !job.submit.disabled) form.requestSubmit(job.submit);
    } else {
      job.submit = null;
      setPhase(job, 'ready', strings('原输入已改变。请选择输入位置后插入转写。', 'The original input changed. Select a destination to insert the transcript.'));
    }
  } catch (error) {
    if (current !== job || job.identity !== identity()) return;
    setPhase(job, 'failed', error.message || strings('转写失败，请重试。', 'Transcription failed. Try again.'));
  }
}

async function start() {
  if (current || !available()) return;
  const activeField = document.activeElement;
  const target = destination(editable(activeField) ? activeField : lastField);
  const modal = currentModal();
  if (!target || (modal && !modal.contains(target.field))) {
    update(strings('先把光标放在要输入的位置。', 'Place the cursor where you want to type.'));
    return;
  }
  const job = {target, identity: identity(), abort: new AbortController()};
  current = job;
  setPhase(job, 'opening', strings('正在打开麦克风…', 'Opening microphone…'));
  try {
    job.recorder = await recordMicrophone({maxDurationMs: audioLimitMs, signal: job.abort.signal});
    if (current === job) setPhase(job, 'recording', strings('正在录音', 'Recording'));
    job.blob = await job.recorder.result;
    if (current === job && identity() === job.identity) await process(job);
  } catch {
    if (current !== job) return;
    current = null;
    update(strings('录音未完成。请检查麦克风权限后重试。', 'Recording failed. Check microphone permissions and try again.'));
  }
}

export function voiceAnswerPending(form) {
  return Boolean(form && answerForms.has(form) && current?.target.field.form === form &&
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

function stop() {
  setPhase(current, 'finishing', strings('正在结束录音…', 'Finishing recording…'));
  current.recorder.stop();
}

export function resetVoiceInput() {
  if (current) {
    const job = current;
    current = null;
    job.abort.abort();
  }
  lastField = null;
  update();
}

function currentModal() {
  return Array.from(document.querySelectorAll('dialog:modal')).at(-1);
}

export function installVoiceInput({canUse, getIdentity, request}) {
  available = canUse;
  identity = getIdentity;
  transcribe = body => request('voice-input/transcribe', {method: 'POST', body, timeout: 180000});
  document.addEventListener('focusin', event => {
    if (editable(event.target)) lastField = event.target;
    else if (event.target.matches('input, textarea, [contenteditable]')) lastField = null;
  });
  document.addEventListener(changed, () => {
    for (const form of document.querySelectorAll('[data-voice-answer]')) form.dispatchEvent(new Event(changed));
  });
  addEventListener('pagehide', resetVoiceInput);
  return voiceControls();
}

export function refreshVoiceInput() {
  if (current && (!available() || current.identity !== identity())) resetVoiceInput();
  else paint();
}

function voiceControls() {
  const root = document.createElement('div');
  root.className = 'voiceTool';
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
    const paused = current.phase === 'paused';
    current.recorder[paused ? 'resume' : 'pause']();
    setPhase(current, paused ? 'recording' : 'paused', paused ? strings('正在录音', 'Recording') : strings('录音已暂停', 'Recording paused'));
  });
  const end = button(() => strings('结束录音', 'Stop recording'), stop);
  const retry = button(() => strings('重试转写', 'Retry transcription'), () => void process(current));
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
  panel.append(message, pause, end, retry, use, cancel); root.append(mic, panel);
  paint = () => {
    const phase = current?.phase;
    const recording = phase === 'recording' || phase === 'paused';
    const hidden = !available();
    if (root.hidden !== hidden) root.hidden = hidden;
    mic.disabled = phase === 'opening';
    mic.setAttribute('aria-pressed', String(Boolean(recording)));
    const label = strings('录音输入', 'Voice input'); mic.title = label; mic.setAttribute('aria-label', label);
    panel.hidden = !status;
    if (message.textContent !== status) message.textContent = status;
    pause.hidden = end.hidden = !recording;
    pause.textContent = phase === 'paused' ? strings('继续录音', 'Resume recording') : strings('暂停录音', 'Pause recording');
    pause.setAttribute('aria-label', pause.textContent);
    retry.hidden = phase !== 'failed';
    retry.textContent = current?.submit ? strings('重试转写并提交', 'Retry transcription and submit') : strings('重试转写', 'Retry transcription');
    retry.setAttribute('aria-label', retry.textContent);
    use.hidden = phase !== 'ready'; cancel.hidden = !phase;
  };
  paint();
  return root;
}
