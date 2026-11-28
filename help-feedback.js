import {t, translateMessage} from './i18n.js?v=f81a576e90667aa8';
import {enhanceTopicContent} from './topic-content.js?v=f81a576e90667aa8';
import {drawLineMarquee, listenContentMarquee, marqueeHitsLine, measureLineBands} from './content-lines.js?v=f81a576e90667aa8';

const node = (tag, cls = '', text) => { const el = document.createElement(tag); el.className = cls; if (text !== undefined) el.textContent = text; return el; };
export const feedbackCategories = {
  quality: ['formatting', 'factual_error', 'unnatural', 'other'],
  help: ['missing_prerequisite', 'derivation_steps', 'motivation', 'other'],
};
const previewCategories = new Set(['factual_error', 'unnatural', 'derivation_steps', 'motivation']);

function normalize(ranges) {
  const result = [];
  for (const [token, start, end] of ranges.toSorted((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = result.at(-1);
    if (last && last[0] === token && start <= last[2]) last[2] = Math.max(last[2], end);
    else result.push([token, start, end]);
  }
  return result;
}
function overlaps(a, b) { return a[0] === b[0] && a[1] < b[2] && b[1] < a[2]; }
function subtract(ranges, removed) {
  let result = ranges;
  for (const b of removed) result = result.flatMap(a => !overlaps(a, b) ? [a] : [
    ...(a[1] < b[1] ? [[a[0], a[1], b[1]]] : []), ...(a[2] > b[2] ? [[a[0], b[2], a[2]]] : []),
  ]);
  return result;
}

// Anchors follow text, not screen coordinates, so wrapping does not change what
// was selected. Browser Range rects identify the actual displayed reading lines.
function lineSelector(stage, content, onChange) {
  const layer = node('div', 'feedbackLineLayer'), marquee = node('div', 'feedbackMarquee');
  marquee.hidden = true; layer.append(marquee); stage.append(layer);
  let selected = [], rows = [], frame = 0, stopped = false, disabled = false, initial, suppressClick = false;
  const paint = () => {
    for (const row of rows) {
      const active = row.ranges.some(a => selected.some(b => overlaps(a, b)));
      row.button.setAttribute('aria-pressed', String(active)); row.button.classList.toggle('selected', active);
    }
    onChange(rows.filter(row => row.button.getAttribute('aria-pressed') === 'true').length);
  };
  function measure() {
    frame = 0; if (stopped || !stage.isConnected || !stage.getClientRects().length) return;
    const base = stage.getBoundingClientRect();
    const bands = measureLineBands(({text, atom}) => {
      for (const token of content.querySelectorAll('[data-feedback-text]')) {
        if (token.firstChild?.nodeType === Node.TEXT_NODE)
          text(token.firstChild, (_start, _end, from, to) => [Number(token.dataset.feedbackText), from, to], true);
      }
      for (const node of content.querySelectorAll('[data-feedback-atom]')) atom(node, [Number(node.dataset.feedbackAtom), 0, 1]);
    });
    rows = bands.map((band, index) => {
      const button = node('button', 'feedbackLine'); button.type = 'button'; button.disabled = disabled;
      button.setAttribute('aria-label', t('help.selectLine', {number: index + 1}));
      const top = Math.max(0, band.top - base.top - 1), height = band.bottom - band.top + 2;
      Object.assign(button.style, {top: `${top}px`, height: `${height}px`});
      const row = {button, ranges: normalize(band.ranges), top, bottom: top + height};
      button.addEventListener('click', event => {
        if (disabled || (suppressClick && event.detail)) { suppressClick = false; return; }
        selected = row.ranges.some(a => selected.some(b => overlaps(a, b))) ? subtract(selected, row.ranges) : normalize([...selected, ...row.ranges]);
        paint();
      });
      return row;
    });
    layer.replaceChildren(...rows.map(row => row.button), marquee); paint();
  }
  const schedule = () => { if (!stopped && !frame) frame = requestAnimationFrame(measure); };
  const observer = new ResizeObserver(schedule); observer.observe(stage);
  const mutation = new MutationObserver(schedule); mutation.observe(content, {childList: true, subtree: true});
  content.addEventListener('load', schedule, true);
  listenContentMarquee(layer, {
    accepts(event) {
      suppressClick = false;
      initial = selected;
      return !disabled && event.pointerType !== 'touch';
    },
    preview(drag, event) {
      const box = drawLineMarquee(marquee, drag.x, drag.y, event), rect = layer.getBoundingClientRect();
      selected = normalize([...initial, ...rows.filter(row => marqueeHitsLine(box, {
        left: rect.left, right: rect.right, top: row.top + rect.top, bottom: row.bottom + rect.top,
      })).flatMap(row => row.ranges)]);
      paint();
    },
    finish(drag, event, cancelled) {
      if (cancelled) selected = initial;
      // Capture retargets click to the layer: perform the click toggle here.
      if (!drag.moved && !cancelled) {
        const y = event.clientY - layer.getBoundingClientRect().top;
        const row = rows.find(row => y >= row.top && y <= row.bottom);
        if (row) selected = row.ranges.some(a => selected.some(b => overlaps(a, b))) ? subtract(selected, row.ranges) : normalize([...selected, ...row.ranges]);
      }
      suppressClick = true;
      marquee.hidden = true;
      paint();
    },
  });
  schedule();
  return {
    value: () => selected, clear() { selected = []; paint(); }, refresh: schedule,
    disable(value) { disabled = value; for (const row of rows) row.button.disabled = value; },
    destroy() { stopped = true; cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect(); content.removeEventListener('load', schedule, true); layer.remove(); },
  };
}

export function createHelpFeedback(request) {
  const element = node('div', 'helpFeedbackFields'); element.hidden = true;
  const choices = node('fieldset', 'feedbackCategories'); choices.append(node('legend', '', t('help.categoriesHint')));
  const prerequisite = node('input', 'feedbackPrerequisite'); prerequisite.type = 'text'; prerequisite.maxLength = 1000;
  prerequisite.placeholder = t('help.prerequisitePlaceholder'); prerequisite.setAttribute('aria-label', t('help.prerequisitePlaceholder')); prerequisite.hidden = true;
  const preview = node('section', 'feedbackPreview'); preview.hidden = true;
  const hint = node('p', 'inputHint', t('help.selectionHint')), status = node('p', 'feedbackPreviewStatus'); status.setAttribute('role', 'status');
  const clear = node('button', 'textButton', t('help.clearSelection')); clear.type = 'button'; clear.hidden = true;
  const retry = node('button', 'textButton', t('portal.retry.10')); retry.type = 'button'; retry.hidden = true;
  const scroll = node('div', 'feedbackPreviewScroll'), stage = node('div', 'feedbackPreviewStage'), content = node('div', 'courseContent');
  const style = node('style'); stage.append(content); scroll.append(stage); preview.append(hint, status, retry, clear, style, scroll);
  element.append(choices, prerequisite, preview);
  let context = null, epoch = 0, loaded = null, selector = null, loading = false, disabled = false;
  const selectedCategories = () => [...choices.querySelectorAll('input:checked')].map(input => input.value);
  const needsPreview = () => selectedCategories().some(id => previewCategories.has(id));
  async function load() {
    if (loading || loaded || !context) return;
    const ticket = epoch; loading = true; retry.hidden = true; status.textContent = t('help.previewLoading');
    try {
      const result = await request('help-requests/preview', {method: 'POST', body: context});
      if (ticket !== epoch) return;
      loaded = result; style.textContent = result.math_css || ''; content.innerHTML = result.content_html;
      // A preview is selectable reading material, not an active link surface.
      content.inert = true; enhanceTopicContent(content);
      selector = lineSelector(stage, content, count => { status.textContent = t('help.selectedLines', {count}); });
      selector.disable(disabled); clear.hidden = false;
    } catch (error) { if (ticket === epoch) { status.textContent = translateMessage(error.message); retry.hidden = false; } }
    finally { if (ticket === epoch) loading = false; }
  }
  function update() {
    prerequisite.hidden = !selectedCategories().includes('missing_prerequisite');
    preview.hidden = !needsPreview();
    if (!preview.hidden) { void load(); selector?.refresh(); }
  }
  choices.addEventListener('change', update); retry.addEventListener('click', () => { void load(); });
  clear.addEventListener('click', () => selector?.clear());
  function reset() {
    epoch++; selector?.destroy(); selector = null; loaded = null; context = null; loading = false; disabled = false;
    choices.replaceChildren(node('legend', '', t('help.categoriesHint'))); content.replaceChildren();
    prerequisite.value = ''; prerequisite.disabled = false; prerequisite.hidden = true; preview.hidden = true; element.hidden = true; clear.hidden = true; style.textContent = '';
    clear.disabled = retry.disabled = false;
  }
  return {element, reset,
    open(value) {
      reset(); if (!value.help_request) return;
      const {topic_id, question_id, content_block_id, content_version, kind, bank_id, group_id} = value;
      context = {topic_id, question_id, content_block_id, content_version, kind, bank_id, group_id};
      for (const id of feedbackCategories[kind || 'help']) {
        const label = node('label', 'feedbackCategory'), input = node('input'); input.type = 'checkbox'; input.value = id;
        label.append(input, node('span', '', t('help.category.' + id))); choices.append(label);
      }
      element.hidden = false; update();
    },
    value() {
      const categories = selectedCategories(), selection = needsPreview() ? selector?.value() || [] : [];
      return {categories, prerequisite: categories.includes('missing_prerequisite') ? prerequisite.value.trim() : '',
        selection, selection_hash: selection.length ? loaded.content_hash : '', selection_version: 1};
    },
    disable(value) { disabled = value; for (const input of element.querySelectorAll('input, button')) input.disabled = value; selector?.disable(value); },
  };
}

export function feedbackDetails(request) {
  const box = node('div', 'helpFeedbackDetails'), categories = request.categories || [];
  if (categories.length) {
    const list = node('ul', 'helpCategoryTags');
    for (const id of categories) list.append(node('li', '', t('help.category.' + id)));
    box.append(list);
  }
  if (request.prerequisite) box.append(node('p', 'helpPrerequisiteText', t('help.prerequisiteDetail') + request.prerequisite));
  if (request.selection?.length) box.append(node('p', 'inputHint', t('help.selectionLegend')));
  return box;
}
