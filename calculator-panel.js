import {inheritVoiceContext} from './voice-context.js?v=62993fabc4b9bca0';
import {assignableVariable, basedLogKey, constants, expressionCompletions, expressionExtensions, keypad, levels, memoryRegisters,
  normalizeVariableName, permitsBasedLog, permitsConstant, permitsCustomFunctions, permitsExtension, permitsKey, permitsModule,
  scientificCategories} from './calculator-policy.js?v=62993fabc4b9bca0';
import {calculateImmediate} from './calculator-engine.js?v=62993fabc4b9bca0';
import {toolInputs} from './calculator-inputs.js?v=62993fabc4b9bca0';
import {setInputCompletions} from './autocomplete.js?v=62993fabc4b9bca0';
import {nativeFunctionCompletions} from './formula-catalog.js?v=62993fabc4b9bca0';
import {answerTarget, answerConversionChange} from './answer-conversion.js?v=62993fabc4b9bca0';

let active = null;
const create = (tag, className = '', text) => {
  const item = document.createElement(tag);
  item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
};
const button = (text, callback, type = 'button', cls = 'calculatorControl') => {
  const item = create('button', cls, text);
  item.type = type;
  if (callback) item.addEventListener('click', callback);
  return item;
};

function label(parent, title, control) {
  const item = create('label', 'calculatorField');
  item.append(create('span', '', title), control);
  parent.append(item);
}

function chart(points, title) {
  const canvas = create('canvas', 'calculatorChart');
  canvas.width = 720; canvas.height = 420;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', title);
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const x0 = points[0][0], x1 = points.at(-1)[0];
  const sorted = points.map(([, y]) => y).filter(Number.isFinite).sort((a, b) => a - b);
  let y0 = sorted[Math.floor(sorted.length * .03)], y1 = sorted[Math.floor(sorted.length * .97)];
  const centerRange = y1 - y0;
  if (sorted.at(-1) - sorted[0] < 2 * centerRange) [y0, y1] = [sorted[0], sorted.at(-1)];
  if (y0 === y1) { y0 -= Math.max(1, Math.abs(y0) * .1); y1 += Math.max(1, Math.abs(y1) * .1); }
  if (!Number.isFinite(y1 - y0)) { y0 /= 2; y1 /= 2; }
  const left = 72, right = 694, top = 22, bottom = 370;
  const px = x => left + (x - x0) / (x1 - x0) * (right - left);
  const py = y => bottom - (y - y0) / (y1 - y0) * (bottom - top);
  const theme = getComputedStyle(document.documentElement);
  context.strokeStyle = theme.getPropertyValue('--control-border');
  context.fillStyle = theme.getPropertyValue('--ma-ink');
  context.font = '17px system-ui';
  const line = (x0, y0, x1, y1) => {
    context.beginPath(); context.moveTo(x0, y0); context.lineTo(x1, y1); context.stroke();
  };
  const format = v => Number(v.toPrecision(3)).toString();
  for (let i = 0; i <= 4; i++) {
    const x = left + (right - left) * i / 4, y = bottom - (bottom - top) * i / 4;
    line(x, top, x, bottom); line(left, y, right, y);
    context.fillText(format(x0 + (x1 - x0) * i / 4), x - 14, bottom + 28);
    context.fillText(format(y0 + (y1 - y0) * i / 4), 5, y + 5);
  }
  context.save();
  context.beginPath(); context.rect(left, top, right - left, bottom - top); context.clip();
  context.strokeStyle = theme.getPropertyValue('--muted-accent-border');
  if (x0 <= 0 && x1 >= 0) line(px(0), top, px(0), bottom);
  if (y0 <= 0 && y1 >= 0) line(left, py(0), right, py(0));
  context.strokeStyle = theme.getPropertyValue('--ma-blue'); context.lineWidth = 3;
  context.beginPath();
  let previous = null;
  for (const [x, y] of points) {
    if (y === null) { previous = null; continue; }
    const bounded = Math.max(y0 - (y1 - y0), Math.min(y1 + (y1 - y0), y));
    if (previous === null || Math.abs(y - previous) > (y1 - y0) * .8) context.moveTo(px(x), py(bounded));
    else context.lineTo(px(x), py(bounded));
    previous = y;
  }
  context.stroke(); context.restore();
  return canvas;
}

