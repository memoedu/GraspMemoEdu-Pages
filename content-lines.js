// Measure rendered lines without changing the source DOM or its text offsets.
export function measureLineBands(collect) {
  const bands = [], inlineAtoms = [];
  function add(rect, value, atomic = false) {
    if (rect.width < .1 || rect.height < .1) return;
    const center = (rect.top + rect.bottom) / 2;
    let band = !atomic && bands.find(b => Math.abs(b.center - center) < Math.min(b.height, rect.height) * .4);
    if (!band) {
      band = {top: rect.top, bottom: rect.bottom, center, height: rect.height, ranges: []};
      bands.push(band);
    }
    band.ranges.push(value);
    band.top = Math.min(band.top, rect.top);
    band.bottom = Math.max(band.bottom, rect.bottom);
  }
  function text(node, offsets, exact = false) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = !exact && range.getClientRects();
    if (rects && rects.length === 1) {
      add(rects[0], offsets(0, node.length, 0, [...node.data].length));
      return;
    }
    let offset = 0, point = 0;
    for (const char of node.data) {
      range.setStart(node, offset);
      const start = offset;
      offset += char.length;
      range.setEnd(node, offset);
      add(range.getBoundingClientRect(), offsets(start, offset, point, point + 1));
      point++;
    }
  }
  function atom(node, value) {
    if (!node.getClientRects().length) return;
    const rect = node.getBoundingClientRect();
    if (getComputedStyle(node).display.startsWith('inline')) inlineAtoms.push({rect, value});
    else add(rect, value, true);
  }
  collect({text, atom});
  for (const {rect, value} of inlineAtoms) {
    const band = bands.find(b => Math.min(b.bottom, rect.bottom) - Math.max(b.top, rect.top) > b.height * .4);
    if (band) {
      band.ranges.push(value);
      band.top = Math.min(band.top, rect.top);
      band.bottom = Math.max(band.bottom, rect.bottom);
    } else add(rect, value, true);
  }
  return bands.sort((a, b) => a.top - b.top);
}

export function drawLineMarquee(element, x, y, event) {
  const left = Math.min(x, event.clientX), top = Math.min(y, event.clientY);
  const right = Math.max(x, event.clientX), bottom = Math.max(y, event.clientY);
  const base = element.parentElement.getBoundingClientRect();
  element.hidden = false;
  Object.assign(element.style, {left: `${left - base.left}px`, top: `${top - base.top}px`,
    width: `${right - left}px`, height: `${bottom - top}px`});
  return {left, top, right, bottom};
}

export function marqueeHitsLine(box, row) {
  return box.left < row.right && box.right > row.left && box.top < row.bottom && box.bottom > row.top;
}
