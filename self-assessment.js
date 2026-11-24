import {t} from './i18n.js?v=90073ee663f3a496';
import {answerEmpty} from './question-input.js?v=90073ee663f3a496';
import {prepareMathContent, renderPlainMath, setOptionContent} from './math-presentation.js?v=90073ee663f3a496';
import {answerAssessment} from './point-assessment.js?v=90073ee663f3a496';
import {fromWhiteboard, whiteboardText} from './whiteboard-answer.js?v=90073ee663f3a496';

const element = (tag, cls, text) => {
  const node = document.createElement(tag); node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function prepareAnswerContent(root, {explanation = false} = {}) {
  root.classList.add('answerContent');
  if (explanation) prepareExplanationLayout(root);
  return prepareMathContent(root, {literal: true});
}

// Split only source boundaries. Moving DOM fragments retains TeX, images,
// emphasis, original wording and content-report offsets; nothing is rewritten.
export function prepareExplanationLayout(root) {
  if (root.dataset.explanationLayout) return root;
  root.dataset.explanationLayout = 'true';
  root.classList.add('explanationContent');
  const protectedSelector = 'svg,math,mjx-container,code,pre,a,[data-tex]';
  for (const paragraph of [...root.querySelectorAll('p')]) {
    if (paragraph.closest('pre,code,figcaption,[data-help-action]')) continue;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT), cuts = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement.closest(protectedSelector)) continue;
      const pattern = /(?:^|[。；;\n])\s*(?=(?:[（(](?:\d{1,2}|[a-h]|I{1,3}|IV|V)[）)]|[①-⑳]|[A-L](?:\s*(?:[.．、:：)）]|选项|项|的|中|可|是|为|错误|正确))))/gu;
      for (const match of node.textContent.matchAll(pattern)) {
        const offset = match.index + match[0].length;
        // The beginning of an existing paragraph is already a boundary.
        const prefix = document.createRange(); prefix.selectNodeContents(paragraph); prefix.setEnd(node, offset);
        if (prefix.toString().trim()) cuts.push({node, offset});
      }
    }
    for (const {node, offset} of cuts.reverse()) {
      if (!paragraph.contains(node)) continue;
      const range = document.createRange(); range.selectNodeContents(paragraph); range.setStart(node, offset);
      const next = document.createElement('p'); next.className = 'explanationItem';
      next.append(range.extractContents()); paragraph.after(next);
    }
    paragraph.classList.add('explanationItem');
  }
  for (const math of root.querySelectorAll('.mathInline[data-tex]')) {
    if (/\\begin\{(?:[bpvBV]?matrix|array|aligned|cases)\}/u.test(math.dataset.tex)) {
      math.classList.add('answerMatrix');
      // Keep punctuation beside the displayed formula instead of stranding a
      // comma at the start of the next prose line. Text order stays identical.
      const next = math.nextSibling;
      const punctuation = next?.nodeType === Node.TEXT_NODE && next.textContent.match(/^[ \t]*[，,；;。.!！？?：:]+[ \t]*/u)?.[0];
      if (punctuation) { math.append(document.createTextNode(punctuation)); next.deleteData(0, punctuation.length); }
    }
  }
  return root;
}

export function submittedAnswer(question, answer, display = answer) {
  if (fromWhiteboard(answer)) {
    const text = whiteboardText(answer);
    const body = element('pre', '', text);
    renderPlainMath(body, text);
    return body;
  }
  const spec = question.interaction || question.question?.interaction;
  let value; try { value = JSON.parse(answer); } catch { /* Keep literal free answers. */ }
  const selected = spec?.type === 'choice' ? new Set(spec.multiple ? value?.selected || [] : [value?.selected]) : new Set();
  const options = spec?.options?.filter(option => selected.has(option.id)) || [];
  if (!options.length) {
    const text = display || '';
    const body = element('pre', '', text);
    if (!spec || spec.type === 'text') renderPlainMath(body, text);
    return body;
  }
  const body = element('div', 'submittedAnswerBody');
  for (const option of options) {
    const row = element('div', 'choiceAnswer');
    setOptionContent(row, option);
    body.append(row);
  }
  return prepareAnswerContent(body);
}

