import {constants, keypad, permitsConstant, permitsKey} from './calculator-policy.js?v=3b98cafe4a000f31';

const element = (tag, cls = '', text) => {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, action) => {
  const node = element('button', 'calculatorControl', text);
  node.type = 'button';
  node.addEventListener('pointerdown', event => event.preventDefault());
  node.addEventListener('click', action);
  return node;
};
const caption = (text, control) => {
  const row = element('label', 'calculatorField');
  row.append(element('span', '', text), control);
  return row;
};
const limit = 32;
const numericKeys = ['digit_7', 'digit_8', 'digit_9', 'backspace', 'digit_4', 'digit_5', 'digit_6', 'exponent_notation',
  'digit_1', 'digit_2', 'digit_3', 'subtract', 'digit_0', 'decimal'];
const modularKeys = ['open', 'close', 'power', 'backspace', 'digit_7', 'digit_8', 'digit_9', 'multiply',
  'digit_4', 'digit_5', 'digit_6', 'add', 'digit_1', 'digit_2', 'digit_3', 'subtract', 'digit_0'];
const byKey = new Map(keypad.map(key => [key[0], key]));
const units = ['m', 'cm', 'mm', 'km', 'in', 'ft', 'mi', 's', 'ms', 'min', 'h', 'kg', 'g', 'lb', 'm/s',
  'km/h', 'm/s^2', 'cm/s^2', 'L', 'mL', 'm^3', 'Pa', 'kPa', 'bar', 'atm', 'J', 'kJ', 'W', 'kW', 'V', 'A', 'ohm',
  'K', 'degC', 'degF', 'rad', 'deg', 'N', 'Hz'];
const periodic = 'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ');

function typeFor(module, operation, field) {
  if (field === 'expression') {
    if (operation === 'balance') return 'chemistry';
    if (operation === 'modular_power') return 'modular';
    return 'formula';
  }
  if (field === 'model') return 'model';
  if (field === 'date' || field === 'variable' || field === 'unit') return field;
  if (operation === 'convert_units') return 'quantity';
  if (operation === 'base_convert') return field === 'value' ? 'radix' : 'base';
  if (operation === 'classification') return 'labels';
  if (module === 'matrix') return operation === 'linear_system' && field === 'b' ? 'vector' : 'matrix';
  if (operation === 'pca') return 'matrix';
  if (['statistics', 'machine_learning', 'signal', 'finance', 'ecology'].includes(module) && ['x', 'y'].includes(field))
    return 'vector';
  return 'number';
}

function select(choices, value) {
  const input = element('select');
  for (const [value, label] of choices) {
    const option = element('option', '', label); option.value = value;
    input.append(option);
  }
  input.value = value;
  return input;
}

function readMatrix(text) {
  const value = JSON.parse(text);
  if (!Array.isArray(value) || !value.length || value.length > limit || !Array.isArray(value[0]) ||
      !value[0].length || value[0].length > limit) throw new Error('matrix');
  const width = value[0].length;
  if (!value.every(row => Array.isArray(row) && row.length === width &&
      row.every(cell => Number.isFinite(cell) || cell === null)))
    throw new Error('matrix');
  return value.map(row => row.map(cell => cell === null ? '' : String(cell)));
}

function readModel(raw) {
  const value = JSON.parse(raw);
  if (!value || !['min', 'max'].includes(value.opType) || !value.variables || !value.constraints
      || typeof value.optimize !== 'string') throw new Error('model');
  if (Object.keys(value.variables).length > 24 || Object.keys(value.constraints).length > 24)
    throw new Error('model');
  return value;
}

