import {setVoiceContext, voiceContext} from './voice-context.js?v=f81a576e90667aa8';
import {getLanguage} from './i18n.js?v=f81a576e90667aa8';
import {attachLiteralAnswer} from './formula-input.js?v=f81a576e90667aa8';

const targets = new WeakMap();
const local = (zh, en) => getLanguage() === 'en' ? en : zh;
export const answerConversionChange = 'answerconversionchange';
let requestConversion;
let commandInputEnabled = false;

export function installAnswerConversion(request) {
  requestConversion = body => request('answer-conversion', {method: 'POST', body, timeout: 35000});
  document.addEventListener('click', selectCalculatorField, true);
}

const blankSelector = '[data-passage-id], [data-answer-control], [data-calculator-field]';
const blankKey = element => element.dataset.passageId ?? element.dataset.answerControl ?? element.dataset.calculatorField;
function selectCalculatorField(event) {
  const blank = event.target.closest?.(blankSelector);
  const workspace = blank?.closest('.questionWorkspace');
  if (workspace?.querySelector('[data-question-tool][aria-haspopup="dialog"]')) {
    answerTarget(workspace)?.selectField(blankKey(blank));
  }
}

export function setAnswerCommandInputEnabled(enabled) {
  if (commandInputEnabled === enabled) return;
  commandInputEnabled = enabled;
  for (const input of document.querySelectorAll('[data-answer-conversion]')) {
    targets.get(input)?.showCommandInput(enabled);
  }
}

export function answerTarget(root = document, {topic = false} = {}) {
  const found = Array.from(root.querySelectorAll('[data-answer-conversion]'), input => targets.get(input))
    .filter(target => target?.available() && (!topic || target.topic));
  return found.length === 1 ? found[0] : null;
}

const normalized = value => value.trim().replace(/[！-～]/g, char =>
  String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replaceAll('−', '-');
const optionText = option => typeof option === 'string' ? option : option.text || '';
const clean = text => normalized(text).replace(/\\[()[\]]|\$/g, '').trim();
const choices = options => options.map(option => optionText(option).slice(0, 140));
const parse = text => { try { return JSON.parse(text); } catch { return undefined; } };
const known = (value, length) => Number.isInteger(value) && value >= 1 && value <= length;
const unique = values => new Set(values).size === values.length;
const selectionPrefix = /^(?:选择|选|答案(?:是|为)?)[：:\s]*/;
function ordinal(shown) {
  if (/^[0-9]+$/.test(shown)) return Number(shown);
  const digit = value => value.length === 1 ? '零一二三四五六七八九'.indexOf(value === '两' ? '二' : value) : -1;
  const parts = shown.split('十');
  if (parts.length === 1) return digit(shown);
  if (parts.length !== 2) return -1;
  const tens = parts[0] ? digit(parts[0]) : 1, ones = parts[1] ? digit(parts[1]) : 0;
  return tens >= 1 && ones >= 0 ? tens * 10 + ones : -1;
}

function pick(text, options) {
  const given = clean(text), source = given.replace(selectionPrefix, '');
  if (!given) return null;
  const literal = options.flatMap((option, index) => {
    const visible = clean(optionText(option));
    return visible && (visible === given || visible === source) ? [index + 1] : [];
  });
  if (literal.length) return literal.length === 1 ? literal[0] : null;
  const letter = source.match(/^([a-z])(?:[.、项]|\s*选项)?$/i)?.[1];
  if (letter) return letter.toUpperCase().charCodeAt(0) - 64;
  const number = source.match(/^第\s*([0-9一二三四五六七八九十两]+)\s*(?:项|个|个选项)$/)?.[1];
  return number ? ordinal(number) : null;
}

// Keep commas inside formulas, vectors and quoted answers.
function splitValues(text) {
  const parts = [], closing = {'(': ')', '[': ']', '{': '}', '（': '）', '［': '］', '【': '】', '｛': '｝'};
  const stack = [];
  let start = 0, quote, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote && !escaped) quote = undefined;
      escaped = !escaped && char === '\\';
      continue;
    }
    if (char === '"' && !text.slice(start, i).trim()) quote = '"';
    else if (closing[char]) stack.push(closing[char]);
    else if (stack.at(-1) === char) stack.pop();
    else if (!stack.length && /[,，、;；\n]/.test(char)) {
      parts.push(text.slice(start, i).trim()); start = i + 1;
    }
  }
  return [...parts, text.slice(start).trim()];
}

