import {refreshCompletionSurface, setCompletionSurface, setInputCompletions} from './autocomplete.js?v=6472887ae33cd079';
import {formulaSpans, formulaTemplates, formulaToken, matchesCompletion} from './formula-catalog.js?v=6472887ae33cd079';
import {getLanguage} from './i18n.js?v=6472887ae33cd079';
import previews from './vendor/formula/previews.mjs?v=6472887ae33cd079';

const local = (zh, en) => getLanguage() === 'en' ? en : zh;
const style = 'formulaSourceHidden';
const active = new Set();
const hosts = new WeakMap();
const sourceAnchors = new WeakMap();
const paired = new WeakSet();
let runtime, observer;
const choices = formulaTemplates.filter(item => previews[item.sample]).map(item => ({
  ...item, value: item.sample, preview: previews[item.sample],
}));

function candidates(query) {
  if (!query) return [];
  return choices.filter(item => matchesCompletion(item, query)).slice(0, 8);
}

export function activeFormulaField(element) {
  const source = sourceAnchors.get(element);
  if (source) return source();
  const control = hosts.get(element?.closest?.('[data-formula-surface]'));
  return control?.anchor(element);
}

function load() {
  runtime ||= import('./vendor/formula/editor.mjs?v=6472887ae33cd079').catch(error => { runtime = null; throw error; });
  return runtime;
}

export function prepareVoiceFormula() {
  void load().catch(() => {});
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

export function attachLiteralAnswer(input) {
  let controller;
  const mount = () => {
    if (controller?.connected() || !input.isConnected || input.readOnly || input.disabled) return;
    controller = attachFormulaEditing(input, {group: 'answer', literal: true, launch: false});
  };
  input.addEventListener('focus', mount);
  input.addEventListener('input', mount);
  queueMicrotask(mount);
}

export function attachFormulaEditing(input, {group = 'other', source = input, after = source, launch = true,
  onValue, sourceField, readSource, voiceAnchor, literal = false} = {}) {
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
  if (launch) host.after(button);

  const enabled = () => !(input.disabled || input.readOnly || source === input && input.hidden);
  let editor, pending, disposed = false, sending = false, attributeObserver, detachSource;
  const events = new AbortController();
  const directAnswer = group === 'answer' && source === input;
  if (directAnswer && !paired.has(input)) { pairAnswerInput(input, literal); paired.add(input); }
  let revision = 0, composing = false;
  button.disabled = !enabled();
  const controller = {
    anchor(element) {
      if (!editor || host.hidden || !enabled()) return null;
      return {field: input, surface: host, ...editor.anchor(element)};
    },
    get visible() { return !disposed && !!editor && !host.hidden; },
    selection: () => controller.visible ? editor.sourceSelection() : null,
    focusAt: (offset, end) => editor?.focusSource(offset, end),
    sync() {
      button.disabled = !enabled();
      if (source === input) button.hidden = input.hidden;
      if (!editor || sending) return;
      editor.setDisabled();
      editor.replaceSource(input.value);
      if (!directAnswer) reflect(editor.value());
      if (input.required) editor.root.setAttribute('aria-required', 'true');
      else editor.root.removeAttribute('aria-required');
      host.hidden = source === input && input.hidden;
    },
    destroy() {
      disposed = true;
      if (sourceField && voiceAnchor) sourceAnchors.delete(sourceField);
      events.abort();
      active.delete(controller);
      attributeObserver?.disconnect();
      detachSource?.();
      editor?.destroy();
      source.classList.remove(style);
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
  if (sourceField && voiceAnchor) sourceAnchors.set(sourceField, () => {
    if (disposed || !enabled() || controller.visible || !sourceField.getClientRects().length) return null;
    return {field: input, surface: sourceField, ...voiceAnchor()};
  });
  controller.connected = () => !disposed && input.isConnected && host.isConnected;

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
        const {createFormulaEditor, answerMathSpans} = await load();
        if (disposed || !input.isConnected || !enabled()) return null;
        const label = input.labels?.[0]?.textContent || input.getAttribute('aria-label') || local('公式与文字', 'Formulas and text');
        const surface = await createFormulaEditor(host, {
          label, value: () => input.value, enabled, maxLength: () => input.maxLength < 0 ? Infinity : input.maxLength,
          change: reflect, submit: forwardSubmit, candidates, answer: directAnswer, literal, detectInitialBare,
          register: (element, read) => setCompletionSurface(element, group, read),
          refresh: refreshCompletionSurface, formula: local('公式', 'Formula'),
          fraction: local('改为分式', 'Set as a fraction'), operator: local('修正运算符排版', 'Format the operator'),
        });
        if (disposed || !input.isConnected || !enabled() || composing || detectInitialBare && !answerMathSpans(input.value).length) {
          surface.destroy(); return null;
        }
        editor = surface;
        editor.replaceSource(input.value);
        if (input.getAttribute('aria-describedby')) editor.root.setAttribute('aria-describedby', input.getAttribute('aria-describedby'));
        if (input.required) editor.root.setAttribute('aria-required', 'true');
        editor.root.addEventListener('keydown', forwardSubmit);
        source.classList.add(style);
        host.hidden = false;
        if (!directAnswer) reflect(editor.value());
        return editor;
      } catch {
        // Dismiss the enhancement on an asset failure and retain the native draft.
        return null;
      } finally { pending = null; }
    })();
    return pending;
  }

  async function showTypedFormula(event) {
    if (!input.isConnected || !enabled() || sending || disposed || event?.isComposing) return;
    const current = ++revision;
    if (editor) { controller.sync(); return; }
    const text = input.value;
    const delimited = formulaSpans(text).length > 0;
    if (!delimited && !/[\\α-ωΑ-Ω√∞≤≥≠±×÷−+*/^_=()[\]{}<>-]/.test(text)) return;
    if (!delimited && !directAnswer && !/\\[A-Za-z]/.test(text)) return;
    // Wait for the end of a control word so \sin does not consume the prefix of \sinh.
    if (!delimited && /\\[a-z]+$/i.test(text)) await new Promise(resolve => setTimeout(resolve, 180));
    try {
      const {answerMathSpans} = await load();
      if (current !== revision || input.value !== text || disposed || !answerMathSpans(text).length) return;
      const focused = source === input ? document.activeElement === input : source.contains(document.activeElement);
      const previous = document.activeElement;
      const offset = source === input ? input.selectionEnd : readSource?.()?.to ?? text.length;
      const surface = await open(true);
      if (current !== revision || !surface || disposed) return;
      if (focused && (document.activeElement === previous || document.activeElement === document.body)) {
        surface.focusTyped(text, offset);
      }
    } catch { /* Native editing remains available when the enhancement cannot load. */ }
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
    input.addEventListener('focus', () => { void load().catch(() => {}); }, {once: true, signal: events.signal});
  }
  input.addEventListener('input', event => { void showTypedFormula(event); }, {signal: events.signal});
  input.addEventListener('compositionstart', () => { composing = true; revision++; }, {signal: events.signal});
  input.addEventListener('compositionend', () => { composing = false; void showTypedFormula(); }, {signal: events.signal});
  input.addEventListener('invalid', event => {
    if (controller.visible) { event.preventDefault(); editor.root.focus(); }
  }, {signal: events.signal});
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
