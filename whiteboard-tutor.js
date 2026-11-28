import {drawLineMarquee, listenContentMarquee, marqueeHitsLine} from './content-lines.js?v=3eda597ca70644cd';
import {captureSelection, formulaAt} from './clipper-selection.js?v=3eda597ca70644cd';
import {clipperPng} from './clipper-host.js?v=3eda597ca70644cd';

const preference = 'graspmemoedu:whiteboard-tutor';
export function whiteboardTutorMode() {
  try { if (localStorage.getItem(preference) === 'selection') return 'selection'; } catch {}
  return 'direct';
}
export function setWhiteboardTutorMode(mode) {
  try { localStorage.setItem(preference, mode === 'selection' ? 'selection' : 'direct'); } catch {}
}

let host;
export function configureWhiteboardTutor(options) { host = options; }
export function tutorAvailable() { return Boolean(host?.identity()); }

const contentSelector = '.courseContent, [data-help-block], .answerContent, .submittedAnswer > :not(summary), .feedbackReason, [data-tutor-content]';
const excluded = 'button,input,select,textarea,[data-content-actions],[role="toolbar"],[hidden],[inert],[aria-hidden="true"]';
const visible = element => element.getClientRects().length && !element.closest('[hidden],[inert]') &&
  !element.closest('details:not([open])') && getComputedStyle(element).visibility === 'visible';
function blocksOn(root, question) {
  const elements = [...root.querySelectorAll(contentSelector)].filter(visible);
  return elements.filter(element => !elements.some(parent => parent !== element && parent.contains(element)))
    .map(element => {
      let kind = element.dataset.tutorContent;
      if (!kind) {
        if (element.closest('.submittedAnswer, .submittedAnswerBody')) kind = 'submitted';
        else if (element.matches('.feedbackReason')) kind = 'feedback';
        else if (element.closest('.referenceAnswer, .multiStepAnswer, .answerContent, .explanationContent') ||
          element.dataset.helpBlock?.startsWith('explanation:')) kind = 'answer';
        else kind = question ? 'question' : 'reading';
      }
      return {element, kind};
    });
}

function whole(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  return captureSelection(range, element);
}

function partial(element, box) {
  const range = document.createRange(), runs = [];
  function visit(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.data.trim()) return;
      range.selectNodeContents(node);
      if (!Array.from(range.getClientRects()).some(rect => marqueeHitsLine(box, rect))) return;
      let offset = 0;
      for (const char of node.data) {
        const start = offset;
        offset += char.length;
        range.setStart(node, start); range.setEnd(node, offset);
        const rect = range.getBoundingClientRect();
        if (marqueeHitsLine(box, rect)) runs.push({range: range.cloneRange(), rect});
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || node.matches(excluded) || !visible(node)) return;
    if (node.matches('img') || formulaAt(node) === node) {
      const rect = node.getBoundingClientRect();
      if (marqueeHitsLine(box, rect)) {
        range.selectNode(node);
        runs.push({range: range.cloneRange(), rect});
      }
      return;
    }
    for (const child of node.childNodes) visit(child);
  }
  visit(element);
  // Within a visual line, keep real DOM boundaries so LaTeX, spaces and punctuation
  // are serialized the same way as a regular clipper selection.
  const lines = [];
  for (const run of runs) {
    const center = (run.rect.top + run.rect.bottom) / 2;
    const line = lines.at(-1);
    if (line && Math.abs(line.center - center) < Math.min(line.height, run.rect.height) * .55) {
      line.range.setEnd(run.range.endContainer, run.range.endOffset);
    } else lines.push({center, height: run.rect.height, range: run.range});
  }
  return lines.map(line => line.range);
}

function merge(parts) {
  const assets = [];
  const text = parts.filter(Boolean).map(part => {
    const offset = assets.length;
    assets.push(...part.assets);
    return part.text.replace(/(\]\(clipper-image:)(\d+)(\))/g,
      (_all, start, index, end) => start + (offset + Number(index)) + end);
  }).join('\n').trim();
  return {text, assets};
}