function list(text) {
  const array = parse(text);
  if (Array.isArray(array) && array.every(item => ['string', 'number', 'boolean'].includes(typeof item))) return array;
  return splitValues(text);
}

function boolean(text) {
  if (typeof text === 'boolean') return text;
  const value = normalized(String(text)).toLowerCase();
  if (/^(true|t|yes|1|正确|对|是|真|√|✓)$/.test(value)) return true;
  if (/^(false|f|no|0|错误|错|否|假|×|✗)$/.test(value)) return false;
  return null;
}

function matchPairs(text) {
  const source = normalized(text);
  const number = '([0-9一二三四五六七八九十两]+)';
  const pattern = new RegExp('左(?:边|侧)?\\s*(?:第\\s*)?' + number +
    '\\s*(?:个|项)?\\s*(?:连接|连(?:到|接到)?|配(?:对|到)?|匹配|对应|接|->|→|[-=:])\\s*' +
    '右(?:边|侧)?\\s*(?:第\\s*)?' + number + '\\s*(?:个|项)?', 'g');
  const pairs = Array.from(source.matchAll(pattern), ([, left, right]) => [ordinal(left), ordinal(right)]);
  if (pairs.length && /^[\s,、;.。和与]*$/.test(source.replace(pattern, ''))) return pairs;
  const formal = parse(source);
  if (Array.isArray(formal)) return formal;
  const parts = splitValues(source);
  const indexed = parts.map(part => part.match(/^(\d+)\s*(?:->|→|[-=:])\s*(\d+)$/));
  return indexed.every(Boolean) ? indexed.map(([, left, right]) => [Number(left), Number(right)]) : null;
}

function structuredFields(spec, input) {
  if (spec.type === 'composite') {
    const section = input.questionControl.conversionSection();
    const controls = spec.sections[section].control_ids.map(id => spec.controls.find(control => control.id === id));
    return {section, fields: controls.map(control => ({key: control.id, label: control.label, options: control.options}))};
  }
  const fields = spec.blanks || spec.statements || spec.fields;
  return {fields: fields.map((field, index) => ({key: spec.type === 'hyperskill_fill' ? index : field.id ?? index, label: field.label || field.text,
    options: field.options, boolean: spec.type === 'true_false'}))};
}

function fieldCommands(text, fields, speech) {
  // Numbered speech must be interpreted before a comma list can be treated as positional.
  if (/第\s*[0-9０-９零一二三四五六七八九十百两]+|(?:空格?|blank|field)\s*#?\s*[0-9０-９]+/i.test(text)) {
    const source = normalized(text).replace(/([负正])\s*(?=[\d.])/g, (_, sign) => sign === '负' ? '-' : '+');
    const pattern = /第\s*([0-9零一二三四五六七八九十两]+)\s*(?:个\s*)?空(?:格)?\s*(?:填写|填入|填上|填|写入|写|等于|是|为|[:=])\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)/gi;
    const matches = [...source.matchAll(pattern)];
    if (!matches.length || !/^(?:[\s,、;。.!]|然后|再|和)*$/.test(source.replace(pattern, ''))) return null;
    const entries = matches.map(([, index, value]) => [ordinal(index), value]);
    return entries.every(([n]) => known(n, fields.length) && !fields[n - 1].options && !fields[n - 1].boolean) ? entries : null;
  }
  const source = fields.length === 1 ? [text] : list(text);
  if (speech && !source.every(value => /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(value).trim()))) return null;
  return source.length === fields.length ? fieldEntries(source, fields, 0) : null;
}

