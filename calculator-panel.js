import {basedLogKey, constants, expressionCompletions, keypad, levels, permitsBasedLog, permitsConstant, permitsKey, permitsModule} from './calculator-policy.js?v=3c49628d0cb4aeef';
import {toolInputs} from './calculator-inputs.js?v=3c49628d0cb4aeef';
import {setInputCompletions} from './autocomplete.js?v=3c49628d0cb4aeef';

let active = null;
let preferredLayout = 'side';
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
  unassigned: ['请点击「赋值」，并填写原式中每个变量的值。', 'Select Assign and enter a value for each variable.'],
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
  const layout = create('div', 'calculatorLayout');
  const layoutToggle = create('div', 'calculatorLayoutToggle');
  const center = button(local('居中', 'Center'), () => setLayout('center'));
  const side = button(local('侧栏', 'Side panel'), () => setLayout('side'));
  const closeButton = button('×', () => close(true));
  closeButton.setAttribute('aria-label', local('关闭计算器', 'Close calculator'));
  layoutToggle.append(center, side);
  layout.append(layoutToggle, closeButton); headline.append(title, layout); dialog.append(headline);

  const content = create('div', 'calculatorContent');
  const output = create('div', 'calculatorResult');
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  dialog.append(content, output);

  let worker, timer, working = false, closed = false;
  const {saved, history} = session;
  let renderHistory = () => {};
  const wide = matchMedia('(min-width: 1100px)');
  const observe = new MutationObserver(() => {
    if (!launch.isConnected) close(false);
  });
  const measure = () => dialog.style.setProperty('--calculator-toolbar-bottom',
    Math.round(toolRow?.getBoundingClientRect().bottom || 0) + 'px');
  const resizeTools = new ResizeObserver(measure);
  if (toolRow) resizeTools.observe(toolRow);
  const onResize = () => setLayout(preferredLayout, false);
  function setLayout(mode, remember = true) {
    if (remember) preferredLayout = mode;
    const dock = mode === 'side' && wide.matches;
    const top = (document.querySelector('.topRibbon')?.getBoundingClientRect().bottom ?? 0) + 4;
    toolRow?.style.setProperty('--calculator-toolbar-top', top + 'px');
    dialog.style.setProperty('--calculator-toolbar-top', top + 'px');
    if (toolRow) toolRow.dataset.calculatorLayout = dock ? 'side' : 'center';
    side.disabled = !wide.matches;
    if (dialog.open && dialog.dataset.layout === (dock ? 'side' : 'center')) return;
    if (dialog.open) dialog.close();
    dialog.dataset.layout = dock ? 'side' : 'center';
    dialog.show();
    measure();
    center.setAttribute('aria-pressed', String(!dock));
    side.setAttribute('aria-pressed', String(dock));
    (dialog.querySelector('input, textarea') || closeButton).focus({preventScroll: true});
  }
  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = null;
    working = false;
  }
  function close(returnFocus) {
    if (closed) return;
    closed = true;
    observe.disconnect(); resizeTools.disconnect(); window.removeEventListener('resize', onResize);
    stop();
    dialog.close(); dialog.remove();
    if (toolRow) {
      delete toolRow.dataset.calculatorLayout;
      toolRow.style.removeProperty('--calculator-toolbar-top');
    }
    launch.setAttribute('aria-expanded', 'false');
    if (returnFocus && launch.isConnected) launch.focus({preventScroll: true});
    if (active?.launch === launch) active = null;
  }
  const showError = code => {
    const error = errors[code] || errors.invalid;
    output.dataset.state = 'error';
    output.textContent = local(...error);
  };
  function show(result) {
    output.dataset.state = 'success';
    if (result.plot) output.replaceChildren(chart(result.plot, local('函数图像', 'Function graph')));
    else if (result.entries) {
      const data = create('dl', 'calculatorResultRows');
      for (const [key, value] of result.entries) {
        data.append(create('dt', '', resultLabels[key] ? local(...resultLabels[key]) : key),
          create('dd', '', renderValue(value)));
      }
      output.replaceChildren(data);
    } else output.textContent = result.text;
  }
  function run(module, operation, input, control, receive) {
    if (working || control.disabled) return;
    working = true; control.disabled = true;
    output.dataset.state = 'busy'; output.textContent = local('计算中…', 'Calculating…');
    const finish = () => { clearTimeout(timer); working = false; control.disabled = false; };
    try {
      worker ||= new Worker(new URL('./calculator-worker.js?v=3c49628d0cb4aeef', import.meta.url), {type: 'module'});
      worker.onmessage = ({data}) => {
        finish();
        if (!launch.isConnected || closed) return;
        if (data.error) { showError(data.error); return; }
        if (receive) { receive(data.result); return; }
        if (module === 'expression') {
          session.previousAnswer = data.result.numeric;
          history.push({expression: input.expression, assignments: input.assignments, result: data.result.text});
          if (history.length > 12) history.shift();
          renderHistory();
        }
        show(data.result);
      };
      worker.onerror = event => { event.preventDefault(); stop(); finish(); showError('invalid'); };
      timer = setTimeout(() => { stop(); finish(); showError('timeout'); }, 8000);
      worker.postMessage({config, module, operation, input, degrees: session.degrees, answer: session.previousAnswer});
    } catch { stop(); finish(); showError('invalid'); }
  }

  function worksheet() {
    const form = create('form', 'calculatorForm');
    if (module === 'expression') {
      const input = create('input', 'calculatorExpression');
      input.type = 'text'; input.maxLength = 1024; input.spellcheck = false; input.autocomplete = 'off';
      input.value = saved.get(module) || '';
      input.placeholder = '2 × (3 + 4)';
      const candidates = () => expressionCompletions(config, {previousAnswer: Number.isFinite(session.previousAnswer)});
      setInputCompletions(input, candidates);
      let focused = input, assign;
      const display = create('div', 'calculatorDisplay');
      label(display, local('表达式', 'Expression'), input);
      const variableFields = create('div', 'calculatorAssignments');
      variableFields.id = 'calculatorAssignments';
      output.textContent = history.at(-1)?.result || '0';
      display.append(variableFields, output); form.append(display);
      const currentAssignments = () => session.assignmentDraft?.expression === input.value
        ? session.assignmentDraft.values : null;
      function renderAssignments() {
        const values = currentAssignments();
        variableFields.replaceChildren();
        variableFields.hidden = !values?.size;
        assign?.setAttribute('aria-expanded', String(!variableFields.hidden));
        if (!values) return;
        for (const [name, value] of values) {
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
      const insert = value => {
        const field = focused.isConnected ? focused : input;
        const start = field.selectionStart ?? field.value.length;
        field.setRangeText(value, start, field.selectionEnd ?? start, 'end');
        field.dispatchEvent(new Event('input'));
        field.focus();
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
          session.degrees = !session.degrees; event.currentTarget.textContent = session.degrees ? 'DEG' : 'RAD';
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
        assign = button(local('赋值', 'Assign'), () => {
          const expression = input.value;
          run(module, 'assign_variables', {expression}, assign, ({variables}) => {
            output.textContent = history.at(-1)?.result || '0';
            delete output.dataset.state;
            if (expression !== input.value) return;
            const previous = session.assignmentDraft?.values;
            session.assignmentDraft = {expression, values: new Map(variables.map(name => [name, previous?.get(name) || '']))};
            renderAssignments();
            if (variables.length) variableFields.querySelector('input').focus();
            else output.textContent = local('表达式没有待赋值的变量。', 'The expression has no variables to assign.');
          });
        });
        assign.dataset.calculatorKey = 'assign_variables';
        assign.setAttribute('aria-controls', variableFields.id);
        options.append(assign);
      }
      renderAssignments();
      form.append(options);
      const keys = create('div', 'calculatorKeys');
      let equals;
      for (const [key, name, insertion, minimum = 1] of keypad) {
        if (levels.indexOf(config.level) < minimum) continue;
        const action = key === 'evaluate' ? null : () => {
          if (key === 'clear') {
            stop(); equals.disabled = !permitsKey(config, 'evaluate');
            if (assign) assign.disabled = false;
            const field = focused.isConnected ? focused : input;
            if (field === input) session.assignmentDraft = null;
            field.value = ''; field.dispatchEvent(new Event('input'));
            output.textContent = '0'; delete output.dataset.state; field.focus(); return;
          }
          if (key === 'backspace') {
            const field = focused.isConnected ? focused : input;
            if (field.selectionStart === field.selectionEnd && field.selectionStart > 0)
              field.setSelectionRange(field.selectionStart - 1, field.selectionEnd);
            insert(''); return;
          }
          insert(insertion);
        };
        const keyButton = button(name, action, key === 'evaluate' ? 'submit' : 'button', 'calculatorKey');
        keyButton.dataset.calculatorKey = key;
        keyButton.dataset.kind = key.startsWith('digit_') ? 'number'
          : ['add', 'subtract', 'divide', 'multiply', 'power'].includes(key) ? 'operator' : 'function';
        keyButton.disabled = !permitsKey(config, key, minimum);
        if (key === 'evaluate') {
          equals = keyButton; keyButton.classList.add('calculatorPrimary');
          keyButton.setAttribute('aria-label', local('计算结果', 'Evaluate'));
        }
        if (key === 'backspace') keyButton.setAttribute('aria-label', local('退格', 'Backspace'));
        if (key === 'clear') keyButton.setAttribute('aria-label', local('清空当前输入', 'Clear current input'));
        keys.append(keyButton);
      }
      form.append(keys);
      if (levels.indexOf(config.level) >= 2) {
        const extra = create('details', 'calculatorMore');
        extra.append(create('summary', '', local('更多科学函数', 'More scientific functions')));
        const functions = create('div', 'calculatorKeys');
        for (const [key, name] of [['sinh', 'sinh'], ['cosh', 'cosh'], ['tanh', 'tanh'], ['cbrt', '∛'],
          ['floor', 'floor'], ['ceil', 'ceil'], ['round', 'round']]) {
          const extraKey = button(name, () => insert(key + '('), 'button', 'calculatorKey');
          extraKey.disabled = !permitsKey(config, key, 2);
          extraKey.dataset.calculatorKey = key;
          functions.append(extraKey);
        }
        extra.append(functions); form.append(extra);
      }
      // Adapted from Calc's renderHistory (Matt, MIT), scoped to the current question.
      const historyPane = create('details', 'calculatorHistory');
      const entries = create('ol');
      historyPane.append(create('summary', '', local('本题计算记录', 'Calculation history')), entries);
      renderHistory = () => {
        historyPane.hidden = history.length === 0;
        entries.replaceChildren(...history.slice().reverse().map(({expression, assignments, result}) => {
          const row = create('li');
          const values = Object.entries(assignments || {});
          const reuse = button('', () => {
            session.assignmentDraft = values.length ? {expression, values: new Map(values)} : null;
            input.value = expression; input.dispatchEvent(new Event('input')); input.focus();
          });
          const context = values.map(([name, value]) => name + ' = ' + value).join(', ');
          reuse.append(create('span', '', context ? expression + '  (' + context + ')' : expression),
            create('strong', '', '= ' + result));
          row.append(reuse); return row;
        }));
      };
      renderHistory(); form.append(historyPane);
      form.addEventListener('submit', event => {
        event.preventDefault();
        run(module, 'evaluate', {expression: input.value, assignments: Object.fromEntries(currentAssignments() || [])}, equals);
      });
    } else {
      const method = create('select');
      for (const [id, zh, en] of operations) {
        const option = create('option', '', local(zh, en));
        option.value = id; option.disabled = !permitsKey(config, id);
        method.append(option);
      }
      method.value = saved.get(module) || [...method.options].find(option => !option.disabled).value;
      if (operations.length > 1) label(form, local('运算', 'Operation'), method);
      const fields = create('div', 'calculatorToolFields');
      form.append(fields);
      function renderFields() {
        stop(); output.replaceChildren(); delete output.dataset.state;
        saved.set(module, method.value);
        fields.replaceChildren();
        const spec = operations.find(([id]) => id === method.value)[3];
        const prefix = module + '/' + method.value + '/';
        const {outer, fillExample} = toolInputs(spec, {module, operation: method.value, local, config,
          get: id => saved.get(prefix + id) || '', set: (id, value) => saved.set(prefix + id, value)});
        const actions = create('div', 'calculatorToolActions');
        actions.append(button(local('填入示例', 'Fill example'), fillExample),
          button(local('计算结果', 'Calculate'), null, 'submit', 'calculatorControl calculatorPrimary'));
        fields.append(outer, actions);
      }
      method.addEventListener('change', renderFields);
      renderFields();
      form.addEventListener('submit', event => {
        event.preventDefault();
        run(module, method.value, Object.fromEntries(new FormData(form)), fields.querySelector('[type="submit"]'));
      });
    }
    content.append(form);
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(true); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
  });
  window.addEventListener('resize', onResize);
  document.body.append(dialog); worksheet(); setLayout(preferredLayout);
  launch.setAttribute('aria-expanded', 'true');
  observe.observe(document.body, {childList: true, subtree: true});
  active = {launch, close};
}