export function toolInputs(descriptors, {module, operation, local, config, get, set}) {
  const outer = element('div', 'calculatorToolInputs');
  const form = element('div', 'calculatorFields');
  outer.append(form);
  let target = null, variableInput, currentKind, initialKind = 'number';
  const pad = element('details', 'calculatorToolKeyboard');
  const keypadLabel = element('summary', '', local('屏幕键盘', 'On-screen keypad'));
  const padKeys = element('div', 'calculatorKeys');
  const padOptions = element('div', 'calculatorOptions');
  pad.append(keypadLabel, padOptions, padKeys);
  if (descriptors.some(([id]) => typeFor(module, operation, id) !== 'date')) outer.append(pad);

  // Adapted from Calc's cursor insertion helper (Matt, MIT). A target is scoped
  // to this worksheet so a key can never edit the surrounding answer form.
  function insert(text) {
    const field = target;
    if (!field?.isConnected || field.disabled || field.readOnly) return;
    let start = field.selectionStart ?? field.value.length, end = field.selectionEnd ?? start;
    if (text === null && start === end) start = Math.max(0, start - 1);
    field.setRangeText(text ?? '', start, end, 'end');
    field.dispatchEvent(new Event('input', {bubbles: true})); field.focus();
  }
  function showPad(kind) {
    if (currentKind === kind && padKeys.childElementCount) return;
    currentKind = kind;
    const alpha = ['radix', 'labels', 'variable'].includes(kind);
    const alphabet = kind === 'variable' ? 'abcdefghijklmnopqrstuvwxyz_' : '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    padKeys.dataset.columns = kind === 'formula' ? '5' : alpha ? '6' : '4';
    const tokens = alpha
      ? [...[...alphabet].map(char => [/\d/.test(char) ? 'digit_' + char : char.toLowerCase(), char, char]),
        ['subtract', '−', '-'], ['backspace', '⌫', '']]
      : kind === 'formula' ? keypad.filter(([id]) => !['evaluate', 'clear', 'ans'].includes(id))
        : (kind === 'modular' ? modularKeys : numericKeys).map(id => byKey.get(id));
    padKeys.replaceChildren(...tokens.map(([id, label, value, tier]) => {
      const key = button(label, () => insert(id === 'backspace' ? null : value));
      key.className = 'calculatorKey'; key.dataset.calculatorKey = id;
      key.disabled = !permitsKey(config, id, tier);
      return key;
    }));
    padOptions.replaceChildren();
    if (kind === 'formula') {
      const names = Object.keys(constants).filter(key => permitsConstant(config, key));
      if (names.length) addSymbols(names.map(key => [key, constants[key][0] + ' · ' + local(constants[key][1], constants[key][2])]),
        local('选择常数', 'Choose constant'));
      const variable = variableInput?.value.trim();
      const terms = [/^[A-Za-z][A-Za-z_]{0,11}$/.test(variable || '') ? variable : 'x'];
      if (operation === 'solve') terms.push('=');
      for (const term of terms) {
        const key = button(term, () => insert(term));
        key.disabled = term === '=' && !permitsKey(config, 'solve');
        padOptions.append(key);
      }
    } else if (kind === 'chemistry') {
      addSymbols(periodic.map(key => [key, key]), local('选择元素', 'Choose element'));
      for (const symbol of [' + ', ' → ', '(', ')', '[', ']', '·', '-', '^']) {
        padOptions.append(button(symbol, () => insert(symbol === ' → ' ? ' -> ' : symbol)));
      }
    }
  }
  function addSymbols(choices, title) {
    const selection = select([['', title], ...choices], '');
    selection.setAttribute('aria-label', title);
    selection.addEventListener('change', () => {
      if (selection.value) insert(selection.value);
      selection.value = '';
    });
    padOptions.append(selection);
  }
  function editable(value, kind, onChange, label, placeholder = '') {
    const input = element('input');
    input.type = 'text'; input.value = value; input.placeholder = placeholder;
    input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 12000;
    if (label) input.setAttribute('aria-label', label);
    if (kind === 'number') input.inputMode = 'decimal';
    input.addEventListener('input', () => onChange(input.value));
    if (kind !== 'date') input.addEventListener('focus', () => {
      target = input;
      showPad(kind);
    });
    return input;
  }

  function compound(id, title, example, kind) {
    const box = element('fieldset', 'calculatorCompound');
    box.append(element('legend', '', title));
    const modes = element('div', 'calculatorInputModes');
    const body = element('div', 'calculatorStructured');
    box.append(modes, body);
    const hidden = element('input'); hidden.type = 'hidden'; hidden.name = id;
    const update = value => { hidden.value = value; set(id, value); };
    hidden.value = get(id);
    let active = 'gui';
    const gui = button(local('结构化输入', 'Structured input'), () => { active = 'gui'; paint(); });
    const raw = button(local('文本输入', 'Text input'), () => { active = 'raw'; paint(); });
    modes.append(gui, raw);
    const draftChanged = () => {
      if (active === 'raw') hidden.value = get(id);
      paint();
    };
    function paint() {
      body.replaceChildren();
      gui.setAttribute('aria-pressed', String(active === 'gui'));
      raw.setAttribute('aria-pressed', String(active === 'raw'));
      if (active === 'raw') {
        const textarea = element('textarea');
        textarea.name = id; textarea.value = get(id); textarea.placeholder = example;
        textarea.required = true; textarea.autocomplete = 'off'; textarea.spellcheck = false; textarea.maxLength = 12000;
        textarea.setAttribute('aria-label', title);
        textarea.addEventListener('input', () => update(textarea.value));
        body.append(textarea);
        return;
      }
      body.append(hidden);
      try {
        if (kind === 'matrix') {
          const data = get(id) ? readMatrix(get(id)) : [['', ''], ['', '']];
          grid(body, data, update, title, false, false);
        } else if (kind === 'model') {
          const model = get(id) ? readModel(get(id)) : null;
          optimization(body, model, update);
        } else {
          const source = get(id).trim().replace(/^\[([^\[\]]+)\]$/, '$1');
          const data = source ? source.split(/[,，]/).flatMap(part => part.trim().split(/\s+/)) : ['', '', ''];
          if (data.length > limit) throw new Error('vector');
          grid(body, data.map(value => [value]), update, title, true, kind === 'labels');
        }
      } catch {
        body.append(element('p', 'calculatorInputNotice',
          local('这份文本无法转换成网格。可在文本输入里继续编辑。', 'This text cannot be converted to a grid. Edit it in Text input.')));
      }
    }
    paint();
    return {box, refresh: draftChanged};
  }

  function grid(host, data, update, title, vector, labels) {
    const toolbar = element('div', 'calculatorGridControls');
    const cells = element('div', 'calculatorGridScroller');
    host.append(toolbar, cells);
    const publish = () => {
      if (vector) update(data.map(row => row[0]).join(','));
      else update(JSON.stringify(data.map(row => row.map(value =>
        value.trim() && Number.isFinite(Number(value)) ? Number(value) : null))));
    };
    function dimensions() {
      const options = Array.from({length: limit}, (_, index) => [String(index + 1), String(index + 1)]);
      const rows = select(options, String(data.length));
      rows.addEventListener('change', () => {
        const count = Number(rows.value);
        while (data.length < count) data.push(Array(data[0].length).fill(''));
        data.length = count; draw(); publish();
      });
      toolbar.replaceChildren(caption(vector ? local('数据项', 'Values') : local('行数', 'Rows'), rows));
      if (!vector) {
        const columns = select(options, String(data[0].length));
        columns.addEventListener('change', () => {
          const count = Number(columns.value);
          for (const row of data) {
            while (row.length < count) row.push('');
            row.length = count;
          }
          draw(); publish();
        });
        toolbar.append(caption(local('列数', 'Columns'), columns));
      }
    }
    function draw() {
      dimensions();
      const body = element('div', vector ? 'calculatorVector' : 'calculatorMatrix');
      body.style.setProperty('--columns', data[0].length);
      data.forEach((row, r) => row.forEach((value, c) => {
        const cellTitle = vector ? title + ' ' + (r + 1) : title + ' ' + (r + 1) + ', ' + (c + 1);
        const input = editable(value, labels ? 'labels' : 'number', newValue => {
          data[r][c] = newValue; publish();
        }, cellTitle, vector ? String(r + 1) : '0');
        input.required = true;
        body.append(input);
      }));
      cells.replaceChildren(body);
    }
    draw();
  }

  function optimization(host, input, update) {
    const sourceVariables = Object.keys(input?.variables || {});
    const sourceConstraints = Object.keys(input?.constraints || {});
    const goal = input?.optimize || 'objective';
    const axis = (letter, count, names) => Array.from({length: count}, (_, index) => names[index] || letter + (index + 1));
    const direction = select([['max', local('最大化', 'Maximize')], ['min', local('最小化', 'Minimize')]], input?.opType || 'max');
    const counts = Array.from({length: 24}, (_, index) => [String(index + 1), String(index + 1)]);
    const variables = select(counts, String(sourceVariables.length || 2));
    const constraints = select(counts, String(sourceConstraints.length || 1));
    const limits = element('div', 'calculatorGridScroller');
    const toolbar = element('div', 'calculatorGridControls');
    toolbar.append(caption(local('目标', 'Objective'), direction), caption(local('变量数', 'Variables'), variables),
      caption(local('约束数', 'Constraints'), constraints));
    host.append(toolbar, limits);
    const coefficients = new Map();
    const relations = new Map();
    sourceConstraints.forEach(name => relations.set(name, Object.entries(input.constraints[name])[0]));
    sourceVariables.forEach(name => Object.entries(input.variables[name]).forEach(([constraint, value]) =>
      coefficients.set(name + '/' + constraint, String(value))));
    function draw() {
      const columns = axis('x', Number(variables.value), sourceVariables);
      const rows = axis('r', Number(constraints.value), sourceConstraints);
      const table = element('table', 'calculatorModel');
      const body = element('tbody');
      const head = element('tr');
      for (const title of ['', ...columns, local('关系', 'Relation'), local('界值', 'Bound')])
        head.append(element('th', '', title));
      body.append(head);
      const publish = () => {
        const next = {optimize: goal, opType: direction.value, constraints: Object.create(null), variables: Object.create(null)};
        for (const name of rows) {
          const [kind, value] = relations.get(name) || ['max', ''];
          if (String(value).trim() === '' || !Number.isFinite(Number(value))) { update(''); return; }
          next.constraints[name] = {[kind]: Number(value)};
        }
        for (const variable of columns) {
          next.variables[variable] = Object.create(null);
          for (const rule of [goal, ...rows]) {
            const value = coefficients.get(variable + '/' + rule);
            if (value && !Number.isFinite(Number(value))) { update(''); return; }
            next.variables[variable][rule] = Number(value || 0);
          }
        }
        update(JSON.stringify(next));
      };
      for (const rule of [goal, ...rows]) {
        const row = element('tr');
        row.append(element('th', '', rule === goal ? local('目标', 'Objective') : rule));
        for (const variable of columns) {
          const key = variable + '/' + rule;
          const cell = element('td');
          cell.append(editable(coefficients.get(key) || '', 'number', text => {
            coefficients.set(key, text); publish();
          }, rule + ' · ' + variable, '0'));
          row.append(cell);
        }
        if (rule !== goal) {
          const [kind, value] = relations.get(rule) || ['max', ''];
          const relation = select([['max', '≤'], ['min', '≥'], ['equal', '=']], kind);
          relation.setAttribute('aria-label', rule + ' ' + local('关系', 'Relation'));
          const bound = editable(String(value), 'number', text => {
            relations.set(rule, [relation.value, text]); publish();
          }, rule + ' ' + local('界值', 'Bound'));
          bound.required = true;
          relation.addEventListener('change', () => { relations.set(rule, [relation.value, bound.value]); publish(); });
          for (const control of [relation, bound]) { const cell = element('td'); cell.append(control); row.append(cell); }
        }
        body.append(row);
      }
      table.append(body); limits.replaceChildren(table);
      direction.onchange = publish;
      publish();
    }
    variables.addEventListener('change', draw); constraints.addEventListener('change', draw); draw();
  }

  const refresh = [];
  for (const [id, zh, en, example] of descriptors) {
    const title = local(zh, en), kind = typeFor(module, operation, id);
    if (['matrix', 'vector', 'labels', 'model'].includes(kind)) {
      const item = compound(id, title, example, kind);
      form.append(item.box); refresh.push(item.refresh);
      continue;
    }
    const value = get(id);
    const input = editable(value, kind, value => set(id, value), title, example);
    input.name = id; input.required = true;
    if (kind === 'date') input.type = 'date';
    if (kind === 'variable') variableInput = input;
    const row = caption(title, input);
    const choices = kind === 'base' ? Array.from({length: 35}, (_, i) => String(i + 2))
      : kind === 'variable' ? ['x', 'y', 't', 'n', 'a', 'b', 'z']
      : ['unit', 'quantity'].includes(kind) ? units : null;
    if (choices) {
      const name = id + '-calculator-options';
      input.setAttribute('list', name);
      const list = element('datalist'); list.id = name;
      for (const value of choices) { const option = element('option'); option.value = value; list.append(option); }
      row.append(list);
      if (kind === 'quantity') {
        const chooser = select([['', local('附加单位', 'Add unit')], ...units.map(value => [value, value])], '');
        chooser.addEventListener('change', () => {
          const leading = input.value.match(/^\s*[-+\d.eE]+/)?.[0].trim() || '';
          input.value = (leading ? leading + ' ' : '') + chooser.value;
          set(id, input.value); chooser.value = '';
        });
        row.append(chooser);
      }
    }
    form.append(row);
    refresh.push(() => { input.value = get(id); });
    if (!target && ['formula', 'modular', 'chemistry', 'radix', 'number'].includes(kind)) {
      target = input; initialKind = kind;
    }
  }
  showPad(initialKind);
  const fillExample = () => {
    for (const [id, , , value] of descriptors) set(id, value);
    for (const update of refresh) update();
  };
  return {outer, fillExample};
}