function fieldEntries(values, fields, start) {
  return values.map((value, offset) => {
    const index = start + offset, field = fields[index], raw = String(value);
    return [index + 1, field.options ? pick(raw, field.options) : field.boolean ? boolean(value) : raw];
  });
}

function plan(spec, input) {
  const type = spec?.type || 'text';
  if (type === 'text' || type === 'hyperskill_code') return {
    read: text => text, apply: text => type === 'text' ? text :
      JSON.stringify({...parse(input.value), code: text}),
  };
  if (type === 'choice') return {
    schema: {type, options: choices(spec.options), multiple: Boolean(spec.multiple)},
    read: text => {
      const direct = pick(text, spec.options);
      return direct ? [direct] : spec.multiple ? list(text).map(value => pick(String(value), spec.options)) : null;
    },
    apply: selected => Array.isArray(selected) && selected.length && (spec.multiple || selected.length === 1)
      && unique(selected) && selected.every(value => known(value, spec.options.length))
      ? JSON.stringify({selected: spec.multiple ? selected.map(value => spec.options[value - 1].id)
        : spec.options[selected[0] - 1].id}) : null,
  };
  if (type === 'matching') {
    const fixed = spec.fixed_side;
    const sides = {left: spec.left, right: spec.right};
    if (fixed) sides[fixed] = spec.fixed.map(id => spec[fixed].find(option => option.id === id));
    return {
      schema: {type, left: choices(sides.left), right: choices(sides.right), count: spec.row_count},
      read: matchPairs,
      apply: pairs => {
        if (!Array.isArray(pairs) || !pairs.length || pairs.length > spec.row_count ||
            !pairs.every(pair => Array.isArray(pair) && pair.length === 2 &&
              known(pair[0], sides.left.length) && known(pair[1], sides.right.length)) ||
            ![0, 1].every(i => unique(pairs.map(pair => pair[i])))) return null;
        const requested = pairs.map(([left, right]) => ({left: sides.left[left - 1].id, right: sides.right[right - 1].id}));
        const previous = parse(input.value) || [];
        const remaining = previous.filter(row => !requested.some(pair => row.left === pair.left || row.right === pair.right));
        if (!fixed) {
          const rows = [...requested, ...remaining.filter(row => row.left || row.right)].slice(0, spec.row_count);
          while (rows.length < spec.row_count) rows.push({left: null, right: null});
          return JSON.stringify(rows);
        }
        const other = fixed === 'left' ? 'right' : 'left';
        return JSON.stringify(spec.fixed.map(id => requested.find(pair => pair[fixed] === id) ||
          remaining.find(pair => pair[fixed] === id) || {[fixed]: id, [other]: null}));
      },
    };
  }
  if (['hyperskill_sorting', 'hyperskill_parsons', 'hyperskill_table'].includes(type)) {
    if (type === 'hyperskill_table') return {
      schema: {type: 'table', left: choices(spec.rows), right: choices(spec.columns), multiple: Boolean(spec.multiple)},
      read: matchPairs,
      apply: pairs => {
        if (!Array.isArray(pairs) || !pairs.length || !pairs.every(pair => Array.isArray(pair) && pair.length === 2 &&
            known(pair[0], spec.rows.length) && known(pair[1], spec.columns.length))) return null;
        const rows = parse(input.value);
        for (const index of new Set(pairs.map(([row]) => row))) {
          const columns = pairs.filter(([row]) => row === index).map(([, column]) => column);
          if (!unique(columns) || (!spec.multiple && columns.length !== 1)) return null;
          rows[index - 1] = spec.columns.map((_, column) => columns.includes(column + 1));
        }
        return JSON.stringify(rows);
      },
    };
    const parsons = type === 'hyperskill_parsons';
    return {
      schema: {type: parsons ? 'parsons' : 'sorting', options: choices(spec.items)},
      read: text => {
        const value = parse(normalized(text));
        return parsons ? value : (Array.isArray(value) ? value : list(text).map(Number));
      },
      apply: order => {
        if (!Array.isArray(order) || order.length !== spec.items.length) return null;
        const indices = parsons ? order.map(pair => pair?.[0]) : order;
        if (!unique(indices) || !indices.every(value => known(value, spec.items.length))) return null;
        if (parsons && !order.every(pair => Array.isArray(pair) && pair.length === 2 &&
            Number.isInteger(pair[1]) && pair[1] >= 0 && pair[1] <= 10)) return null;
        return JSON.stringify(parsons ? order.map(([line, level]) => ({line_number: line - 1, level}))
          : order.map(line => line - 1));
      },
    };
  }
  const {fields, section} = structuredFields(spec, input);
  return {
    fields, section,
    schema: {type: 'fields', fields: fields.map(field => field.options ? choices(field.options)
      : field.boolean ? true : (field.label || '').slice(0, 100))},
    read: (text, speech) => fieldCommands(text, fields, speech),
    apply: updates => {
      if (!Array.isArray(updates) || !updates.length || !updates.every(entry => Array.isArray(entry) &&
          entry.length === 2 && known(entry[0], fields.length)) || !unique(updates.map(([index]) => index))) return null;
      const previous = parse(input.value);
      const values = type === 'hyperskill_fill' ? [...previous] : {...(section === undefined ? previous : previous?.values)};
      for (const [index, value] of updates) {
        const field = fields[index - 1];
        if (field.options) {
          if (!known(value, field.options.length)) return null;
          const option = field.options[value - 1];
          values[field.key] = option.id ?? option;
        } else {
          if (field.boolean ? typeof value !== 'boolean' : typeof value !== 'string' || !value.trim() || value.length > 2000) return null;
          values[field.key] = value;
        }
      }
      return JSON.stringify(section === undefined ? values : {section, values});
    },
  };
}

