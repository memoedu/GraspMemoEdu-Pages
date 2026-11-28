import {t} from './i18n.js?v=f4e8cccd42a8abae';
import {formulaAt, formulaSelector} from './clipper-selection.js?v=f4e8cccd42a8abae';
import {drawLineMarquee, marqueeHitsLine, measureLineBands} from './content-lines.js?v=f4e8cccd42a8abae';

const readingSurface = '.courseContent,.answerContent,[data-help-block]';
const ignored = '[hidden],[inert],[aria-hidden="true"],[data-content-actions],[role="toolbar"],.sourceCodeLanguage,script,style,template,button,input,textarea,select,dialog,[contenteditable="true"]';
const interactive = `${ignored},a,summary,label,img,video,audio`;

function readLines(surface) {
  let order = 0;
  const bands = measureLineBands(({text, atom}) => {
    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const index = order++;
        text(node, (start, end) => ({node, start, end, index}));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || node.matches(ignored)) return;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible') return;
      if (node.matches('img') || (node.matches(formulaSelector) && formulaAt(node) === node)) {
        const index = order++;
        const offset = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
        atom(node, {node: node.parentNode, start: offset, end: offset + 1, index});
        return;
      }
      const children = node.matches('details:not([open])') ? [node.querySelector(':scope > summary')].filter(Boolean) : node.childNodes;
      for (const child of children) visit(child);
    }
    visit(surface);
  });
  return bands.map(band => {
    const parts = band.ranges.sort((a, b) => a.index - b.index || a.start - b.start);
    const start = parts[0], end = parts.at(-1), range = document.createRange();
    range.setStart(start.node, start.start); range.setEnd(end.node, end.end);
    return {surface, range, top: band.top, bottom: band.bottom};
  });
}

