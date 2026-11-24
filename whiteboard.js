import {calculate, storedExpression} from './calculator-engine.js?v=d78db3c9b6ac003a';
import {assignableVariable, normalizeVariableName, permitsKey} from './calculator-policy.js?v=d78db3c9b6ac003a';
import {chooseWhiteboardFolder, whiteboardFolder, saveWhiteboard, restoreWhiteboard} from './whiteboard-archive.js?v=d78db3c9b6ac003a';
import {refreshVoiceInput, voiceFieldPending} from './voice-input.js?v=d78db3c9b6ac003a';

const editorUrl = 'https://rowan-memoedu.github.io/AnnotationCapture/whiteboard/v2/whiteboard.html';
const boards = new WeakMap();
const work = new Map();

export function questionToolSession(key) {
  if (key && work.has(key)) return work.get(key);
  const session = {saved: new Map(), history: [], degrees: false, memory: new Map()};
  if (key) {
    work.set(key, session);
    if (work.size > 64) work.delete(work.keys().next().value);
  }
  return session;
}

export function configureWhiteboard(workspace, options) {
  const board = boards.get(workspace);
  if (!board) return;
  if (options?.key !== board.options.key) board.dispose();
  else { board.options = options; board.refresh(); }
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function bridge(frame) {
  const channel = new MessageChannel();
  const pending = new Map();
  let sequence = 0;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => {});
  const timeout = setTimeout(() => rejectReady(Error('load')), 12000);
  frame.addEventListener('load', () => {
    frame.contentWindow.postMessage({type: 'annotation-whiteboard:v1'}, new URL(editorUrl).origin, [channel.port2]);
  }, {once: true});
  channel.port1.onmessage = ({data}) => {
    if (data?.ready === 1) { clearTimeout(timeout); resolveReady(); }
    const task = pending.get(data?.id);
    if (!task) return;
    pending.delete(data.id);
    clearTimeout(task.timer);
    if (data.failed) task.reject(Error('editor'));
    else task.resolve(data.result);
  };
  return {
    async send(command, value) {
      await ready;
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(Error('editor')); }, 8000);
        pending.set(id, {resolve, reject, timer});
        channel.port1.postMessage({id, command, value});
      });
    },
    ready,
    dispose() {
      clearTimeout(timeout);
      rejectReady(Error('closed'));
      channel.port1.close();
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('closed')); }
      pending.clear();
    },
  };
}

