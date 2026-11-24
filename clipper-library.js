import {clipText as tx} from './clipper.js?v=b166183de20b7ca0';
import {renderPlainMath} from './math-presentation.js?v=b166183de20b7ca0';

export function mountClipperLibrary({root, request, node, control, link, isCurrent}) {
  const active = () => isCurrent() && root.isConnected;
  const header = node('h2', 'trainingSectionTitle', tx('零碎知识简藏', 'Knowledge Clipper'));
  const nav = node('div', 'clipperButtons');
  const result = node('div', 'clipperLibraryBody');
  const status = node('p', 'fieldError');
  status.setAttribute('role', 'status');
  root.append(header, nav, status, result);

  const modes = [
    ['review', tx('复习到期卡片', 'Review due cards')],
    ['card', tx('卡片', 'Cards')],
    ['excerpt', tx('摘录', 'Excerpts')],
  ];
  let epoch = 0, labels = null;
  const clipText = value => {
    const block = node('div', 'clipperText', value);
    renderPlainMath(block, value);
    return block;
  };
  const itemSource = item => item.source.route ? link(item.source.title || tx('查看来源', 'Open source'), item.source.route) : '';

  function bibliography(item, doc) {
    const source = itemSource(item);
    if (source) doc.append(source);
    if (item.back) doc.append(clipText(item.back));
  }

  async function select(mode) {
    const ticket = ++epoch;
    const current = () => active() && ticket === epoch;
    for (const button of nav.children) button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    result.replaceChildren();
    status.textContent = '';
    const rows = node('div');
    const pager = node('div', 'clipperButtons');
    const groups = new Map();
    const days = new Map();
    if (mode === 'excerpt') {
      const download = node('div', 'clipperButtons clipperExport');
      for (const [period, label] of [['today', tx('导出今天', 'Export today')], ['all', tx('导出全部', 'Export all')]]) {
        const button = control(label, 'textButton', async () => {
          button.disabled = true;
          try {
            const {markdown, count} = await request('clipper/excerpts?period=' + period);
            if (!current()) return;
            if (!count) {
              status.textContent = tx('这个范围没有摘录。', 'No excerpts in this range.');
              return;
            }
            const url = URL.createObjectURL(new Blob([markdown], {type: 'text/markdown;charset=utf-8'}));
            const anchor = node('a');
            anchor.href = url;
            anchor.download = (period === 'today' ? '零碎知识简藏-今日摘录' : '零碎知识简藏-全部摘录') + '.md';
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            status.textContent = '';
          } catch (error) {
            if (current()) status.textContent = error.message;
          } finally { button.disabled = false; }
        });
        download.append(button);
      }
      result.append(download);
    }
    result.append(rows, pager);

    function browse(item) {
      const key = mode === 'card' ? item.type_id : 'excerpt';
      if (!groups.has(key)) {
        const group = node('section', 'clipperLibraryGroup');
        if (mode === 'card') group.append(node('h3', '', labels.get(key) || key));
        groups.set(key, group);
        rows.append(group);
      }
      const dayKey = key + ':' + item.day;
      if (!days.has(dayKey)) {
        const dated = node('section', 'clipperLibraryDay');
        dated.append(node('h4', '', item.day));
        days.set(dayKey, dated);
        groups.get(key).append(dated);
      }
      if (mode === 'excerpt') {
        const excerpt = node('article', 'clipperLibraryItem');
        excerpt.append(clipText(item.front));
        const source = itemSource(item);
        if (source) excerpt.append(source);
        days.get(dayKey).append(excerpt);
      } else {
        const clip = node('details', 'clipperLibraryItem');
        const summary = node('summary');
        summary.append(clipText(item.front));
        clip.append(summary);
        bibliography(item, clip);
        days.get(dayKey).append(clip);
      }
    }

    function review(card) {
      const attempt = crypto.randomUUID(), section = node('section', 'clipperReview');
      const grades = node('div', 'clipperButtons');
      const next = control(tx('翻看背面', 'Show back'), 'primaryButton', () => {
        next.replaceWith(clipText(card.back), grades);
        grades.firstElementChild.focus();
      });
      section.append(node('p', 'inputHint', labels.get(card.type_id) || card.type_id), clipText(card.front), next);
      for (const [rating, label] of [
        [1, tx('重来', 'Again')], [2, tx('困难', 'Hard')], [3, tx('良好', 'Good')], [4, tx('简单', 'Easy')],
      ]) {
        const grade = control(label, 'secondaryButton', async () => {
          for (const button of grades.children) button.disabled = true;
          status.textContent = '';
          try {
            await request('clipper/review', {method: 'POST', body: {
              id: card.id, attempt, revision: card.revision, rating,
            }});
            if (current()) { rows.replaceChildren(); await load(0); }
          } catch (error) {
            if (!current()) return;
            status.textContent = error.message;
            grade.disabled = false;
          }
        });
        grades.append(grade);
      }
      rows.replaceChildren(section);
    }

    async function load(offset) {
      pager.replaceChildren();
      try {
        const parameters = new URLSearchParams({
          kind: mode === 'excerpt' ? mode : 'card', due: mode === 'review', offset,
          limit: mode === 'review' ? 1 : 30, compact: true,
        });
        const [{items, next}] = await Promise.all([
          request('clipper/items?' + parameters),
          mode !== 'excerpt' && !labels ? request('clipper/types').then(({types}) => {
            labels = new Map(types.map(type => [type.id, type.label]));
          }) : null,
        ]);
        if (!current()) return;
        status.textContent = '';
        if (mode === 'review' && items.length) review(items[0]);
        else if (items.length) items.forEach(browse);
        else if (!offset) rows.replaceChildren(node('p', 'inputHint', mode === 'review'
          ? tx('目前没有到期的个人卡片。', 'No personal cards are due.')
          : tx('这里还没有内容。', 'There are no clips here yet.')));
        if (next !== null && mode !== 'review') pager.append(control(tx('加载更多', 'Load more'),
          'secondaryButton', () => void load(next)));
      } catch (error) {
        if (current()) {
          status.textContent = error.message;
          pager.append(control(tx('重试', 'Retry'), 'secondaryButton', () => void load(offset)));
        }
      }
    }

    await load(0);
  }

  for (const [mode, label] of modes) {
    const button = control(label, 'textButton', () => void select(mode));
    button.dataset.mode = mode;
    nav.append(button);
  }
  void select('review');
}