function boardBounds(surface, geometry) {
  if (!geometry?.width || !geometry.height) return;
  const {left, top} = surface.getBoundingClientRect();
  const full = {left: left + geometry.left, top: top + geometry.top, width: geometry.width, height: geometry.height};
  const clipped = {left: Math.max(left, full.left), top: top + geometry.visibleTop,
    right: left + geometry.visibleRight, bottom: top + geometry.visibleBottom};
  if (clipped.right > clipped.left && clipped.bottom > clipped.top) return {full, clipped};
}

export function selectTutorContent({scope, root, surface, overlay, geometry, question, local, change, cancel}) {
  const controller = new AbortController();
  const {signal} = controller;
  let blocks = [];
  const selected = new Map();
  let regions = [], allBoard = false, box;
  const layer = document.createElement('div'), marquee = document.createElement('div');
  layer.className = 'tutorSelectionLayer';
  marquee.className = 'feedbackMarquee';
  marquee.hidden = true;
  layer.append(marquee);
  document.body.append(layer);
  document.body.dataset.tutorSelecting = '';
  scope.classList.add('tutorSelecting');
  const focusable = new Map();
  function restoreFocus(element, index) {
    element.classList.remove('tutorSelectable', 'tutorWholeBlock');
    if (index === null) element.removeAttribute('tabindex'); else element.setAttribute('tabindex', index);
  }
  function refreshBlocks() {
    blocks = blocksOn(root(), question);
    const current = new Set(blocks.map(({element}) => element));
    for (const [element, index] of focusable) {
      if (current.has(element)) continue;
      restoreFocus(element, index);
      focusable.delete(element);
      selected.delete(element);
    }
    for (const {element} of blocks) {
      if (focusable.has(element)) continue;
      focusable.set(element, element.getAttribute('tabindex'));
      element.tabIndex = 0;
      element.classList.add('tutorSelectable');
    }
  }
  refreshBlocks();
  const wholeBoard = document.createElement('button');
  wholeBoard.type = 'button';
  wholeBoard.className = 'secondaryButton tutorWholeBoard';
  wholeBoard.textContent = local('整张白板', 'Whole whiteboard');
  surface.parentElement.before(wholeBoard);
  const regionsLayer = document.createElement('div');
  regionsLayer.className = 'tutorBoardRegions';
  overlay.append(regionsLayer);
  const canHighlight = globalThis.Highlight && CSS.highlights;
  function paint() {
    for (const {element} of blocks) element.classList.toggle('tutorWholeBlock', selected.get(element) === true);
    if (canHighlight) CSS.highlights.set('tutor-content', new Highlight(
      ...[...selected.values()].filter(Array.isArray).flat()));
    wholeBoard.setAttribute('aria-pressed', String(allBoard));
    overlay.classList.toggle('tutorWholeBlock', allBoard);
    const area = boardBounds(surface, geometry());
    overlay.hidden = !area;
    if (area) {
      const {full, clipped} = area, rect = surface.getBoundingClientRect();
      Object.assign(overlay.style, {left: clipped.left - rect.left + 'px', top: clipped.top - rect.top + 'px',
        width: clipped.right - clipped.left + 'px', height: clipped.bottom - clipped.top + 'px'});
      regionsLayer.replaceChildren(...regions.map(([left, top, right, bottom]) => {
        const region = document.createElement('div');
        Object.assign(region.style, {left: full.left - clipped.left + left * full.width + 'px',
          top: full.top - clipped.top + top * full.height + 'px',
          width: (right - left) * full.width + 'px', height: (bottom - top) * full.height + 'px'});
        return region;
      }));
    }
    change(selected.size + (allBoard ? 1 : regions.length));
  }
  const toggleBoard = () => { allBoard = !allBoard; regions = []; paint(); };
  wholeBoard.addEventListener('click', toggleBoard, {signal});
  const blockAt = target => blocks.find(({element}) => element.contains(target))?.element;
  listenContentMarquee(document, {
    signal, captureEvents: true, capture: () => scope,
    accepts(event) {
      if (!scope.contains(event.target) || event.target.closest(excluded)) return false;
      if (!blockAt(event.target) && event.target !== overlay &&
          event.target.closest('.whiteboardPanel, .questionToolRail, .whiteboardDivider')) return false;
      event.preventDefault();
      return true;
    },
    preview(drag, event) { box = drawLineMarquee(marquee, drag.x, drag.y, event); },
    finish(drag, _event, cancelled) {
      marquee.hidden = true;
      if (cancelled) return;
      if (!drag.moved) {
        if (drag.target === overlay) { toggleBoard(); return; }
        const element = blockAt(drag.target);
        if (element) {
          if (selected.get(element) === true) selected.delete(element);
          else selected.set(element, true);
        }
      } else {
        for (const {element} of blocks) {
          if (!visible(element) || !marqueeHitsLine(box, element.getBoundingClientRect())) continue;
          const ranges = partial(element, box);
          if (ranges.length) selected.set(element, ranges);
        }
        const area = boardBounds(surface, geometry());
        if (area && marqueeHitsLine(box, area.clipped) && regions.length < 12) {
          const {full, clipped} = area;
          const x = point => Math.min(1, Math.max(0, (point - full.left) / full.width));
          const y = point => Math.min(1, Math.max(0, (point - full.top) / full.height));
          const region = [x(Math.max(box.left, clipped.left)), y(Math.max(box.top, clipped.top)),
            x(Math.min(box.right, clipped.right)), y(Math.min(box.bottom, clipped.bottom))];
          if (region[0] < region[2] && region[1] < region[3]) { allBoard = false; regions.push(region); }
        }
      }
      paint();
    },
  });
  scope.addEventListener('click', event => {
    if (!blockAt(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
  }, {signal, capture: true});
  scope.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const element = blockAt(event.target);
    if (element !== event.target) return;
    event.preventDefault();
    if (selected.get(element) === true) selected.delete(element);
    else selected.set(element, true);
    paint();
  }, {signal});
  const observer = new ResizeObserver(paint);
  observer.observe(surface);
  scope.addEventListener('toggle', event => {
    if (event.target instanceof HTMLDetailsElement) { refreshBlocks(); paint(); }
  }, {signal, capture: true});
  paint();
  return {
    repaint: paint,
    value() {
      return {blocks: blocks.filter(({element}) => visible(element) && selected.has(element)).map(({element, kind}) => {
        const picked = selected.get(element);
        return {kind, ...merge(picked === true ? [whole(element)] : picked.map(range => captureSelection(range, element)))};
      }), board: allBoard || regions.length > 0, regions: allBoard ? [] : regions};
    },
    dispose() {
      controller.abort();
      observer.disconnect();
      delete document.body.dataset.tutorSelecting;
      scope.classList.remove('tutorSelecting');
      CSS.highlights?.delete('tutor-content');
      for (const [element, index] of focusable) restoreFocus(element, index);
      layer.remove(); wholeBoard.remove(); regionsLayer.remove();
      overlay.classList.remove('tutorWholeBlock');
      overlay.hidden = true;
    },
  };
}

