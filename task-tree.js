// Native details/summary groups are shared by task trees and Markdown outlines.
export function createOutlineGroup(title, {expanded, key, open = false, className = ''} = {}) {
  const group = document.createElement('details'); group.className = `courseUnitGroup ${className}`.trim();
  const summary = document.createElement('summary'); summary.className = 'courseUnitHeading';
  if (typeof title === 'string') summary.textContent = title;
  else summary.append(title);
  const body = document.createElement('div'); body.className = 'courseUnitBody';
  group.open = expanded?.get(key) ?? open;
  if (expanded) group.addEventListener('toggle', () => expanded.set(key, group.open));
  group.append(summary, body);
  return {group, summary, body};
}

export function enhanceMarkdownOutline(root, {expanded = new Map(), keyPrefix = ''} = {}) {
  // Fold heading sections, then list branches; preserve sanitized content nodes.
  const sections = [], nodes = [...root.childNodes];
  let ordinal = 0;
  for (const item of nodes) {
    const level = /^H[1-6]$/.test(item.nodeName) ? Number(item.nodeName[1]) : 0;
    if (level) {
      while (sections.length && sections.at(-1).level >= level) sections.pop();
      const key = `${keyPrefix}:heading:${item.id || ordinal++}`;
      const parent = sections.at(-1)?.body || root;
      const {group, body} = createOutlineGroup(item, {expanded, key, open: !sections.length, className: 'guideOutline'});
      parent.append(group); sections.push({level, body, key});
    } else if (sections.length) sections.at(-1).body.append(item);
  }
  const visit = (list, prefix) => {
    [...list.children].forEach((li, index) => {
      if (li.tagName !== 'LI') return;
      const children = [...li.children].filter(n => n.tagName === 'UL' || n.tagName === 'OL');
      const key = `${prefix}:item:${index}`;
      if (children.length) {
        const beforeList = [...li.childNodes].slice(0, [...li.childNodes].indexOf(children[0]));
        // Tight Markdown lists use text and inline nodes instead of a paragraph.
        if (beforeList.some(n => n.textContent.trim())) {
          const label = document.createElement('span');
          for (const node of beforeList) {
            if (node.nodeName === 'P') { label.append(...node.childNodes); node.remove(); }
            else label.append(node);
          }
          const {group, body} = createOutlineGroup(label, {expanded, key, className: 'guideOutline'});
          body.append(...li.childNodes); li.append(group);
        }
      }
      for (const child of children) visit(child, key);
    });
  };
  for (const list of [...root.querySelectorAll('ul,ol')].filter(n => !n.parentElement.closest('ul,ol'))) {
    const owner = list.closest('details')?.querySelector('summary [id]')?.id || 'section';
    visit(list, `${keyPrefix}:${owner}:list:${ordinal++}`);
  }
  root.onclick = event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor) return;
    let id; try { id = decodeURIComponent(anchor.getAttribute('href').slice(1)); } catch { return; }
    const target = [...root.querySelectorAll('[id]')].find(n => n.id === id);
    if (!target) return;
    event.preventDefault();
    for (let parent = target.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS') parent.open = true;
    }
    target.scrollIntoView({block: 'start'});
  };
  return root;
}