export function openWhiteboard(workspace, launcher, question, options, session, english) {
  const previous = boards.get(workspace);
  if (previous) return previous.toggle(launcher);
  const local = (zh, en) => english ? en : zh;
  const panel = node('section', 'whiteboardPanel');
  const header = node('header');
  header.append(node('strong', '', local('白板', 'Whiteboard')));
  const frame = node('iframe');
  frame.title = local('批注画布', 'Annotation canvas');
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin');
  frame.referrerPolicy = 'no-referrer';
  const port = bridge(frame);
  frame.src = editorUrl + (english ? '?lang=en' : '');
  const divider = node('div', 'whiteboardDivider');
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');
  divider.setAttribute('aria-label', local('调整题目与白板比例', 'Resize question and whiteboard'));
  divider.setAttribute('aria-valuemin', '30');
  divider.setAttribute('aria-valuemax', '70');
  const status = node('p', 'whiteboardStatus');
  status.setAttribute('role', 'status');
  const ioError = () => local('无法读写白板。请检查目录授权或重试。', 'Could not access the whiteboard. Check folder access or try again.');
  const loading = local('正在打开白板…', 'Opening whiteboard…');
  let ready = false, loadFailed = false, busy = false, closed = false, shown = true, hydrated = false, share = 55, swapped = false;
  const state = {options, dispose, toggle, refresh};
  boards.set(workspace, state);

  function control(parent, zh, en, handler, className = 'secondaryButton') {
    const button = node('button', className, local(zh, en));
    button.type = 'button';
    button.addEventListener('click', () => { void handler(); });
    parent.append(button);
    return button;
  }
  function resize(value) {
    share = Math.min(70, Math.max(30, Math.round(value)));
    divider.setAttribute('aria-valuenow', String(share));
    workspace.style.setProperty('--question-share', share + '%');
  }
  divider.addEventListener('pointerdown', event => {
    if (event.button === 0) divider.setPointerCapture(event.pointerId);
  });
  divider.addEventListener('pointermove', event => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const area = workspace.getBoundingClientRect();
    resize((event.clientX - area.left) * 100 / area.width);
  });
  divider.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    resize({ArrowLeft: share - 2, ArrowRight: share + 2, Home: 30, End: 70}[event.key]);
  });
  resize(share);
  control(header, '交换位置', 'Swap sides', () => {
    swapped = !swapped;
    workspace.classList.toggle('whiteboardFirst', swapped);
    resize(100 - share);
  });
  const folder = control(header, '归档目录', 'Archive folder', async () => {
    if (busy || !ready) return;
    busy = true;
    refresh();
    try {
      await chooseWhiteboardFolder();
      if (closed) return;
      const snapshot = hydrated ? null : await port.send('snapshot');
      if (snapshot?.empty) await loadSaved();
      status.textContent = local('归档目录已授权。', 'Archive folder authorized.');
    } catch (error) {
      if (error.name !== 'AbortError') status.textContent = error.message === 'directory_unsupported'
        ? local('请使用桌面版 Chrome 选择本机目录。', 'Use desktop Chrome to choose a local folder.') : ioError();
    } finally {
      busy = false;
      if (!closed) refresh();
    }
  });
  const submit = control(header, '提交', 'Submit', submitBoard, 'primaryButton');
  const dismiss = control(header, '收起', 'Close', () => toggle());

  const math = node('div', 'whiteboardMath');
  const expression = node('input');
  expression.type = 'text';
  expression.maxLength = 1024;
  expression.dataset.whiteboardExpression = 'true';
  expression.setAttribute('aria-label', local('白板表达式或语音草稿', 'Whiteboard expression or voice draft'));
  expression.placeholder = local('输入或录音输入表达式', 'Enter or dictate an expression');
  expression.value = session.whiteboardExpression || '';
  expression.addEventListener('input', () => { session.whiteboardExpression = expression.value; });
  expression.addEventListener('whiteboard-dictation', ({detail}) => {
    if (!busy && ready && state.options.editable && detail?.trim()) {
      void port.send('insert', detail).catch(() => { status.textContent = ioError(); });
    }
  });
  math.append(expression);
  control(math, '写入白板', 'Add to board', async () => {
    if (!expression.value.trim()) return;
    try { await port.send('insert', expression.value); status.textContent = ''; }
    catch { status.textContent = ioError(); }
  });
  const variable = node('input');
  variable.type = 'text';
  variable.maxLength = 48;
  variable.placeholder = 'A';
  variable.dataset.whiteboardVariable = '';
  variable.setAttribute('aria-label', local('变量名', 'Variable name'));
  const stores = permitsKey(question.calculate, 'memory_registers');
  const evaluates = permitsKey(question.calculate, 'evaluate');
  function operand() {
    const start = expression.selectionStart ?? 0;
    const end = expression.selectionEnd ?? start;
    return {start, end, value: (start === end ? expression.value : expression.value.slice(start, end)).trim()};
  }
  const result = node('output');
  result.setAttribute('aria-live', 'polite');
  async function evaluate(store = false) {
    const part = operand();
    const original = expression.value;
    if (!part.value) return;
    const name = normalizeVariableName(variable.value);
    if (store && !assignableVariable(name)) {
      result.textContent = local('请输入可用的变量名。', 'Enter a valid variable name.');
      return;
    }
    try {
      const memory = Object.fromEntries([...session.memory].map(([key, entry]) => [key, entry.value]));
      let calculated;
      try {
        calculated = await calculate({config: question.calculate, module: 'expression', operation: 'evaluate',
          input: {expression: part.value}, memory});
      } catch (error) {
        if (!store) throw error;
        calculated = {text: part.value, symbolic: await storedExpression(part.value, question.calculate, name, memory)};
      }
      if (closed || busy || expression.value !== original) return;
      if (store) {
        const value = calculated.numeric ?? calculated.complex ?? calculated.array ?? calculated.symbolic;
        if (value == null) throw Error('register');
        session.memory.set(name, {value, text: calculated.text});
        if (part.start !== part.end) {
          expression.setRangeText(name, part.start, part.end, 'end');
          expression.dispatchEvent(new Event('input'));
        }
      } else await port.send('insert', part.value + ' = ' + calculated.text);
      result.textContent = [...session.memory].map(([key, entry]) => key + ' = ' + entry.text).join(' · ') || calculated.text;
    } catch { result.textContent = local('无法计算或储存这段表达式。', 'This expression could not be evaluated or stored.'); }
  }
  if (evaluates) control(math, '计算', 'Evaluate', () => evaluate());
  if (stores) {
    math.append(variable);
    control(math, '储存／换元', 'Store / substitute', () => evaluate(true));
    result.textContent = [...session.memory].map(([name, entry]) => name + ' = ' + entry.text).join(' · ');
  }
  math.append(result);
  panel.append(header, frame, math, status);
  workspace.append(divider, panel);
  show(true);

  function show(value) {
    shown = value;
    workspace.classList.toggle('whiteboardOpen', value);
    workspace.classList.toggle('whiteboardFirst', value && swapped);
    divider.hidden = panel.hidden = !value;
    (workspace.querySelector('[data-question-tool=whiteboard]') || launcher).setAttribute('aria-expanded', String(value));
    refreshVoiceInput();
  }

  function toggle(button) {
    if (closed || busy) return;
    if (shown && loadFailed) dispose();
    else show(!shown);
    if (!shown) (button || workspace.querySelector('[data-question-tool=whiteboard]') || launcher).focus();
  }

  function refresh() {
    for (const control of math.querySelectorAll('button, input')) control.disabled = busy || !ready || !state.options.editable;
    submit.disabled = busy || !ready || !state.options.submit || !state.options.editable;
    submit.hidden = !state.options.submit;
    folder.disabled = busy || !ready;
    dismiss.disabled = busy;
    if (ready && !busy) void port.send('lock', !state.options.editable).catch(() => {});
    refreshVoiceInput();
  }

  async function loadSaved() {
    const root = await whiteboardFolder({readOnly: true});
    await session.whiteboardCapture;
    if (closed) return;
    let imageMissing = false;
    if (session.whiteboardScene) {
      await port.send('restore', session.whiteboardScene);
      hydrated = true;
    }
    else if (root) {
      const saved = await restoreWhiteboard(root, state.options.key);
      if (saved && !closed) {
        await port.send('restore', saved.scene);
        hydrated = true;
        imageMissing = saved.imageMissing;
        if (Array.isArray(saved.registers)) {
          for (const item of saved.registers) {
            if (!Array.isArray(item)) continue;
            const [name, entry] = item;
            if (assignableVariable(name) && typeof entry?.text === 'string' && !session.memory.has(name)) session.memory.set(name, entry);
          }
          if (stores) result.textContent = [...session.memory].map(([name, entry]) => name + ' = ' + entry.text).join(' · ');
        }
      }
    }
    status.textContent = imageMissing ? local('已恢复笔迹，原归档的 PNG 文件已缺失。', 'Work restored. The original PNG is missing.')
      : root ? '' : local('选择本机归档目录后即可保存白板。', 'Choose a local archive folder to save whiteboards.');
  }

  async function submitBoard() {
    if (busy || !ready || !state.options.editable || !state.options.submit) return;
    if (voiceFieldPending(expression)) {
      status.textContent = local('请先结束录音并等待转写完成。', 'Stop recording and wait for the transcript before submitting.');
      return;
    }
    const current = state.options;
    busy = true;
    refresh();
    try {
      if (!current.isCurrent()) return;
      const root = await whiteboardFolder({ask: true});
      if (!root) {
        status.textContent = local('请先选择并授权本机归档目录。', 'Choose and authorize a local archive folder first.');
        return;
      }
      await port.send('lock', true);
      const snapshot = await port.send('snapshot');
      session.whiteboardScene = snapshot.scene;
      if (snapshot.empty) {
        status.textContent = local('白板上还没有作答。', 'There is no answer on the whiteboard yet.');
        return;
      }
      await saveWhiteboard(root, current.key, snapshot, session.memory);
      hydrated = true;
      if (closed || !current.isCurrent()) return;
      status.textContent = local('已保存白板，正在识别并判题…', 'Board saved. Reading and grading your work…');
      status.textContent = await current.submit(snapshot.png) || '';
    } catch (error) { status.textContent = error.message || ioError(); }
    finally {
      busy = false;
      if (!closed) refresh();
    }
  }

  function dispose() {
    if (closed) return;
    closed = true;
    boards.delete(workspace);
    show(false);
    divider.remove();
    panel.hidden = true;
    // Keep the frame attached until the unsent scene has been read.
    const finish = () => { port.dispose(); panel.remove(); };
    if (ready && !busy && frame.isConnected) {
      const capture = port.send('snapshot').then(snapshot => { session.whiteboardScene = snapshot.scene; }).catch(() => {}).finally(finish);
      session.whiteboardCapture = capture;
    } else finish();
  }

  status.textContent = loading;
  refresh();
  void port.ready.then(async () => {
    if (closed) return;
    try { await loadSaved(); } catch { status.textContent = ioError(); }
    if (closed) return;
    ready = true;
    refresh();
  }).catch(() => {
    if (closed) return;
    loadFailed = true;
    status.textContent = local('白板载入失败，收起后重试。', 'Could not load the whiteboard. Close and reopen it to retry.');
  });
  return state;
}
