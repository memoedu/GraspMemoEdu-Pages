import {refreshCompletionSurface, setCompletionSurface, setInputCompletions} from './autocomplete.js?v=35de3b2120782aa7';
import {bareMathRuns, formulaSpans, formulaTemplates, formulaToken, matchesCompletion} from './formula-catalog.js?v=35de3b2120782aa7';
import {getLanguage} from './i18n.js?v=35de3b2120782aa7';
import previews from './vendor/formula/previews.mjs?v=35de3b2120782aa7';

const local = (zh, en) => getLanguage() === 'en' ? en : zh;
const style = 'formulaSourceHidden';
const active = new Set();
const hosts = new WeakMap();
let runtime, observer;
const choices = formulaTemplates.filter(item => previews[item.sample]).map(item => ({
  ...item, value: item.sample, preview: previews[item.sample],
}));

function candidates(query) {
  if (!query) return [];
  return choices.filter(item => matchesCompletion(item, query)).slice(0, 8);
}

export function activeFormulaField(element) {
  const control = hosts.get(element?.closest?.('[data-formula-surface]'));
  return control?.anchor(element);
}

function load() {
  runtime ||= import('./vendor/formula/editor.mjs?v=35de3b2120782aa7').catch(error => { runtime = null; throw error; });
  return runtime;
}

// Native controls own the literal draft used for exact grading, command conversion,
// voice and calculator insertion. Keep their selection and normal input events.
function replaceTyped(input, from, to, value, cursor, end = cursor) {
  if (input.maxLength >= 0 && input.value.length - to + from + value.length > input.maxLength) return;
  input.setSelectionRange(from, to);
  if (!document.execCommand('insertText', false, value)) {
    input.setRangeText(value, from, to, 'end');
    input.setSelectionRange(cursor, end);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  } else {
    input.setSelectionRange(cursor, end);
    refreshCompletionSurface(input);
  }
}