// Refill only Topic slots, using the incoming order to break topological ties.
export function orderTopicSiblings(entries, topicOf, parentOf = () => null) {
  const result = [...entries], siblings = new Map();
  entries.forEach((entry, index) => {
    const topic = topicOf(entry);
    if (!topic) return;
    const parent = parentOf(topic);
    if (!siblings.has(parent)) siblings.set(parent, []);
    const key = topic.dependency_node_id || topic.topic_id || topic.id;
    const parents = (topic.prerequisite_details?.length ? topic.prerequisite_details : topic.prerequisites || [])
      .map(parent => typeof parent === 'string' ? parent : parent.id);
    const ready = topic.dependency_ready !== false && !topic.locked && topic.status !== 'paused' && !topic.maintenance;
    siblings.get(parent).push({entry, index, key, parents, ready});
  });
  for (const slots of siblings.values()) {
    if (slots.length < 2) continue;
    let position = 0;
    for (const ready of [true, false]) {
      const remaining = new Map(slots.filter(item => item.ready === ready).map(item => [item.key, item]));
      while (remaining.size) {
        let next;
        for (const item of remaining.values()) {
          if (!item.parents.some(parent => remaining.has(parent))) {
            next = item;
            break;
          }
        }
        // Validated graphs are acyclic. Preserve remaining order for stale or inconsistent data.
        if (!next) {
          for (const item of remaining.values()) result[slots[position++].index] = item.entry;
          break;
        }
        result[slots[position++].index] = next.entry;
        remaining.delete(next.key);
      }
    }
  }
  return result;
}

// The same tree renderer serves courses, banks and review source directories.
export function renderTaskTree(pending, data, {renderTask, expanded, keyPrefix = '', sourceOrder = [], defaultOpen = false, sortTopics = false}) {
  const tasks = new Map(data.tasks.map(task => [task.topic_id || task.id, task]));
  const containers = new Map(), rendered = new Set(), cards = new Map();
  const renderCard = task => {
    const card = renderTask(task);
    cards.set(card, task);
    return card;
  };
  const units = new Map((data.pending_hierarchy || []).map(unit => [unit.id, unit])), needed = new Set();
  // All task sources share the same pruning: keep only ancestors of tasks
  // still present in this tree (completed tasks are rendered in history).
  for (const unit of units.values()) if ((unit.topic_ids || []).some(id => tasks.has(id))) {
    for (let parent = unit; parent && !needed.has(parent.id); parent = units.get(parent.parent_id)) needed.add(parent.id);
  }
  const parents = new Set([...units.values()].filter(unit => needed.has(unit.id)).map(unit => unit.parent_id));
  for (const unit of data.pending_hierarchy || []) {
    if (!needed.has(unit.id)) continue;
    // Collapse only an actual terminal singleton, never a multi-item chapter
    // temporarily reduced by a progress/filter view. Identity stays on the card.
    if (!parents.has(unit.id) && unit.topic_ids?.length === 1 && tasks.has(unit.topic_ids[0])) {
      const id = unit.topic_ids[0], task = tasks.get(id);
      const card = renderCard({...task, outline_title: unit.title});
      card.dataset.unitId = unit.id;
      containers.set(unit.id, {group: card, body: null}); rendered.add(id);
      continue;
    }
    const key = `${keyPrefix}:${data.course.id}:${unit.id}`;
    const {group, body} = createOutlineGroup(unit.title, {expanded, key, open: defaultOpen || !unit.parent_id});
    group.dataset.unitId = unit.id;
    containers.set(unit.id, {group, body});
    for (const id of unit.topic_ids || []) if (tasks.has(id)) {
      body.append(renderCard(tasks.get(id))); rendered.add(id);
    }
  }
  for (const unit of data.pending_hierarchy || []) {
    if (!containers.has(unit.id)) continue;
    (containers.get(unit.parent_id)?.body || pending).append(containers.get(unit.id).group);
  }
  for (const [id, task] of tasks) if (!rendered.has(id)) pending.append(renderCard(task));
  const order = new Map(sourceOrder.map((id, index) => [id, index]));
  if (order.size || sortTopics) {
    const position = element => order.get(element.dataset.unitId || element.dataset.taskId) ?? Number.MAX_SAFE_INTEGER;
    for (const body of [pending, ...[...containers.values()].map(item => item.body).filter(Boolean)]) {
      const entries = [...body.children];
      if (order.size) entries.sort((a, b) => position(a) - position(b));
      body.append(...(sortTopics ? orderTopicSiblings(entries, card => cards.get(card)) : entries));
    }
  }
}