function base64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

export async function openWhiteboardTutoring({mode, root, question, correct, submitted, snapshot, selection, language, signal}) {
  const account = host?.identity();
  if (!account) throw new Error(language === 'en' ? 'Sign in to use Knowledge Clipper.' : '请登录后使用零碎知识简藏解惑。');
  const blocks = selection?.blocks || blocksOn(root, question).map(({element, kind}) => ({kind, ...merge([whole(element)])}));
  if (mode === 'direct' && submitted && !blocks.some(block => block.kind === 'submitted')) {
    blocks.push({kind: 'submitted', text: submitted, assets: []});
  }
  const board = selection?.board || mode === 'direct' ? await snapshot() : null;
  signal.throwIfAborted();
  const prepared = await host.request('clipper/tutor-context', {method: 'POST', signal, body: {
    mode, language, correct: mode === 'direct' ? correct : undefined,
    blocks: await Promise.all(blocks.map(async ({kind, text, assets}) => ({
      kind, text, images: await Promise.all(assets.map(async image => base64(await clipperPng(image)))),
    }))),
    board: board ? await base64(board.png) : undefined,
    regions: selection?.regions || [],
  }});
  signal.throwIfAborted();
  if (account !== host.identity()) return;
  const assets = prepared.images.map(data => new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], {type: 'image/png'}));
  await host.open({text: prepared.text, assets, tutor: true});
}