export function createClipperLines(root, {onChange, blocked, actions}) {
  const layer = document.createElement('div'), marquee = document.createElement('div');
  layer.className = 'feedbackLineLayer clipperLineLayer'; layer.dataset.contentActions = '';
  marquee.className = 'feedbackMarquee'; marquee.hidden = true;
  const needsPosition = getComputedStyle(root).position === 'static';
  root.classList.toggle('clipperLineStage', needsPosition);
  layer.append(marquee); root.append(layer);
  let rows = [], selected = new Set(), anchor, hovered, drag, frame = 0, measureAfterDrag = false, suppressClick = false;

  function setHovered(row) {
    if (hovered === row) return;
    hovered?.button.classList.remove('clipperLineHover');
    row?.button.classList.add('clipperLineHover');
    hovered = row;
  }

  function paint() {
    for (const row of rows) {
      row.button.classList.toggle('selected', selected.has(row));
      row.button.setAttribute('aria-pressed', String(selected.has(row)));
    }
  }
  function clear() {
    if (!selected.size) return;
    selected.clear(); anchor = null; paint(); onChange();
  }
  function toggle(row) {
    if (blocked()) return;
    getSelection()?.removeAllRanges();
    if (selected.has(row)) selected.delete(row);
    else selected.add(row);
    anchor = row; paint(); onChange();
  }
  function measure() {
    frame = 0;
    if (drag) { measureAfterDrag = true; return; }
    if (!root.getClientRects().length) return;
    const base = layer.getBoundingClientRect(), previous = [...selected];
    const surfaces = [...root.querySelectorAll(readingSurface)].filter(surface => surface.getClientRects().length &&
      !surface.closest(ignored) && !surface.parentElement.closest(readingSurface));
    rows = surfaces.flatMap(surface => {
      const rect = surface.getBoundingClientRect(), left = Math.max(0, rect.left - base.left - 21);
      return readLines(surface).map(row => ({...row, left, right: rect.right - base.left,
        top: row.top - base.top - 1, bottom: row.bottom - base.top + 1}));
    });
    selected = new Set(rows.filter(row => previous.some(old => row.surface === old.surface &&
      old.range.compareBoundaryPoints(Range.START_TO_END, row.range) > 0 &&
      old.range.compareBoundaryPoints(Range.END_TO_START, row.range) < 0)));
    anchor = null; setHovered(null);
    rows.forEach((row, index) => {
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'feedbackLine'; button.setAttribute('aria-label', t('help.selectLine', {number: index + 1}));
      Object.assign(button.style, {left: `${row.left}px`, width: `${row.right - row.left}px`,
        top: `${row.top}px`, height: `${row.bottom - row.top}px`});
      button.addEventListener('click', event => { if (!suppressClick || !event.detail) toggle(row); });
      row.button = button;
    });
    layer.replaceChildren(...rows.map(row => row.button), marquee); paint(); onChange();
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  const resize = new ResizeObserver(schedule); resize.observe(root);
  const mutation = new MutationObserver(records => { if (records.some(record => !layer.contains(record.target))) schedule(); });
  mutation.observe(root, {childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'open']});
  root.addEventListener('load', schedule, true);
  document.fonts?.addEventListener('loadingdone', schedule);

  const listeners = new AbortController(), options = {capture: true, signal: listeners.signal};
  const rowAt = (event, base = layer.getBoundingClientRect()) => {
    const x = event.clientX - base.left, y = event.clientY - base.top;
    return rows.find(row => x >= row.left && x <= row.right && y >= row.top && y <= row.bottom);
  };
  const canStart = event => layer.contains(event.target) ||
    (root.contains(event.target) && event.target.closest(readingSurface) && !event.target.closest(interactive));
  document.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (blocked() || actions.contains(event.target) || event.button !== 0 || drag) return;
    if (event.shiftKey || !canStart(event)) { clear(); return; }
    if (event.pointerType === 'touch') return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, row: rowAt(event),
      gutter: layer.contains(event.target), initial: new Set(selected), moved: false};
  }, options);
  document.addEventListener('pointermove', event => {
    if (!drag) {
      if (event.pointerType === 'mouse') setHovered(canStart(event) && !blocked() ? rowAt(event) : null);
      return;
    }
    if (event.pointerId !== drag.id || blocked()) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4 ||
          (!drag.gutter && rowAt(event) === drag.row)) return;
      drag.moved = true;
      setHovered(null);
      root.classList.add('clipperLineDragging');
    }
    event.preventDefault();
    getSelection()?.removeAllRanges();
    const box = drawLineMarquee(marquee, drag.x, drag.y, event), base = layer.getBoundingClientRect();
    const area = {left: box.left - base.left, right: box.right - base.left, top: box.top - base.top, bottom: box.bottom - base.top};
    const hits = rows.filter(row => marqueeHitsLine(area, row));
    selected = new Set([...drag.initial, ...hits]);
    anchor = rowAt(event, base) || hits.at(-1); paint();
  }, options);
  function finish(event) {
    if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
    if (drag.moved) {
      suppressClick = true;
      if (event.type === 'pointerup') getSelection()?.removeAllRanges();
      else selected = drag.initial;
    }
    drag = null; marquee.hidden = true; root.classList.remove('clipperLineDragging'); paint(); onChange();
    if (measureAfterDrag) { measureAfterDrag = false; schedule(); }
  }
  document.addEventListener('pointerup', finish, options);
  document.addEventListener('pointercancel', finish, options);
  window.addEventListener('blur', finish, {signal: listeners.signal});
  root.addEventListener('click', event => {
    if (suppressClick || !canStart(event) || layer.contains(event.target) || event.shiftKey || !getSelection()?.isCollapsed) return;
    const row = rowAt(event);
    if (row) toggle(row);
  }, options);
  schedule();

  return {
    clear,
    refresh: schedule,
    get dragging() { return Boolean(drag); },
    capture() {
      const ranges = [];
      let previous;
      for (const row of rows) {
        if (selected.has(row) && row.surface.isConnected && !row.range.collapsed) {
          const last = ranges.at(-1);
          if (previous?.surface === row.surface) last.setEnd(row.range.endContainer, row.range.endOffset);
          else ranges.push(row.range.cloneRange());
          previous = row;
        } else previous = null;
      }
      if (!ranges.length || !root.getClientRects().length) return null;
      const isVisible = row => selected.has(row) && row.button.getBoundingClientRect().bottom > 0 && row.button.getBoundingClientRect().top < innerHeight;
      const visible = anchor && isVisible(anchor) ? anchor : rows.findLast(isVisible);
      return {ranges, root, anchor: visible?.button};
    },
    destroy() {
      cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); listeners.abort();
      root.removeEventListener('load', schedule, true); document.fonts?.removeEventListener('loadingdone', schedule);
      root.classList.remove('clipperLineStage', 'clipperLineDragging'); layer.remove();
    },
  };
}