export function referenceAnswer(question) {
  const type = question.interaction?.type || question.question?.interaction?.type;
  if (type === 'text' || !type && !question.reference_answer_html) return null;
  if (!question.reference_answer_html && !question.reference_answer) return null;
  const box = element('section', 'referenceAnswer');
  box.append(element('h3', 'exampleExplanationHeader', t('training.referenceAnswer')));
  const body = element('div', 'courseContent referenceAnswerBody');
  const spec = question.interaction || question.question?.interaction;
  const items = question.choice_feedback?.items;
  const correctIds = question.choice_feedback?.correct_ids;
  const correctOptions = spec?.type === 'choice' && correctIds?.length
    ? spec.options.filter(option => correctIds.includes(option.id)) : [];
  if (correctOptions.length) {
    for (const option of correctOptions) body.append(setOptionContent(element('div', 'choiceAnswer'), option));
  } else if (items?.length && document.body?.dataset?.subject === 'english') {
    const results = new Map((answerAssessment(question)?.items || [])
      .filter(item => typeof item.correct === 'boolean').map(item => [item.id, item.correct]));
    const controls = spec.controls || spec.blanks || spec[spec.fixed_side] || [];
    body.classList.add('referenceItems');
    for (const item of items) {
      const control = controls.find(c => c.id === item.id); if (!control) continue;
      const row = element('div', 'referenceItem'); row.dataset.controlId = item.id;
      const label = control.label || control.text || String(controls.indexOf(control) + 1);
      const number = label.match(/^(?:\(|\[|（)?(\d+)(?:[.)\]）、]|$)/)?.[1];
      row.append(element('span', 'referenceItemNumber', number || label));
      const answer = element('span', 'referenceItemAnswer');
      const correct = results.get(item.id);
      if (typeof correct === 'boolean') answer.dataset.answerTruth = String(correct);
      const options = control.options || (spec.type === 'matching' ? spec[spec.fixed_side === 'left' ? 'right' : 'left'] : null);
      if (options && item.correct_ids?.length) {
        const option = options.find(option => item.correct_ids.includes(option.id));
        if (option) {
          answer.append(element('span', 'referenceLetter', String.fromCharCode(65 + options.indexOf(option))));
          if (correct !== true) {
            const text = element('span', 'referenceOptionText');
            setOptionContent(text, option);
            answer.append(document.createTextNode(' · '), text);
          }
        }
      } else answer.textContent = item.answer || '';
      row.append(answer); body.append(row);
    }
  } else if (question.reference_answer_html) body.innerHTML = question.reference_answer_html;
  else body.textContent = question.reference_answer;
  if (question.reference_math_css) { const style = element('style', ''); style.textContent = question.reference_math_css; box.append(style); }
  box.append(prepareAnswerContent(body)); return box;
}

function renderRatingChoices(choices, {selected, disabled = false, onRate}, binary = false) {
  const ratings = element('div', 'trainingRatings');
  ratings.style.setProperty('--rating-count', String(choices.length));
  choices.forEach(([rating, label]) => {
    const style = binary ? `stepOutcome ${rating === 1 ? 'outcomeIncorrect' : 'outcomeCorrect'}` : `rating${rating}`;
    const control = element('button', `trainingRating ${style}`);
    control.type = 'button'; control.disabled = disabled; control.dataset.rating = rating;
    control.setAttribute('aria-pressed', String(selected === rating));
    control.setAttribute('aria-label', binary ? t(label) : `${rating} · ${t(label)}`); control.title = t(label);
    if (binary) control.append(element('span', '', t(label)));
    else control.append(element('span', '', String(rating)), element('small', 'ratingLabel', t(label)),
      element('small', 'ratingCompactLabel', t(`atomic.ratingShort${rating}`)));
    control.addEventListener('click', async () => {
      control.setAttribute('aria-busy', 'true');
      for (const child of ratings.children) child.disabled = true;
      try { await onRate(rating); }
      finally {
        control.removeAttribute('aria-busy');
        if (ratings.isConnected) for (const child of ratings.children) child.disabled = disabled;
      }
    });
    ratings.append(control);
  });
  return ratings;
}

export function ratingChoices({labels, ...controls}) {
  return renderRatingChoices(labels.map((label, index) => [index + 1, label]), controls);
}

export function selfAssessmentChoices(question, {courseQuestion = false, canStop = question.can_stop_reviews, ...controls}) {
  if (question.multi_step || courseQuestion) {
    // Keep the existing API values for course answers and individual steps.
    const correct = question.multi_step ? 5 : 4;
    return renderRatingChoices([[1, 'question.didWrong'], [correct, 'question.didRight']], controls, true);
  }
  const labels = ['training.again', 'training.hard', 'training.good', 'training.easy'];
  if (canStop) labels.push('training.retire');
  return ratingChoices({labels, ...controls});
}

export function showAnswerButton(reveal, {disabled = false, input, label = t('training.show')} = {}) {
  const show = element('button', 'secondaryButton showAnswer', label);
  show.type = 'button';
  show.disabled = disabled;
  if (input !== undefined) {
    const refresh = () => { show.hidden = !answerEmpty(input); };
    input?.addEventListener('input', refresh); refresh();
  }
  show.addEventListener('click', () => { if (!show.disabled) void reveal(); });
  return show;
}

// Course submissions keep the original wire values, including in saved history.
export function isCourseSelfRating(value) {
  return /^自主评分：[1-4]$/.test(value ?? '');
}

// Shared controls; each reader keeps its original submission and grading policy.
export function selfAssessment(question, input, {disabled = false, reveal, rate, explanation, courseQuestion} = {}) {
  if (!question.can_self_rate) return null;
  const box = element('div', 'selfAssessment');
  if (!question.revealed) {
    box.append(showAnswerButton(reveal, {disabled, input: input ?? null}));
    return box;
  }
  const reference = referenceAnswer(question); if (reference) box.append(reference);
  if (explanation) box.append(element('h3', 'exampleExplanationHeader', t('Explanation · 解析')), prepareAnswerContent(explanation, {explanation: true}));
  const ratings = selfAssessmentChoices(question, {courseQuestion, disabled, selected: question.self_rating, onRate: rate});
  box.append(ratings); return box;
}