const resultLabels = {
  n: ['样本数', 'Count'], mean: ['均值', 'Mean'], median: ['中位数', 'Median'],
  population_sd: ['总体标准差', 'Population standard deviation'], min: ['最小值', 'Minimum'], max: ['最大值', 'Maximum'],
  slope: ['斜率', 'Slope'], intercept: ['截距', 'Intercept'], r2: ['决定系数 R²', 'R²'],
  labels: ['类别顺序', 'Class order'], matrix: ['混淆矩阵（行是真实标签）', 'Confusion matrix (actual labels in rows)'],
  accuracy: ['准确率', 'Accuracy'], precision: ['各类精确率', 'Precision per class'],
  recall: ['各类召回率', 'Recall per class'], f1: ['各类 F1', 'F1 per class'],
  explained_variance: ['解释方差比例', 'Explained variance ratio'], scores: ['投影坐标', 'Projected scores'],
  current_a: ['电流 (A)', 'Current (A)'], time_s: ['时间常数 (s)', 'Time constant (s)'],
  pressure_pa: ['压强 (Pa)', 'Pressure (Pa)'], frequency_hz: ['频率 (Hz)', 'Frequency (Hz)'], amplitude: ['幅值', 'Amplitude'],
  degrees: ['月相角 (°)', 'Phase angle (°)'], distance_m: ['距离 (m)', 'Distance (m)'],
  bearing_deg: ['起点方位角 (°)', 'Initial bearing (°)'], result: ['目标值', 'Objective'],
  richness: ['丰富度', 'Richness'], shannon: ['Shannon 指数', 'Shannon index'], simpson: ['Simpson 指数', 'Simpson index'],
};
const errors = {
  restricted: ['当前题目未开放此运算。', 'This operation is unavailable for this question.'],
  unassigned: ['请点击「变量值」，并填写原式中每个未储存变量的值。', 'Select Variable values and enter the missing values.'],
  storage_required: ['请先给要更新的变量储存一个数值。', 'Store a value in the variable before updating it.'],
  function_definition: ['请输入函数定义，例如 F = X + 1 或 F(X, Y) = X + Y。', 'Enter a function definition, such as F = X + 1 or F(X, Y) = X + Y.'],
  function_arguments: ['请检查函数名与括号中的参数个数。', 'Check the function name and number of arguments.'],
  invalid: ['请检查输入格式及参数。', 'Check the input format and parameters.'],
  domain: ['输入超出定义域，或结果无有限数值。', 'Outside the domain or no finite result.'],
  limit: ['输入或计算规模超出范围。', 'The input or calculation is too large.'],
  convergence: ['计算未收敛。', 'The calculation did not converge.'],
  unsupported: ['当前引擎无法给出此符号结果。', 'The engine could not find a symbolic result.'],
  timeout: ['计算超时。可缩小输入范围后重试。', 'Calculation timed out. Try a smaller input.'],
};
const renderValue = value => Array.isArray(value) ? '[' + value.map(renderValue).join(', ') + ']'
  : value == null || typeof value === 'number' && !Number.isFinite(value) ? '—'
  : typeof value === 'number' ? Number(value.toPrecision(13)).toString() : String(value);

// Move the decimal point in the displayed digits, preserving their precision.
export function expandScientificNotation(text) {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d{1,3})$/i.exec(text);
  if (!match) return null;
  const [, sign, whole, fraction = '', power] = match;
  const exponent = Number(power);
  if (exponent < -324 || exponent > 308) return null;
  const digits = whole + fraction;
  const point = whole.length + exponent;
  if (point <= 0) return sign + '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return sign + digits.padEnd(point, '0');
  return sign + digits.slice(0, point) + '.' + digits.slice(point);
}