export function mountAnswerConversion(form, input, spec, {topic = false, question} = {}) {
  setVoiceContext(form, question, spec?.type === 'hyperskill_code' ? 'code' : spec?.grading === 'exact' ? 'literal' : 'mixed');
  const box = document.createElement('div');
  box.className = 'answerConversion';
  const label = document.createElement('label'), field = document.createElement('textarea');
  label.textContent = local('用文字填写答题控件', 'Fill answer controls from text');
  field.className = 'answerInput';
  field.rows = 2; field.maxLength = Math.max(4000, input.maxLength); field.spellcheck = false; field.autocomplete = 'off';
  label.append(field);
  attachLiteralAnswer(field);
  if (spec?.type === 'text' && spec.grading === 'exact') attachLiteralAnswer(input);
  const button = document.createElement('button'), status = document.createElement('span');
  button.type = 'button'; button.className = 'secondaryButton';
  button.textContent = local('转换', 'Convert'); button.title = 'Ctrl+Enter';
  status.setAttribute('role', 'status');
  function showCommandInput(show) {
    box.hidden = !show;
    if (show) box.append(label, button, status);
    else box.replaceChildren();
  }
  showCommandInput(commandInputEnabled);
  form.append(box);
  let busy = false, revision = 0;
  const enabled = () => !input.disabled && !input.readOnly;
  const refresh = () => {
    field.disabled = !enabled();
    button.disabled = !enabled() || busy || !field.value.trim();
    button.textContent = busy ? local('转换中…', 'Converting…') : local('转换', 'Convert');
  };
  const available = () => enabled() && form.contains(input) && form.isConnected &&
    !form.closest('[hidden], [inert]') && form.getClientRects().length > 0;
  input.addEventListener('input', () => { revision++; });
  field.addEventListener('input', () => { revision++; status.textContent = ''; refresh(); });
  new MutationObserver(() => { revision++; refresh(); document.dispatchEvent(new Event(answerConversionChange)); })
    .observe(input, {attributes: true, attributeFilter: ['disabled', 'readonly']});
  const convert = async (text, guard = () => true, {speech = false, values, start} = {}) => {
    if (!available() || busy || !guard() || !text.trim()) return false;
    if (text.length > field.maxLength) {
      status.textContent = local('转换文字过长，请缩短后重试。', 'The text is too long. Shorten it and try again.');
      return false;
    }
    if (!box.hidden) field.value = text;
    busy = true; refresh();
    const version = revision, current = input.value;
    const failure = () => {
      status.textContent = local('无法对应到答题控件，请改写后重试。', 'The answer could not be mapped to the controls. Edit it and try again.');
      return false;
    };
    try {
      const mapping = plan(spec, input);
      const commands = values && mapping.fields ? fieldEntries(values, mapping.fields, start)
        : mapping.read(spec?.type === 'hyperskill_code' ? text : text.trim(), speech);
      let answer = mapping.apply(commands);
      if (answer === null && requestConversion && mapping.schema && text.length <= 4000) {
        const result = await requestConversion({text: text.trim(), controls: mapping.schema,
          ...(speech ? {context: voiceContext(form)} : {})});
        if (!available() || !guard()) return false;
        if (version !== revision || current !== input.value) {
          status.textContent = local('答题内容已修改，请重新转换。', 'The answer changed. Convert again to apply the text.');
          return false;
        }
        answer = mapping.apply(result.commands);
      }
      if (!available() || !guard()) return false;
      if (answer === null || answer.length > (input.maxLength >= 0 ? input.maxLength : 16384)) return failure();
      input.value = answer;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      status.textContent = local('已填入答题控件。', 'Answer controls updated.');
      return true;
    } catch {
      return available() && guard() ? failure() : false;
    } finally {
      busy = false; refresh();
    }
  };
  const convertCommand = () => void convert(field.value, () => !box.hidden);
  button.addEventListener('click', convertCommand);
  field.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); event.stopPropagation(); convertCommand();
    }
  });
  refresh();
  const pin = () => {
    const version = revision, value = input.value;
    return () => available() && revision === version && input.value === value;
  };
  input.dataset.answerConversion = '';
  const hasBlanks = ['fill_blank', 'hyperskill_fill', 'composite'].includes(spec?.type);
  let scope, keys = [], selected = null, next = 0;
  const records = [];
  function calculatorState() {
    if (hasBlanks) {
      const {section = 0, fields} = structuredFields(spec, input);
      if (section !== scope) {
        scope = section; keys = fields.map(field => String(field.key)); selected = null; next = 0; records.length = 0;
      }
    }
    return {records, start: selected ?? next, selected, count: keys.length};
  }
  function markSelection() {
    const workspace = form.closest('.questionWorkspace');
    if (workspace && hasBlanks) for (const element of workspace.querySelectorAll(blankSelector)) {
      element.classList.toggle('calculatorSelectedBlank', selected !== null && blankKey(element) === keys[selected]);
    }
  }
  function selectField(key) {
    if (!hasBlanks) return;
    calculatorState();
    const index = keys.indexOf(key);
    if (index === -1 || selected === index) return;
    selected = index; markSelection();
    document.dispatchEvent(new Event(answerConversionChange));
  }
  if (spec?.type === 'composite') input.addEventListener('input', () => queueMicrotask(() => {
    if (!available()) return;
    const previousSection = scope;
    calculatorState(); markSelection();
    if (scope !== previousSection) document.dispatchEvent(new Event(answerConversionChange));
  }));
  async function convertCalculator(answer, guard) {
    const {start, count} = calculatorState(), section = scope;
    const values = [...records, ...answer.split('\n')];
    if (count && start + values.length > count) return false;
    const text = count ? values.map((value, i) => '第' + (start + i + 1) + '空填 ' + value).join('\n') : values.join('\n');
    const unchanged = pin();
    const valid = () => guard() && unchanged() && calculatorState().start === start && scope === section;
    if (!await convert(text, valid, count ? {values, start} : {})) return false;
    records.length = 0;
    if (count && selected === null) next = start + values.length;
    markSelection();
    return true;
  }
  const voiceProfile = spec?.type && !['text', 'hyperskill_code'].includes(spec.type) ? 'answer_commands' : 'answer';
  targets.set(input, {available, convert, pin, topic, showCommandInput, selectField, calculatorState, convertCalculator,
    voiceProfile, context: voiceContext(form)});
}
