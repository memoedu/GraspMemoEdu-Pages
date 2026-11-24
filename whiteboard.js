import {calculate, calculateSelectedFormula, storedExpression} from './calculator-engine.js?v=a7d489286149768a';
import {assignableVariable, normalizeVariableName, permitsKey} from './calculator-policy.js?v=a7d489286149768a';
import {chooseWhiteboardFolder, whiteboardFolder, saveWhiteboard, restoreWhiteboard} from './whiteboard-archive.js?v=a7d489286149768a';
import {refreshVoiceInput, voiceFieldPending} from './voice-input.js?v=a7d489286149768a';

const editorUrl = 'https://rowan-memoedu.github.io/AnnotationCapture/whiteboard/v3/whiteboard.html';
const boards = new WeakMap();
const work = new Map();
const casPreference = 'graspmemoedu:whiteboard-cas';

export function whiteboardCasEnabled() {
  try { return localStorage.getItem(casPreference) !== 'off'; } catch { return true; }
}

export function setWhiteboardCasEnabled(enabled) {
  try { localStorage.setItem(casPreference, enabled ? 'on' : 'off'); } catch { /* Keep storage failures local to this preference. */ }
}

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

function bridge(frame, onSelection) {
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
    if (data?.selection) onSelection(data.selection);
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
  const port = bridge(frame, selectionChanged);
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
  let selected, identified, selectionBusy = false, voiceSubstitute = false;
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
  if (!options.standalone) control(header, '交换位置', 'Swap sides', () => {
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
  folder.hidden = options.standalone;
  const submit = control(header, '提交', 'Submit', submitBoard, 'primaryButton');
  submit.classList.add('whiteboardSubmit');
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
  function operand(field = expression) {
    const start = field.selectionStart ?? 0;
    const end = field.selectionEnd ?? start;
    return {start, end, value: (start === end ? field.value : field.value.slice(start, end)).trim()};
  }
  const result = node('output');
  result.setAttribute('aria-live', 'polite');
  const showMemory = fallback => {
    result.textContent = [...session.memory].map(([key, entry]) => key + ' = ' + entry.text).join(' · ') || fallback || '';
  };
  async function calculateOperand(value, register, selectionArithmetic = false) {
    const memory = Object.fromEntries([...session.memory].map(([key, entry]) => [key, entry.value]));
    try {
      return await calculate({config: question.calculate, module: 'expression', operation: 'evaluate',
        input: {expression: value}, memory, selectionArithmetic});
    } catch (error) {
      if (!register) throw error;
      return {text: value, symbolic: await storedExpression(value, question.calculate, register, memory)};
    }
  }
  function remember(name, calculation) {
    const value = calculation.numeric ?? calculation.complex ?? calculation.array ?? calculation.symbolic;
    if (value == null) throw Error('register');
    session.memory.set(name, {value, text: calculation.text});
    showMemory();
  }
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
      const calculated = await calculateOperand(part.value, store ? name : null);
      if (closed || busy || expression.value !== original) return;
      if (store) {
        remember(name, calculated);
        if (part.start !== part.end) {
          expression.setRangeText(name, part.start, part.end, 'end');
          expression.dispatchEvent(new Event('input'));
        }
      } else await port.send('insert', part.value + ' = ' + calculated.text);
      showMemory(calculated.text);
    } catch { result.textContent = local('无法计算或储存这段表达式。', 'This expression could not be evaluated or stored.'); }
  }
  const evaluateButton = evaluates && control(math, '计算', 'Evaluate', () => selected === undefined ? evaluate() : evaluateSelection());
  const manualStore = stores && control(math, '储存／换元', 'Store / substitute', () => evaluate(true));
  const selectionTools = node('div', 'whiteboardSelection');
  selectionTools.hidden = true;
  const identify = control(selectionTools, '识别圈选公式', 'Recognize selected formula', recognizeSelected);
  const selectedFormula = node('input');
  selectedFormula.maxLength = 1024;
  selectedFormula.setAttribute('aria-label', local('圈选公式识别结果', 'Recognized formula'));
  selectedFormula.setAttribute('data-no-voice', '');
  selectionTools.append(selectedFormula);
  const storeSelection = control(selectionTools, '赋值', 'Assign', () => applySelection(false));
  const substitute = control(selectionTools, '赋值并换元', 'Assign and replace', () => applySelection(true));
  const selectionMessage = node('output');
  selectionMessage.setAttribute('aria-live', 'polite');
  selectionTools.append(selectionMessage);
  if (stores) {
    math.append(variable);
    showMemory();
  }
  if (stores || evaluates) math.append(selectionTools);
  math.append(result);
  panel.append(header, frame, math, status);
  if (!options.standalone) workspace.append(divider);
  workspace.append(panel);
  show(true);

  function selectionChanged({id, count}) {
    if (!(stores || evaluates) || !state.options.recognizeSelection || closed) return;
    selected = count ? id : undefined;
    identified = undefined;
    selectedFormula.value = '';
    voiceSubstitute = false;
    selectionMessage.textContent = '';
    refreshSelection();
    refreshVoiceInput();
  }

  function refreshSelection() {
    if (!(stores || evaluates)) return;
    const active = selected !== undefined && state.options.editable;
    const hasFormula = active && identified === selected;
    const disabled = busy || selectionBusy || !ready;
    selectionTools.hidden = !active;
    if (manualStore) manualStore.hidden = active;
    variable.toggleAttribute('data-whiteboard-voice-selection', active && stores);
    identify.disabled = disabled || !active;
    selectedFormula.hidden = !hasFormula;
    storeSelection.hidden = substitute.hidden = !stores || !hasFormula;
    selectedFormula.disabled = storeSelection.disabled = substitute.disabled = disabled || !hasFormula;
    if (evaluateButton) evaluateButton.disabled ||= selectionBusy;
    submit.disabled ||= selectionBusy;
  }

  async function recognizeSelected(focus = true) {
    if (busy || selectionBusy || selected === undefined || !state.options.isCurrent()) return;
    const id = selected;
    selectionBusy = true;
    selectionMessage.textContent = local('正在识别圈选公式…', 'Reading the selected formula…');
    refresh();
    let recognized = false;
    try {
      const snapshot = await port.send('snapshotSelection');
      if (closed || selected !== id) return;
      if (!snapshot?.png || snapshot.id !== id) throw Error(local('请重新圈选一段可见公式。', 'Select a visible formula again.'));
      const response = await state.options.recognizeSelection(snapshot.png);
      if (closed || selected !== id || !state.options.isCurrent()) return;
      if (response.status !== 'ready' || typeof response.answer !== 'string' || !response.answer.trim()) {
        throw Error(response.feedback || local('未识别到清晰公式。', 'No clear formula was recognized.'));
      }
      selectedFormula.value = response.answer;
      identified = id;
      selectionMessage.textContent = voiceSubstitute ? local('核对公式后，按 Enter 确认赋值并换元。', 'Check the formula, then press Enter to assign and replace.') :
        local('核对公式后，输入或读出变量名。', 'Check the formula, then type or say the variable name.');
      recognized = true;
    } catch (error) {
      if (!closed && selected === id) selectionMessage.textContent = error.message || ioError();
    } finally {
      selectionBusy = false;
      if (!closed) refresh();
    }
    if (recognized && focus && stores && shown && selected === id && !voiceFieldPending(variable)) {
      variable.focus();
      variable.select();
    }
  }

  async function evaluateSelection() {
    if (busy || selectionBusy || selected === undefined || !state.options.isCurrent()) return;
    const id = selected;
    if (identified !== id) await recognizeSelected(false);
    if (closed || selected !== id || identified !== id || !state.options.isCurrent()) return;
    const part = operand(selectedFormula);
    selectionBusy = true;
    refresh();
    try {
      const value = await calculateSelectedFormula({expression: part.value, config: question.calculate,
        cas: whiteboardCasEnabled(), memory: Object.fromEntries([...session.memory].map(([name, entry]) => [name, entry.value]))});
      if (closed || selected !== id || !state.options.isCurrent()) return;
      selectionMessage.textContent = part.value + ' = ' + value.text;
      showMemory(value.text);
    } catch (error) {
      if (!closed && selected === id) selectionMessage.textContent = error.code === 'expression_required' ?
        local('请选择等式或不等式中要计算的一段。', 'Select the part of the equation or inequality to evaluate.') :
        local('无法计算，请核对识别结果和题目的计算器设置。', 'Check the recognized formula and question calculator settings.');
    } finally {
      selectionBusy = false;
      if (!closed) refresh();
    }
  }

  async function applySelection(replace) {
    if (busy || selectionBusy || selected === undefined || identified !== selected || !state.options.isCurrent()) return;
    const id = selected;
    const name = normalizeVariableName(variable.value);
    const original = selectedFormula.value;
    const part = operand(selectedFormula);
    if (!assignableVariable(name) || !part.value || /[=<>≤≥≠]/u.test(part.value)) {
      selectionMessage.textContent = local('请输入变量名。识别结果含等号或不等号时，请选中其中一段表达式。',
        'Enter a variable name. For an equation or inequality, select the expression to store.');
      return;
    }
    selectionBusy = true;
    refresh();
    try {
      const calculation = await calculateOperand(part.value, name, true);
      if (closed || selected !== id || !state.options.isCurrent()) return;
      if ((calculation.numeric ?? calculation.complex ?? calculation.array ?? calculation.symbolic) == null) throw Error('register');
      if (replace) {
        const text = part.start === part.end ? name : original.slice(0, part.start) + name + original.slice(part.end);
        if (!await port.send('replaceSelection', {id, text})) {
          throw Error(local('选区已变化或公式过长，请重新圈选。', 'The selection changed or the formula is too long. Select it again.'));
        }
      }
      remember(name, calculation);
      if (replace) status.textContent = local('已换元，可在画布撤销。', 'Replaced on the board. Use canvas undo to revert.');
      else selectionMessage.textContent = local('已赋值。', 'Assigned.');
    } catch (error) {
      if (!closed && selected === id) selectionMessage.textContent = error.message === 'register' ?
        local('无法储存这段表达式。请核对识别结果。', 'Check the recognized expression before assigning.') :
        local('无法完成赋值或换元，请核对表达式和圈选范围。', 'Check the expression and selection before assigning or replacing.');
    } finally {
      selectionBusy = false;
      if (!closed) refresh();
    }
  }

  variable.addEventListener('whiteboard-dictation', ({detail}) => {
    if (selected === undefined) return;
    const spoken = detail.trim().replace(/[。.!！?？]+$/u, '');
    const command = spoken.match(/^(赋值给|设为|换元为|替换成)\s*([A-Za-z][A-Za-z0-9_]*|\p{Script=Greek})$/u) ||
      spoken.match(/^(用)\s*([A-Za-z][A-Za-z0-9_]*|\p{Script=Greek})\s*换元$/u);
    if (command) {
      voiceSubstitute = ['换元为', '替换成', '用'].includes(command[1]);
      variable.value = command[2];
    } else if (/^([A-Za-z][A-Za-z0-9_]*|\p{Script=Greek})$/u.test(spoken)) {
      variable.value = spoken;
    } else return;
    if (identified !== selected) void recognizeSelected();
    else selectionMessage.textContent = voiceSubstitute ? local('按 Enter 确认赋值并换元。', 'Press Enter to assign and replace.') :
      local('按 Enter 确认赋值。', 'Press Enter to assign.');
  });
  variable.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || selected === undefined) return;
    event.preventDefault();
    if (identified === selected) void applySelection(voiceSubstitute);
    else void recognizeSelected();
  });

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
    folder.disabled = busy || !ready;
    dismiss.disabled = busy;
    if (ready && !busy) void port.send('lock', !state.options.editable).catch(() => {});
    refreshSelection();
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
      : root || options.standalone ? '' : local('选择本机归档目录后即可保存白板。', 'Choose a local archive folder to save whiteboards.');
  }

  async function submitBoard() {
    if (busy || !ready || !state.options.editable || !state.options.submit) return;
    if (selectionBusy || voiceFieldPending(expression) || voiceFieldPending(variable)) {
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
      if (closed || !state.options.submit || !current.isCurrent()) return;
      await port.send('lock', true);
      const snapshot = await port.send('snapshot');
      session.whiteboardScene = snapshot.scene;
      if (snapshot.empty) {
        status.textContent = local('白板上还没有作答。', 'There is no answer on the whiteboard yet.');
        return;
      }
      await saveWhiteboard(root, current.key, snapshot, session.memory);
      hydrated = true;
      if (closed || !state.options.submit || !current.isCurrent()) return;
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
    if (options.standalone && shown && document.activeElement === launcher) expression.focus({preventScroll: true});
  }).catch(() => {
    if (closed) return;
    loadFailed = true;
    status.textContent = local('白板载入失败，收起后重试。', 'Could not load the whiteboard. Close and reopen it to retry.');
  });
  return state;
}