function pairAnswerInput(input, literal) {
  const pairs = {'(': ')', '[': ']', '{': '}'};
  let emptyScript = -1;
  let literalScript;
  input.addEventListener('pointerdown', () => { literalScript = null; });
  input.addEventListener('blur', () => { literalScript = null; });
  input.addEventListener('keydown', event => {
    if (literalScript && ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Escape'].includes(event.key)) literalScript = null;
  });
  input.addEventListener('beforeinput', event => {
    if (!event.cancelable || event.isComposing || input.readOnly || input.disabled) return;
    const from = input.selectionStart, to = input.selectionEnd;
    const key = event.data, source = input.value, previous = source[from - 1], next = source[to];
    if (event.inputType === 'deleteContentBackward' && from === to && previous && pairs[previous] === next) {
      event.preventDefault();
      const start = from - (emptyScript === from && /[\^_]/.test(source[from - 2]) ? 2 : 1);
      replaceTyped(input, start, to + 1, '', start);
      emptyScript = -1;
      return;
    }
    if (event.inputType !== 'insertText' || !key || key.length !== 1 || previous === '\\') return;
    if (literalScript) {
      const start = literalScript.length, body = source.slice(start, from);
      if (from !== to || from < start || !source.startsWith(literalScript) || !/^[a-z0-9]*$/i.test(body)) literalScript = null;
      else if (/^[+\-*/=]$/.test(key) || body && /^[a-z0-9]$/i.test(key) && !/^\d+$/.test(body + key)) {
        // A compound exponent needs real delimiters in the submitted spelling.
        literalScript = null;
        event.preventDefault();
        replaceTyped(input, start, to, '{' + body + key + '}', from + 2);
        return;
      } else if (!/^[a-z0-9]$/i.test(key)) literalScript = null;
    }
    if (from === to && key === next && [')', ']', '}'].includes(key)) {
      event.preventDefault(); input.setSelectionRange(from + 1, from + 1); emptyScript = -1;
      refreshCompletionSurface(input);
      return;
    }
    // Accept an explicitly typed TeX opening brace after an automatically opened script.
    if (emptyScript === from && from === to && previous === '{' && next === '}' && key === '{') {
      event.preventDefault(); emptyScript = -1; return;
    }
    if (emptyScript === from && from === to && previous === '{' && next === '}' && key === '(') {
      event.preventDefault();
      replaceTyped(input, from - 1, to + 1, '()', from);
      emptyScript = -1;
      return;
    }
    const script = key === '^' || key === '_';
    // An open script already has a slot in the preview; simple exact values keep their spelling.
    if (literal && script && from === to) {
      literalScript = source.slice(0, from) + key;
      return;
    }
    if (!pairs[key] && !script) { emptyScript = -1; return; }
    const open = script ? key + '{' : key, close = script ? '}' : pairs[key];
    const selected = source.slice(from, to);
    event.preventDefault();
    replaceTyped(input, from, to, open + selected + close, from + open.length, from + open.length + selected.length);
    emptyScript = script && !selected ? from + open.length : -1;
  });
}

function attachAnswerTyping(input, finish) {
  const entry = document.createElement('span'), preview = document.createElement('span');
  entry.className = 'answerFormulaEntry'; preview.className = 'answerFormulaPreview';
  preview.hidden = true;
  preview.setAttribute('aria-label', local('公式预览', 'Formula preview'));
  const focused = input === document.activeElement;
  input.before(entry);
  if (entry.moveBefore && entry.isConnected) entry.moveBefore(input, null);
  else entry.append(input);
  entry.append(preview);
  if (focused && document.activeElement !== input) input.focus({preventScroll: true});
  pairAnswerInput(input, !finish);
  let rendered, revision = 0;
  async function refresh() {
    const value = input.value, current = ++revision;
    if (entry.classList.contains(style) || !value || !(formulaSpans(value).length || bareMathRuns(value).length)) {
      preview.hidden = true; rendered = undefined; return;
    }
    if (value === rendered) return;
    try {
      const {answerMathSpans, renderAnswerPreview} = await load();
      if (revision !== current || value !== input.value || !entry.isConnected) return;
      renderAnswerPreview(preview, answerMathSpans(value));
      rendered = value;
    } catch { preview.hidden = true; }
  }
  input.addEventListener('focus', refresh);
  input.addEventListener('input', refresh);
  if (finish) {
    input.addEventListener('blur', () => finish(false));
    preview.addEventListener('pointerdown', event => event.preventDefault());
    preview.addEventListener('click', () => finish(true));
  }
  queueMicrotask(refresh);
  return entry;
}

export function attachLiteralAnswer(input) {
  let mounted = false;
  const mount = () => {
    if (mounted || !input.isConnected || input.readOnly || input.disabled) return;
    mounted = true;
    attachAnswerTyping(input);
  };
  input.addEventListener('focus', mount);
  input.addEventListener('input', mount);
  queueMicrotask(mount);
  setInputCompletions(input, () => choices, {match: formulaToken, apply(candidate, from, to) {
    // Keep plain function calls usable by the exact-answer and command readers.
    const simple = /^[A-Za-z]+$/.test(candidate.label) && candidate.latex.endsWith('\\left(#?\\right)');
    if (simple && input.value[to] === '(') {
      replaceTyped(input, from, to, candidate.label, from + candidate.label.length + 1);
      return true;
    }
    const text = simple ? candidate.label + '(#?)' : candidate.latex;
    const slot = text.indexOf('#?'), value = text.replaceAll('#?', '');
    replaceTyped(input, from, to, value, from + (slot < 0 ? value.length : slot));
    return true;
  }});
}

export function attachFormulaEditing(input, {group = 'other', source = input, after = source, launch = true,
  onValue, sourceField, readSource} = {}) {
  if (input.readOnly) return null;
  const host = document.createElement('div');
  host.className = 'formulaInput';
  host.dataset.formulaSurface = '';
  host.hidden = true;
  after.after(host);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'textButton formulaInputButton';
  button.textContent = local('插入公式', 'Insert formula');
  if (launch) host.before(button);

  const enabled = () => !(input.disabled || input.readOnly || source === input && input.hidden);
  let editor, pending, disposed = false, sending = false, attributeObserver, detachSource;
  const directAnswer = group === 'answer' && source === input;
  const entry = directAnswer ? attachAnswerTyping(input, async focus => {
    if (editor || sending || !enabled() || !input.value) return;
    const value = input.value;
    try {
      const {answerMathSpans} = await load();
      if (disposed || value !== input.value || !answerMathSpans(value).length || !focus && document.activeElement === input) return;
      const surface = await open(true);
      if (focus && surface) surface.focus(input.selectionStart, true);
    } catch { /* The literal draft stays usable if the editor cannot load. */ }
  }) : source;
  button.disabled = !enabled();
  const controller = {
    anchor(element) {
      if (!editor || host.hidden || !enabled()) return null;
      return {field: input, insert: editor.anchor(element)};
    },
    get visible() { return !!editor && !host.hidden; },
    selection: () => controller.visible ? editor.sourceSelection() : null,
    focusAt: (offset, end) => editor?.focusSource(offset, end),
    sync() {
      button.disabled = !enabled();
      if (source === input) button.hidden = input.hidden;
      if (!editor || sending) return;
      editor.setDisabled();
      editor.replaceSource(input.value);
      if (input.required) editor.root.setAttribute('aria-required', 'true');
      else editor.root.removeAttribute('aria-required');
      host.hidden = source === input && input.hidden;
    },
    destroy() {
      disposed = true;
      active.delete(controller);
      attributeObserver?.disconnect();
      detachSource?.();
      editor?.destroy();
      entry.classList.remove(style);
      host.remove();
      button.remove();
    },
    async insertFormula(latex, sourceSelection) {
      const selection = source === input && !controller.visible ? [input.selectionStart, input.selectionEnd] : sourceSelection;
      const value = input.value;
      const surface = await open();
      if (!surface || value !== input.value) return;
      if (selection && selection[0] !== null) surface.insertAt(...selection, latex);
      else surface.insertFormula(latex);
    },
  };
  hosts.set(host, controller);
  controller.connected = () => input.isConnected;

  function reflect(value) {
    if (input.value === value) return;
    sending = true;
    try {
      input.value = value;
      onValue?.(value);
      input.dispatchEvent(new Event('input', {bubbles: true}));
    } finally { sending = false; }
  }

  function forwardSubmit(event) {
    if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter' || event.isComposing || event.defaultPrevented) return;
    if (!input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', ctrlKey: event.ctrlKey, metaKey: event.metaKey, cancelable: true, bubbles: true,
    }))) event.preventDefault();
  }

  async function open(detectInitialBare = false) {
    if (disposed || !enabled()) return null;
    if (editor) return editor;
    if (pending) return pending;
    pending = (async () => {
      try {
        const {createFormulaEditor} = await load();
        if (disposed || !input.isConnected || !enabled()) return null;
        const label = input.labels?.[0]?.textContent || input.getAttribute('aria-label') || local('公式与文字', 'Formulas and text');
        const surface = await createFormulaEditor(host, {
          label, value: () => input.value, enabled, maxLength: () => input.maxLength < 0 ? Infinity : input.maxLength,
          change: reflect, submit: forwardSubmit, candidates, answer: directAnswer, detectInitialBare,
          register: (element, read) => setCompletionSurface(element, group, read),
          refresh: refreshCompletionSurface, formula: local('公式', 'Formula'), previewLabel: local('公式预览', 'Formula preview'),
          fraction: local('改为分式', 'Set as a fraction'), operator: local('修正运算符排版', 'Format the operator'),
        });
        if (disposed || !input.isConnected || !enabled()) { surface.destroy(); return null; }
        editor = surface;
        editor.replaceSource(input.value);
        if (input.getAttribute('aria-describedby')) editor.root.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));
        if (input.required) editor.root.setAttribute('aria-required', 'true');
        editor.root.addEventListener('keydown', forwardSubmit);
        entry.classList.add(style);
        host.hidden = false;
        return editor;
      } catch {
        // Dismiss the enhancement on an asset failure and retain the native draft.
        return null;
      } finally { pending = null; }
    })();
    return pending;
  }

  async function showTypedFormula() {
    if (!input.isConnected || !enabled() || sending) return;
    if (editor) { controller.sync(); return; }
    if (!formulaSpans(input.value).length) return;
    const focused = source === input ? document.activeElement === input : source.contains(document.activeElement);
    const offset = source === input ? input.selectionEnd : input.value.length;
    const oldFocus = document.activeElement;
    const surface = await open();
    if (focused && surface && (document.activeElement === oldFocus || document.activeElement === document.body))
      surface.focus(offset);
  }

  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => { void controller.insertFormula(); });
  attributeObserver = new MutationObserver(() => controller.sync());
  attributeObserver.observe(input, {attributes: true, attributeFilter: ['disabled', 'readonly', 'hidden']});
  if (sourceField) detachSource = setCompletionSurface(sourceField, group, () => {
    if (controller.visible || !enabled()) return null;
    const state = readSource();
    if (!state || state.from !== state.to) return null;
    const query = state.value.slice(0, state.from).match(formulaToken)?.[0];
    if (!query) return null;
    const suffix = /^[\\a-z_]/i.test(query) ? state.value.slice(state.to).match(/^[a-z_0-9]*/i)[0].length : 0;
    return {...state, candidates: candidates(query), apply(candidate) {
      if (state.current()) void controller.insertFormula(candidate.latex, [state.from - query.length, state.to + suffix]);
    }};
  });
  // Keep native form events, draft persistence, and existing shortcuts intact.
  if (source === input) {
    setInputCompletions(input, () => choices, {match: formulaToken, apply(candidate, from, to) {
      const pinned = input.value;
      const cursor = input.selectionEnd;
      void open().then(surface => {
        if (surface && input.value === pinned && input.selectionStart === cursor && input.selectionEnd === cursor
          && input.isConnected && enabled()) surface.insertAt(from, to, candidate.latex);
      });
      return true;
    }});
    input.addEventListener('paste', event => {
      const raw = event.clipboardData?.getData('text/plain');
      const text = raw?.trim();
      if (!text || !/^\\[a-zA-Z]+/.test(text) || /[\r\n]/.test(text)) return;
      event.preventDefault();
      const from = input.selectionStart, to = input.selectionEnd, pinned = input.value;
      const paste = part => {
        if (input.value !== pinned || input.selectionStart !== from || input.selectionEnd !== to || !input.isConnected) return;
        const available = input.maxLength < 0 ? part.length : input.maxLength - pinned.length + to - from;
        input.setRangeText(part.slice(0, Math.max(0, available)), from, to, 'end');
        input.dispatchEvent(new Event('input', {bubbles: true}));
      };
      void load().then(({isLatexFragment}) => paste(isLatexFragment(text) ? '\\(' + text + '\\)' : raw), () => paste(raw));
    });
  }
  input.addEventListener('input', () => { void showTypedFormula(); });
  queueMicrotask(() => {
    if (input.isConnected) {
      active.add(controller);
      observer ||= new MutationObserver(() => {
        for (const item of active) if (!item.connected()) item.destroy();
      });
      observer.observe(document.body, {subtree: true, childList: true});
      void showTypedFormula();
    }
  });
  return controller;
}