export function openCalculator(launch, config, [module, zh, en, operations], english, session) {
  if (active?.launch === launch) return;
  active?.close(false);
  const local = (zh, en) => english ? en : zh;
  const toolRow = launch.closest('.questionToolRow');
  const dialog = create('dialog', 'questionCalculator');
  dialog.dataset.module = module;
  dialog.setAttribute('aria-labelledby', 'questionCalculatorTitle');
  const headline = create('header', 'calculatorHeader');
  const title = create('h2', '', local(zh, en)); title.id = 'questionCalculatorTitle';
  const closeButton = button('×', () => close(true), 'button', 'calculatorControl calculatorClose');
  closeButton.setAttribute('aria-label', local('关闭计算器', 'Close calculator'));
  headline.append(title, closeButton); dialog.append(headline);

  const content = create('div', 'calculatorContent');
  const output = create('div', 'calculatorResult');
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  const resultLine = create('div', 'calculatorResultLine');
  const resultFormatAllowed = permitsKey(config, 'result_notation');
  let originalResult, decimalResult;
  const format = button('↻', () => {
    const decimal = format.getAttribute('aria-pressed') === 'false';
    format.setAttribute('aria-pressed', String(decimal));
    output.textContent = decimal ? decimalResult : originalResult;
  }, 'button', 'calculatorControl calculatorFormat');
  format.setAttribute('aria-label', local('切换结果格式', 'Toggle result format'));
  format.title = local('切换科学计数法和普通十进制', 'Switch between scientific and plain decimal notation');
  format.dataset.calculatorKey = 'result_notation';
  format.hidden = true;
  resultLine.append(format, output);
  dialog.append(content, resultLine);

  function showText(text, result = false) {
    output.textContent = text;
    originalResult = text;
    decimalResult = result && resultFormatAllowed ? expandScientificNotation(text) : null;
    format.hidden = !decimalResult;
    format.setAttribute('aria-pressed', 'false');
  }

  let worker, timer, warming, runningControl, working = false, closed = false;
  const {saved, history} = session;
  let answer = module === 'expression' ? session.expressionAnswer : null, transferring = false, edit = 0;
  let registerCandidate = answer ? session.expressionRegisterCandidate : null;
  const memory = session.memory;
  let refreshMemory = () => {}, cancelMemory = () => false, remember = () => {}, finishDefinition = () => {};
  const workspace = launch.closest('.questionWorkspace');
  inheritVoiceContext(dialog, workspace);
  const target = () => workspace && answerTarget(workspace);
  const transferStatus = create('span', 'calculatorTransferStatus');
  transferStatus.setAttribute('role', 'status');
  const destination = create('span', 'calculatorDestination');
  const recorded = create('span', 'calculatorRecorded');
  recorded.setAttribute('role', 'status');
  const record = button(local('记录', 'Record'), () => {
    const state = target()?.calculatorState();
    if (!state || !answer || working || transferring) return;
    state.records.push(...answer.split('\n'));
    transferStatus.textContent = ''; refreshTransfer();
  });
  const undo = button(local('撤回末值', 'Undo last'), () => {
    target()?.calculatorState().records.pop();
    transferStatus.textContent = ''; refreshTransfer();
  }, 'button', 'calculatorUndo');
  const transfer = button(local('转换', 'Convert'), async () => {
    const editor = target();
    if (!editor || !answer || transferring) return;
    const {start, count, records} = editor.calculatorState(), size = records.length + answer.split('\n').length, version = edit;
    transferring = true; transferStatus.textContent = ''; refreshTransfer();
    const applied = await editor.convertCalculator(answer, () => !closed && target() === editor && version === edit);
    if (closed) return;
    transferring = false;
    transferStatus.dataset.state = applied ? 'success' : 'error';
    const range = size === 1 ? String(start + 1) : (start + 1) + '–' + (start + size);
    transferStatus.textContent = applied ? (count ? local('已填入第 ' + range + ' 空。', 'Filled blank ' + range + '.')
      : local('已填入答题控件。', 'Answer controls updated.'))
      : local('未能填入，请核对结果与目标后重试。', 'Check the values and destination, then try again.');
    refreshTransfer();
  });
  const footer = create('div', 'calculatorTransfer');
  const details = create('div', 'calculatorTransferDetails'), actions = create('div', 'calculatorTransferActions');
  details.append(destination, recorded, undo, transferStatus);
  actions.append(record, transfer); footer.append(details, actions); dialog.append(footer);
  function refreshTransfer() {
    const state = target()?.calculatorState();
    footer.hidden = !state;
    if (!state) return;
    const {records, start, selected, count} = state, size = answer?.split('\n').length || 1;
    const remaining = count - start;
    destination.textContent = !count ? '' : remaining === 0 ? local('已到最后一空，点选题中空位可改填。', 'Select a blank to fill it again.')
      : (selected === null ? local('下一空', 'Next blank') : local('已选空位', 'Selected blank')) + ' · ' + (start + 1) + ' / ' + count;
    recorded.textContent = records.length ? local('已记录', 'Recorded') + ' · ' + records.join('，') : '';
    undo.hidden = !records.length; undo.disabled = transferring;
    const unavailable = !answer || working || transferring;
    record.disabled = unavailable || (count && records.length + size >= remaining);
    transfer.disabled = unavailable || (count && records.length + size > remaining);
    transfer.textContent = transferring ? local('转换中…', 'Converting…') : local('转换', 'Convert');
  }
  function setAnswer(value, candidate = null) {
    answer = value;
    registerCandidate = candidate;
    if (module === 'expression') {
      session.expressionAnswer = value;
      session.expressionRegisterCandidate = candidate;
    }
    refreshMemory();
    transferStatus.textContent = '';
    refreshTransfer();
  }
  let renderHistory = () => {};
  const observe = new MutationObserver(() => {
    if (!launch.isConnected) close(false);
  });
  const narrow = matchMedia('(width < 1100px)');
  const measure = () => {
    if (narrow.matches && toolRow) dialog.style.setProperty('--calculator-toolbar-bottom',
      Math.ceil(toolRow.getBoundingClientRect().bottom) + 'px');
  };
  const resizeTools = new ResizeObserver(measure);
  function stop() {
    clearTimeout(timer);
    clearTimeout(warming);
    warming = null;
    worker?.terminate();
    worker = null;
    if (runningControl) runningControl.disabled = false;
    runningControl = null;
    working = false;
  }
  function startWorker() {
    return worker ||= new Worker(new URL('./calculator-worker.js?v=62993fabc4b9bca0', import.meta.url), {type: 'module'});
  }
  function warmOnInput(event, sourceModule) {
    if (warming || event.target.matches('.calculatorStorageName')) return;
    if (sourceModule === 'expression' && !(/[\p{L}]\s*\(|\^|√/u).test(event.target.value || '')) return;
    warming = setTimeout(() => {
      warming = null;
      if (closed) return;
      try {
        if (!worker) startWorker().onerror = event => { event.preventDefault(); stop(); };
        worker.postMessage({warmup: true, module: sourceModule, expression: event.target.value || ''});
      } catch { stop(); }
    }, 80);
  }
  function close(returnFocus) {
    if (closed) return;
    closed = true;
    observe.disconnect(); resizeTools.disconnect(); window.removeEventListener('resize', measure);
    document.removeEventListener(answerConversionChange, refreshTransfer);
    stop();
    dialog.close(); dialog.remove();
    if (toolRow) delete toolRow.dataset.calculatorOpen;
    launch.setAttribute('aria-expanded', 'false');
    if (returnFocus && launch.isConnected) launch.focus({preventScroll: true});
    if (active?.launch === launch) active = null;
  }
  const showError = code => {
    setAnswer(null);
    const error = errors[code] || errors.invalid;
    output.dataset.state = 'error';
    showText(local(...error));
  };
  function show(result) {
    output.dataset.state = 'success';
    format.hidden = true;
    if (result.plot) output.replaceChildren(chart(result.plot, local('函数图像', 'Function graph')));
    else if (result.entries) {
      const data = create('dl', 'calculatorResultRows');
      for (const [key, value] of result.entries) {
        data.append(create('dt', '', resultLabels[key] ? local(...resultLabels[key]) : key),
          create('dd', '', renderValue(value)));
      }
      output.replaceChildren(data);
    } else showText(result.text, true);
    const values = result.entries?.map(([, value]) => renderValue(value));
    setAnswer(result.text || (values?.length === 1 ? values[0] : values?.join('\n')) || null,
      result.numeric ?? result.complex ?? result.array ?? null);
  }
  function run(sourceModule, operation, input, control, receive) {
    if (working || control.disabled) return;
    const version = edit;
    const registers = Object.fromEntries([...memory].map(([name, entry]) => [name, entry.value]));
    function complete(result) {
      if (receive) { receive(result); return; }
      if (module === 'expression') {
        const numeric = result.numeric ?? result.complex ?? result.array;
        if (numeric !== undefined) session.previousAnswer = numeric;
        if (result.register) remember(result.register, {value: result.definition ?? numeric, text: result.text});
      }
      if (sourceModule === 'expression' || operation === 'simplify' || operation === 'modular_power') {
        history.push({expression: input.expression, assignments: input.assignments, defineFunction: input.defineFunction,
          result: result.text, modulus: input.modulus});
        if (history.length > 12) history.shift();
        renderHistory();
      }
      if (result.definition) {
        finishDefinition();
        setAnswer(null);
        output.dataset.state = 'success';
        showText(result.text);
        return;
      }
      show(result);
      if (control.closest('.calculatorExtensionForm')) {
        dialog.scrollTop = 0;
        if (document.activeElement === control) {
          output.tabIndex = -1;
          output.focus({preventScroll: true});
        }
      }
    }
    if (sourceModule === 'expression' && operation === 'evaluate') {
      try {
        const result = calculateImmediate(input.expression, config, registers, session.previousAnswer, input.defineFunction);
        if (result) { complete(result); return; }
      } catch (error) { showError(error.code); return; }
    }
    working = true; control.disabled = true;
    runningControl = control;
    setAnswer(null);
    output.dataset.state = 'busy'; showText(local('计算中…', 'Calculating…'));
    const finish = () => { clearTimeout(timer); working = false; runningControl = null; control.disabled = false; };
    try {
      startWorker();
      worker.onmessage = ({data}) => {
        finish();
        if (!launch.isConnected || closed) return;
        if (version !== edit) { showText(''); refreshTransfer(); return; }
        if (data.error) { showError(data.error); return; }
        complete(data.result);
      };
      worker.onerror = event => { event.preventDefault(); stop(); finish(); showError('invalid'); };
      timer = setTimeout(() => { stop(); finish(); showError('timeout'); }, 8000);
      worker.postMessage({config, module: sourceModule, operation, input, degrees: session.degrees, answer: session.previousAnswer,
        memory: registers});
    } catch { stop(); finish(); showError('invalid'); }
  }

  function toolForm(selectedModule, specs) {
    const form = create('form', 'calculatorForm');
    const method = create('select');
    for (const [id, zh, en] of specs) {
      const option = create('option', '', local(zh, en));
      option.value = id; option.disabled = !permitsKey(config, id);
      method.append(option);
    }
    const savedMethod = saved.get(selectedModule);
    method.value = specs.some(([id]) => id === savedMethod && permitsKey(config, id)) ? savedMethod
      : [...method.options].find(option => !option.disabled).value;
    if (specs.length > 1) label(form, local('运算', 'Operation'), method);
    const fields = create('div', 'calculatorToolFields');
    form.append(fields);
    function renderFields() {
      saved.set(selectedModule, method.value);
      const spec = specs.find(([id]) => id === method.value)[3];
      const prefix = selectedModule + '/' + method.value + '/';
      const {outer, fillExample} = toolInputs(spec, {module: selectedModule, operation: method.value, local, config,
        get: id => saved.get(prefix + id) || '', set: (id, value) => saved.set(prefix + id, value)});
      const actions = create('div', 'calculatorToolActions');
      actions.append(button(local('填入示例', 'Fill example'), () => { edit++; setAnswer(null); fillExample(); }),
        button(local('计算结果', 'Calculate'), null, 'submit', 'calculatorControl calculatorPrimary'));
      fields.replaceChildren(outer, actions);
    }
    form.addEventListener('input', event => { edit++; setAnswer(null); warmOnInput(event, selectedModule); }, true);
    method.addEventListener('change', () => { stop(); showText(''); delete output.dataset.state; renderFields(); });
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(selectedModule, method.value, Object.fromEntries(new FormData(form)), fields.querySelector('[type="submit"]'));
    });
    renderFields();
    return form;
  }

  function worksheet() {
    if (module === 'expression') {
      const form = create('div', 'calculatorForm');
      const invalidate = () => { edit++; setAnswer(null); };
      form.addEventListener('input', event => {
        if (!event.target.closest('form') && !event.target.matches('.calculatorStorageName')) {
          invalidate();
          warmOnInput(event, module);
        }
      }, true);
      const input = create('input', 'calculatorExpression');
      input.type = 'text'; input.maxLength = 1024; input.spellcheck = false; input.autocomplete = 'off';
      input.value = saved.get(module) || '';
      input.placeholder = '2 × (3 + 4)';
      const memoryAllowed = permitsKey(config, 'memory_registers');
      const functionsAllowed = permitsCustomFunctions(config);
      const candidates = term => {
        const builtins = expressionCompletions(config, {previousAnswer: session.previousAnswer != null, extensions: true});
        if (!functionsAllowed) return builtins;
        const names = nativeFunctionCompletions(term, memory);
        const exactCase = /^[A-Z]/.test(term.replace(/^\\/, ''));
        const all = exactCase ? [...names, ...builtins] : [...builtins, ...names];
        return [...new Map(all.map(item => [item.value, item])).values()];
      };
      setInputCompletions(input, candidates);
      let focused = input, assign, defining = false;
      const display = create('div', 'calculatorDisplay');
      label(display, local('表达式', 'Expression'), input);
      const variableFields = create('div', 'calculatorAssignments');
      variableFields.id = 'calculatorAssignments';
      showText(answer || history.at(-1)?.result || '0', true);
      display.append(variableFields, resultLine); form.append(display);
      const currentAssignments = () => session.assignmentDraft?.expression === input.value
        ? session.assignmentDraft.values : null;
      function renderAssignments() {
        const values = defining ? null : currentAssignments();
        const unstored = [...(values ?? [])].filter(([name]) => !memory.has(name));
        variableFields.replaceChildren();
        variableFields.hidden = !unstored.length;
        assign?.setAttribute('aria-expanded', String(!variableFields.hidden));
        for (const [name, value] of unstored) {
          const field = create('input', 'calculatorAssignmentValue');
          field.type = 'text'; field.maxLength = 1024; field.spellcheck = false; field.autocomplete = 'off';
          field.value = value;
          field.setAttribute('aria-label', local('变量 ', 'Variable ') + name);
          setInputCompletions(field, candidates);
          field.addEventListener('focus', () => { focused = field; });
          field.addEventListener('input', () => values.set(name, field.value));
          const row = create('label', 'calculatorAssignment');
          row.append(create('span', '', name + ' ='), field);
          variableFields.append(row);
        }
      }
      input.addEventListener('focus', () => { focused = input; });
      input.addEventListener('input', () => { saved.set(module, input.value); renderAssignments(); });
      const activeField = () => focused.isConnected && !(focused === modulus && modularFields.hidden) ? focused : input;
      const insert = (value, selection) => {
        const field = activeField();
        const start = field.selectionStart ?? field.value.length;
        field.setRangeText(value, start, field.selectionEnd ?? start, 'end');
        if (selection) field.setSelectionRange(start + selection[0], start + selection[1]);
        field.focus();
        field.dispatchEvent(new Event('input', {bubbles: true}));
      };
      const options = create('div', 'calculatorOptions');
      const [logId, logLabel, logInsertion] = basedLogKey;
      const logBase = button(logLabel, () => insert(logInsertion), 'button', 'calculatorKey');
      logBase.dataset.calculatorKey = logId;
      logBase.disabled = !permitsBasedLog(config);
      logBase.setAttribute('aria-label', local('指定底数的对数', 'Logarithm with a base'));
      logBase.title = 'log_2(8)';
      options.append(logBase);
      if (permitsKey(config, 'angle', 2)) {
        const angle = button(session.degrees ? 'DEG' : 'RAD', event => {
          session.degrees = !session.degrees; event.currentTarget.textContent = session.degrees ? 'DEG' : 'RAD'; invalidate();
        });
        angle.setAttribute('aria-label', local('切换角度单位', 'Switch angle units'));
        options.append(angle);
      }
      if (permitsModule(config, 'constants')) {
        const entries = Object.keys(constants).filter(key => permitsConstant(config, key));
        if (entries.length) {
          const chooser = create('select');
          chooser.setAttribute('aria-label', local('选择常数', 'Select constant'));
          chooser.append(create('option', '', local('常数', 'Constants')));
          chooser.options[0].value = '';
          for (const key of entries) {
            const [symbol, zh, en, value, unit] = constants[key];
            const option = create('option', '', symbol + ' · ' + local(zh, en)
              + (unit ? ' · ' + value + ' ' + unit : ''));
            option.value = key; chooser.append(option);
          }
          chooser.addEventListener('change', () => {
            if (chooser.value) insert(chooser.value);
            chooser.value = '';
          });
          options.append(chooser);
        }
      }
      if (permitsKey(config, 'assign_variables', 2)) {
        assign = button(local('变量值', 'Variable values'), () => {
          const expression = input.value;
          run(module, 'assign_variables', {expression}, assign, ({variables}) => {
            delete output.dataset.state;
            setAnswer(null);
            if (expression !== input.value) return;
            const previous = session.assignmentDraft?.values;
            session.assignmentDraft = {expression, values: new Map(variables.map(name => [name, previous?.get(name) || '']))};
            renderAssignments();
            if (variables.length) {
              showText(history.at(-1)?.result || '0', true);
              variableFields.querySelector('input').focus();
            } else showText(local('表达式没有待赋值的变量。', 'The expression has no variables to assign.'));
          });
        });
        assign.dataset.calculatorKey = 'assign_variables';
        assign.setAttribute('aria-controls', variableFields.id);
      }
      renderAssignments();
      const numericPad = create('div', 'calculatorNumericPad');
      numericPad.append(options);
      form.append(numericPad);
      const definitionHint = create('div', 'calculatorDefinitionHint', 'F = X + 1 · F(X,Y) = X + Y');
      definitionHint.id = 'calculatorDefinitionHint';
      definitionHint.hidden = true;
      display.append(definitionHint);
      const define = button(local('定义函数', 'Define function'), () => {
        cancelMemory();
        invalidate();
        setDefinition(!defining);
        input.focus();
      });
      define.dataset.calculatorKey = 'define_function';
      define.setAttribute('aria-pressed', 'false');
      function setDefinition(enabled) {
        defining = enabled && functionsAllowed;
        define.setAttribute('aria-pressed', String(defining));
        definitionHint.hidden = !defining;
        if (defining) input.setAttribute('aria-describedby', definitionHint.id);
        else input.removeAttribute('aria-describedby');
        if (assign) assign.disabled = defining;
        renderAssignments();
      }
      finishDefinition = () => setDefinition(false);
      let modulus, remainder, modularFields, modular;
      if (permitsModule(config, 'modular') && permitsKey(config, 'modular_power')) {
        modularFields = create('div', 'calculatorModular');
        modularFields.id = 'calculatorModular';
        modularFields.hidden = true;
        modular = button(local('精确模幂', 'Mod pow'), () => {
          modularFields.hidden = !modularFields.hidden;
          modular.setAttribute('aria-expanded', String(!modularFields.hidden));
          if (!modularFields.hidden) modulus.focus();
        });
        modular.setAttribute('aria-expanded', 'false');
        modular.setAttribute('aria-controls', modularFields.id);
        modular.title = local('精确模幂', 'Exact modular power');
        modular.setAttribute('aria-label', modular.title);
        modular.dataset.calculatorKey = 'modular_power';
        modulus = create('input');
        modulus.type = 'text'; modulus.maxLength = 2048; modulus.inputMode = 'numeric';
        modulus.dataset.autocomplete = 'off';
        modulus.value = saved.get('modular/modular_power/modulus') || '';
        modulus.addEventListener('focus', () => { focused = modulus; });
        modulus.addEventListener('input', () => saved.set('modular/modular_power/modulus', modulus.value));
        remainder = button(local('取模', 'Find remainder'), () => run('modular', 'modular_power',
          {expression: input.value, modulus: modulus.value}, remainder));
        label(modularFields, local('正整数模数', 'Positive modulus'), modulus);
        modularFields.append(remainder); options.append(modular); numericPad.append(modularFields);
      }
      const keys = create('div', 'calculatorKeys');
      let equals;
      for (const [key, name, insertion, minimum = 1] of keypad) {
        if (levels.indexOf(config.level) < minimum) continue;
        const action = key === 'evaluate' ? () => run(module, 'evaluate', {
          expression: input.value, assignments: Object.fromEntries(currentAssignments() || []), defineFunction: defining,
        }, equals) : () => {
          if (key === 'clear') {
            stop(); equals.disabled = !permitsKey(config, 'evaluate');
            setDefinition(false);
            setAnswer(null);
            const field = activeField();
            if (field === input) session.assignmentDraft = null;
            field.value = ''; field.dispatchEvent(new Event('input'));
            showText('0'); delete output.dataset.state; field.focus(); return;
          }
          if (key === 'backspace') {
            const field = activeField();
            if (field.selectionStart === field.selectionEnd && field.selectionStart > 0)
              field.setSelectionRange(field.selectionStart - 1, field.selectionEnd);
            insert(''); return;
          }
          insert(insertion);
        };
        const keyButton = button(name, action, 'button', 'calculatorKey');
        keyButton.dataset.calculatorKey = key;
        keyButton.disabled = !permitsKey(config, key, minimum);
        if (key === 'evaluate') {
          equals = keyButton; keyButton.classList.add('calculatorPrimary');
          keyButton.setAttribute('aria-label', local('计算结果', 'Evaluate'));
        }
        if (key === 'backspace') keyButton.setAttribute('aria-label', local('退格', 'Backspace'));
        if (key === 'clear') keyButton.setAttribute('aria-label', local('清空当前输入', 'Clear current input'));
        keys.append(keyButton);
      }
      numericPad.append(keys);
      const headerTools = create('div', 'calculatorHeaderTools');
      let simplify;
      if (permitsModule(config, 'symbolic') && permitsKey(config, 'simplify')) {
        simplify = button(local('化简', 'Simplify'), () => {
          cancelMemory();
          run('symbolic', 'simplify', {expression: input.value}, simplify);
        });
        simplify.dataset.calculatorKey = 'simplify';
      }
      if (levels.indexOf(config.level) >= 2) {
        const extra = create('details', 'calculatorMore');
        extra.append(create('summary', '', local('更多科学函数', 'More scientific functions')));
        const categories = scientificCategories(config);
        const functions = create('div', 'calculatorExtensionKeys');
        const worksheetSlot = create('div', 'calculatorExtensionForm');
        const category = create('select');
        for (const [id, zh, en] of [['common', '一元函数', 'Unary functions'], ['multi', '多元函数', 'Multivariable functions'], ...categories]) {
          const option = create('option', '', local(zh, en)); option.value = id; category.append(option);
        }
        category.value = saved.get('scientific-category') || 'common';
        if (!category.value) category.value = 'common';
        label(extra, local('类别', 'Category'), category);
        function renderCategory() {
          saved.set('scientific-category', category.value);
          functions.replaceChildren(); worksheetSlot.replaceChildren();
          if (category.value === 'common' || category.value === 'multi') {
            const specs = category.value === 'common'
              ? [['sinh', 'sinh'], ['cosh', 'cosh'], ['tanh', 'tanh'], ['cbrt', '∛', 'cbrt'],
                ['floor', 'floor'], ['ceil', 'ceil'], ['round', 'round']]
              : [['combinations', 'nCr'], ['permutations', 'nPr'], ['log_base', 'log(x, b)', 'log'], ['round', 'round(x, n)', 'round']];
            for (const [key, name, native = name] of specs) {
              const extraKey = button(name, () => insert(native + '('), 'button', 'calculatorKey');
              extraKey.disabled = !permitsKey(config, key, key === 'log_base' ? 1 : 2)
                || !permitsKey(config, 'open') || !permitsKey(config, 'close')
                || category.value === 'multi' && !permitsKey(config, 'comma');
              extraKey.dataset.calculatorKey = key;
              functions.append(extraKey);
            }
            return;
          }
          const [id, , , specs] = categories.find(([id]) => id === category.value);
          for (const [key, zh, en] of specs) {
            if (!expressionExtensions.has(key) || !permitsExtension(config, id, key)) continue;
            const [, fields] = expressionExtensions.get(key);
            const signature = key + '(' + fields.map(([name]) => name).join(', ') + ')';
            const extensionKey = button(local(zh, en), () => {
              const field = activeField() === modulus ? input : activeField();
              focused = field;
              const selected = field.value.slice(field.selectionStart, field.selectionEnd);
              const args = fields.map(([, example], index) => index === 0 && selected ? selected : example).join(', ');
              insert(key + '(' + args + ')', [key.length + 1, key.length + 1 + args.length]);
            }, 'button', 'calculatorKey');
            extensionKey.dataset.calculatorKey = key;
            extensionKey.title = signature;
            functions.append(extensionKey);
          }
          if (functions.childElementCount) {
            const details = create('details', 'calculatorExtensionDetails');
            details.append(create('summary', '', local('表单输入', 'Form input')));
            details.addEventListener('toggle', () => {
              if (details.open && details.childElementCount === 1) details.append(toolForm(id, specs));
            });
            worksheetSlot.append(details);
          } else worksheetSlot.append(toolForm(id, specs));
        }
        category.addEventListener('change', renderCategory);
        extra.append(functions, worksheetSlot); numericPad.append(extra);
        extra.addEventListener('toggle', () => {
          if (extra.open && !functions.childElementCount && !worksheetSlot.childElementCount) renderCategory();
        });
      }
      if (memoryAllowed) {
        const memoryPad = create('div', 'calculatorRegisterPad');
        const legend = create('span');
        const status = create('div', 'srOnly');
        status.setAttribute('role', 'status');
        const letters = create('div', 'calculatorKeys calculatorRegisterKeys');
        const heading = create('div', 'calculatorRegisterHeading');
        const back = button(local('返回', 'Back'), () => cancelMemory());
        heading.append(legend, back);
        memoryPad.id = 'calculatorRegisterPad';
        memoryPad.hidden = true;
        memoryPad.append(heading, letters);
        form.append(memoryPad, status);
        let mode = '';
        const storageRow = create('div', 'calculatorStorageRow');
        const storageName = create('input', 'calculatorStorageName');
        storageName.type = 'text'; storageName.maxLength = 48; storageName.autocomplete = 'off';
        storageName.dataset.autocomplete = 'off';
        storageName.spellcheck = false;
        storageName.placeholder = 'α, x₁, v²';
        storageName.setAttribute('aria-label', local('储存变量名', 'Storage variable name'));
        const saveStorage = button(local('保存', 'Save'), storeNamed);
        const cancelStorage = button(local('取消', 'Cancel'), () => cancelMemory());
        const openStorage = button(local('储存', 'Store'), () => {
          storageName.setCustomValidity('');
          storageName.value = '';
          storageRow.hidden = false;
          openPad('store');
          storageName.focus();
        });
        openStorage.setAttribute('aria-controls', memoryPad.id);
        const arrow = create('span', '', '→');
        arrow.setAttribute('aria-hidden', 'true');
        storageRow.append(arrow, storageName, saveStorage, cancelStorage);
        storageRow.hidden = true;
        display.append(storageRow);
        options.append(openStorage);
        storageName.addEventListener('input', () => storageName.setCustomValidity(''));
        storageName.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || event.isComposing) return;
          event.preventDefault();
          storeNamed();
        });
        remember = (name, entry) => {
          memory.set(name, entry);
          renderAssignments();
          status.textContent = local('已存入 ', 'Stored in ') + name;
          if (mode === 'store') {
            closePad();
            input.focus();
          }
          refreshMemory();
        };
        function storeNamed() {
          const name = normalizeVariableName(storageName.value);
          if (!assignableVariable(name)) {
            storageName.setCustomValidity(local('请输入可用的变量名。', 'Enter a valid variable name.'));
            storageName.reportValidity();
            return;
          }
          storeAs(name, saveStorage);
        }
        function storeAs(name, control) {
          if (working) return;
          if (registerCandidate != null) {
            remember(name, {value: registerCandidate, text: output.textContent});
            return;
          }
          run(module, 'evaluate', {expression: name + '=' + input.value,
            assignments: Object.fromEntries(currentAssignments() || [])}, control);
        }
        const copy = button(local('复制', 'Copy'), async () => {
          if (answer == null) return;
          try { await navigator.clipboard.writeText(output.querySelector('dl') ? answer : output.textContent); }
          catch { status.textContent = local('剪贴板不可用。', 'Clipboard unavailable.'); }
        });
        const recall = button('RCL', () => openPad('recall'));
        copy.title = local('复制结果', 'Copy result');
        recall.title = local('调用储值', 'Recall stored value');
        copy.setAttribute('aria-label', copy.title);
        recall.setAttribute('aria-label', recall.title);
        headerTools.append(copy);
        if (simplify) headerTools.append(simplify);
        headerTools.append(recall);
        recall.setAttribute('aria-controls', memoryPad.id);
        refreshMemory = () => {
          copy.disabled = answer == null || working;
          recall.disabled = !memory.size || working;
          recall.setAttribute('aria-expanded', String(mode === 'recall'));
          openStorage.setAttribute('aria-expanded', String(mode === 'store'));
        };
        cancelMemory = () => {
          if (!mode) return false;
          const trigger = mode === 'store' ? openStorage : recall;
          if (runningControl && (memoryPad.contains(runningControl) || storageRow.contains(runningControl))) {
            edit++;
            stop();
            showText('');
            delete output.dataset.state;
          }
          closePad();
          (trigger.disabled ? input : trigger).focus();
          return true;
        };
        function closePad() {
          mode = '';
          storageRow.hidden = true;
          memoryPad.hidden = true;
          numericPad.hidden = false;
          refreshMemory();
        }
        function openPad(nextMode) {
          mode = nextMode;
          if (mode !== 'store') storageRow.hidden = true;
          const recalling = mode === 'recall';
          legend.textContent = recalling ? local('调用已存字母', 'Recall a stored letter') : local('将结果存入字母', 'Store result in a letter');
          const visible = recalling ? [...new Set([...memoryRegisters, ...memory.keys()])] : memoryRegisters;
          letters.replaceChildren(...visible.map(letter => {
            const entry = memory.get(letter);
            const key = button(letter, () => {
              if (mode === 'store') storeAs(letter, key);
              else {
                cancelMemory();
                insert(letter + (Array.isArray(entry.value?.parameters) ? '(' : ''));
              }
            }, 'button', 'calculatorKey');
            key.disabled = recalling && !entry;
            key.setAttribute('aria-label', (recalling ? local('调用 ', 'Recall ') : local('存入 ', 'Store in ')) + letter);
            if (entry) {
              key.append(create('span', 'calculatorRegisterValue', entry.text));
              key.setAttribute('aria-description', entry.text);
            }
            return key;
          }));
          numericPad.hidden = true;
          memoryPad.hidden = false;
          refreshMemory();
          if (mode !== 'store') (letters.querySelector('button:not(:disabled)') || back).focus();
        }
        refreshMemory();
      } else if (simplify) headerTools.append(simplify);
      headerTools.append(closeButton); headline.append(headerTools);
      if (assign || functionsAllowed) {
        const variableActions = create('div', 'calculatorVariableActions');
        if (functionsAllowed) variableActions.append(define);
        if (assign) variableActions.append(assign);
        form.append(variableActions);
      }
      // Adapted from Calc's renderHistory (Matt, MIT), scoped to the current question.
      const historyPane = create('details', 'calculatorHistory');
      const entries = create('ol');
      historyPane.append(create('summary', '', local('本题计算记录', 'Calculation history')), entries);
      renderHistory = () => {
        historyPane.hidden = history.length === 0;
        entries.replaceChildren(...history.slice().reverse().map(({expression, assignments, defineFunction, result, modulus: originalModulus}) => {
          const row = create('li');
          const values = Object.entries(assignments || {});
          const reuse = button('', () => {
            session.assignmentDraft = values.length ? {expression, values: new Map(values)} : null;
            setDefinition(defineFunction);
            if (originalModulus && modulus) {
              modulus.value = originalModulus;
              modulus.dispatchEvent(new Event('input'));
              if (modularFields.hidden) modular.click();
            }
            input.value = expression; input.dispatchEvent(new Event('input')); input.focus();
          });
          const context = originalModulus ? 'mod ' + originalModulus : values.map(([name, value]) => name + ' = ' + value).join(', ');
          reuse.append(create('span', '', context ? expression + '  (' + context + ')' : expression),
            create('strong', '', '= ' + result));
          row.append(reuse); return row;
        }));
      };
      renderHistory(); form.append(historyPane);
      form.addEventListener('keydown', event => {
        if (event.defaultPrevented || event.isComposing || event.key !== 'Enter' || numericPad.hidden) return;
        if (event.target === input || variableFields.contains(event.target) || event.target === modulus) {
          event.preventDefault();
          (event.target === modulus ? remainder : equals).click();
        }
      });
      content.append(form);
    } else content.append(toolForm(module, operations));
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); if (!cancelMemory()) close(true); }
  });
  worksheet();
  refreshTransfer();
  if (toolRow) toolRow.dataset.calculatorOpen = '';
  (content.querySelector('input, textarea') || closeButton).autofocus = true;
  document.body.append(dialog);
  measure();
  dialog.show();
  document.addEventListener(answerConversionChange, refreshTransfer);
  window.addEventListener('resize', measure);
  if (toolRow) resizeTools.observe(toolRow);
  launch.setAttribute('aria-expanded', 'true');
  observe.observe(document.body, {childList: true, subtree: true});
  active = {launch, close};
}
