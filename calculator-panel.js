import {constants, keypad, levels, permitsConstant, permitsKey, permitsModule, tools} from './calculator-policy.js?v=ad5665f8f97afbd9';
import {toolInputs} from './calculator-inputs.js?v=ad5665f8f97afbd9';

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

export function openCalculator(launch, config, english) {
  if (active?.launch === launch) return;
  active?.close(false);
  const local = (zh, en) => english ? en : zh;
  const dialog = create('dialog', 'questionCalculator');
  dialog.setAttribute('aria-labelledby', 'questionCalculatorTitle');
  const headline = create('header', 'calculatorHeader');
  const tiers = {
    basic: local('基础计算器', 'Basic calculator'), scientific: local('科学计算器', 'Scientific calculator'),
    advanced: local('高级计算器', 'Advanced calculator'), cas: local('CAS 计算器', 'CAS calculator'),
  };
  const title = create('h2', '', tiers[config.level]); title.id = 'questionCalculatorTitle';
  const layout = create('div', 'calculatorLayout');
  const layoutToggle = create('div', 'calculatorLayoutToggle');
  const center = button(local('居中', 'Center'), () => setLayout('center'));
  const side = button(local('侧栏', 'Side panel'), () => setLayout('side'));
  const closeButton = button('×', () => close(true));
  closeButton.setAttribute('aria-label', local('关闭计算器', 'Close calculator'));
  layoutToggle.append(center, side);
  layout.append(layoutToggle, closeButton); headline.append(title, layout); dialog.append(headline);

  const available = tools.filter(([id, , , operations]) => permitsModule(config, id)
    && operations.some(([key]) => permitsKey(config, key)));
  if (permitsModule(config, 'expression')) available.unshift(['expression', '计算', 'Calculate']);
  let activeModule = available[0]?.[0];
  const selector = create('select');
  selector.setAttribute('aria-label', local('其他计算工具', 'Other calculator tools'));
  const content = create('div', 'calculatorContent');
  const output = create('div', 'calculatorResult');
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  const navigation = create('div', 'calculatorNavigation');
  const tabs = create('div', 'calculatorTabs');
  const direct = available.slice(0, available.length <= 3 ? 3 : 2);
  for (const [id, zh, en] of direct) {
    const tab = button(local(zh, en), () => openModule(id), 'button', 'calculatorTab');
    tab.dataset.module = id; tabs.append(tab);
  }
  if (available.length > 1) {
    navigation.append(tabs);
    if (available.length > direct.length) {
      const chooser = create('div', 'calculatorToolChooser');
      const placeholder = create('option', '', local('其他工具', 'Other tools'));
      placeholder.value = ''; placeholder.disabled = true;
      selector.append(placeholder);
      for (const [id, zh, en] of available.slice(direct.length)) {
        const option = create('option', '', local(zh, en)); option.value = id; selector.append(option);
      }
      chooser.append(selector);
      navigation.append(chooser);
    }
    dialog.append(navigation);
  }
  dialog.append(content, output);

  let worker, timer, previousAnswer, degrees = false, working = false, closed = false;
  const saved = new Map(), history = [];
  let renderHistory = () => {};
  const wide = matchMedia('(min-width: 1100px)');
  const observe = new MutationObserver(() => {
    if (!launch.isConnected) close(false);
  });
  const onResize = () => setLayout(preferredLayout, false);
  function setLayout(mode, remember = true) {
    if (remember) preferredLayout = mode;
    const dock = mode === 'side' && wide.matches;
    side.disabled = !wide.matches;
    if (dialog.open && dialog.dataset.layout === (dock ? 'side' : 'center')) return;
    if (dialog.open) dialog.close();
    dialog.dataset.layout = dock ? 'side' : 'center';
    if (dock) dialog.show();
    else dialog.showModal();
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
    observe.disconnect(); wide.removeEventListener('change', onResize);
    stop();
    dialog.close(); dialog.remove();
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
  function run(module, operation, input, control) {
    if (working || control.disabled) return;
    working = true; control.disabled = true;
    output.dataset.state = 'busy'; output.textContent = local('计算中…', 'Calculating…');
    const finish = () => { clearTimeout(timer); working = false; control.disabled = false; };
    try {
      worker ||= new Worker(new URL('./calculator-worker.js?v=ad5665f8f97afbd9', import.meta.url), {type: 'module'});
      worker.onmessage = ({data}) => {
        finish();
        if (!launch.isConnected || closed) return;
        if (data.error) { showError(data.error); return; }
        if (module === 'expression') {
          previousAnswer = data.result.numeric;
          history.push({expression: input.expression, result: data.result.text});
          if (history.length > 12) history.shift();
          renderHistory();
        }
        show(data.result);
      };
      worker.onerror = event => { event.preventDefault(); stop(); finish(); showError('invalid'); };
      timer = setTimeout(() => { stop(); finish(); showError('timeout'); }, 8000);
      worker.postMessage({config, module, operation, input, degrees, answer: previousAnswer});
    } catch { stop(); finish(); showError('invalid'); }
  }

  function openModule(module) {
    if (activeModule === module) return;
    activeModule = module;
    worksheet();
  }

  function worksheet() {
    stop(); output.replaceChildren(); delete output.dataset.state;
    selector.value = direct.some(([id]) => id === activeModule) ? '' : activeModule;
    for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab.dataset.module === activeModule));
    dialog.append(output);
    content.replaceChildren();
    if (!activeModule) {
      content.append(create('p', '', local('本题没有可用的计算工具。', 'No calculator tools are available for this question.')));
      return;
    }
    const form = create('form', 'calculatorForm');
    const module = activeModule;
    if (module === 'expression') {
      const input = create('input', 'calculatorExpression');
      input.type = 'text'; input.maxLength = 1024; input.spellcheck = false; input.autocomplete = 'off';
      input.value = saved.get(module) || '';
      input.placeholder = '2 × (3 + 4)';
      input.addEventListener('input', () => saved.set(module, input.value));
      const display = create('div', 'calculatorDisplay');
      label(display, local('表达式', 'Expression'), input);
      output.textContent = history.at(-1)?.result || '0';
      display.append(output); form.append(display);
      const insert = value => {
        const start = input.selectionStart ?? input.value.length;
        input.setRangeText(value, start, input.selectionEnd ?? start, 'end');
        saved.set(module, input.value);
        input.focus();
      };
      const options = create('div', 'calculatorOptions');
      if (permitsKey(config, 'angle', 2)) {
        options.append(button(degrees ? 'DEG' : 'RAD', event => {
          degrees = !degrees; event.currentTarget.textContent = degrees ? 'DEG' : 'RAD';
        }));
        options.firstElementChild.setAttribute('aria-label', local('切换角度单位', 'Switch angle units'));
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
      form.append(options);
      const keys = create('div', 'calculatorKeys');
      let equals;
      for (const [key, name, insertion, minimum = 1] of keypad) {
        if (levels.indexOf(config.level) < minimum) continue;
        const action = key === 'evaluate' ? null : () => {
          if (key === 'clear') {
            stop(); equals.disabled = !permitsKey(config, 'evaluate');
            input.value = ''; saved.delete(module); output.textContent = '0'; delete output.dataset.state; input.focus(); return;
          }
          if (key === 'backspace') {
            if (input.selectionStart === input.selectionEnd && input.selectionStart > 0)
              input.setSelectionRange(input.selectionStart - 1, input.selectionEnd);
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
        if (key === 'clear') keyButton.setAttribute('aria-label', local('清空表达式', 'Clear expression'));
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
        entries.replaceChildren(...history.slice().reverse().map(({expression, result}) => {
          const row = create('li');
          const reuse = button('', () => {
            input.value = expression; saved.set(module, expression); input.focus();
          });
          reuse.append(create('span', '', expression), create('strong', '', '= ' + result));
          row.append(reuse); return row;
        }));
      };
      renderHistory(); form.append(historyPane);
      form.addEventListener('submit', event => {
        event.preventDefault();
        run(module, 'evaluate', {expression: input.value}, equals);
      });
    } else {
      const operations = available.find(([id]) => id === module)[3];
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
    if (event.key === 'Escape' && dialog.dataset.layout === 'side') { event.preventDefault(); close(true); }
  });
  selector.addEventListener('change', () => openModule(selector.value));
  wide.addEventListener('change', onResize);
  document.body.append(dialog); worksheet(); setLayout(preferredLayout);
  observe.observe(document.body, {childList: true, subtree: true});
  active = {launch, close};
}
