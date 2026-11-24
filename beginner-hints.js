import {t} from './i18n.js?v=23dea509222127b3';

const icons = {success: '✓', incorrect: '×', warning: 'Ⅱ', info: 'i', schedule: '◷'};
const seenEvents = new Set();
let region, timer, frame, pending;
const routePath = url => new URL(url).hash.split('?')[0];

function hideLearningHint() {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  region?.replaceChildren();
}

export function clearLearningHint() {
  pending = null;
  hideLearningHint();
}

window.addEventListener('hashchange', event => {
  if (routePath(event.oldURL) !== routePath(event.newURL)) clearLearningHint();
});
document.addEventListener('visibilitychange', () => {
  if (pending && !document.hidden) showLearningHint();
});

export function learningHint(access, message, eventId, tone = 'info') {
  if (access?.beginner_mode_enabled !== true || !message) return;
  const event = eventId && `${access.learner_id}:${eventId}`;
  if (seenEvents.has(event) || (event && event === pending?.event)) return;
  pending = {message, event, tone, path: routePath(location.href)};
  if (!document.hidden) showLearningHint();
}

function showLearningHint() {
  const hint = pending;
  if (hint.path !== routePath(location.href)) { clearLearningHint(); return; }
  if (!region) {
    region = document.createElement('div');
    region.className = 'beginnerHint';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  hideLearningHint();
  frame = requestAnimationFrame(() => {
    if (document.hidden) return;
    if (hint.path !== routePath(location.href)) { clearLearningHint(); return; }
    pending = null;
    if (hint.event) {
      seenEvents.add(hint.event);
      if (seenEvents.size > 64) seenEvents.delete(seenEvents.values().next().value);
    }
    const icon = document.createElement('span');
    icon.className = 'beginnerHintIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = icons[hint.tone];
    const label = document.createElement('span');
    label.textContent = hint.message;
    region.dataset.tone = hint.tone;
    region.replaceChildren(icon, label);
    timer = setTimeout(hideLearningHint, 4500);
  });
}

export function practiceHint(access, feedback, completionKey) {
  const effect = feedback.learning_effect || {};
  const messages = [];
  let tone = 'success';
  if (effect.queue_added > 0) {
    const key = effect.queue_added === 1 ? 'beginner.queueOne' : effect.queue_added === 2 ? 'beginner.queueTwo' : 'beginner.queue';
    messages.push(t(key, {count: effect.queue_added}));
  } else if (feedback.correct === false) {
    messages.push(t('beginner.incorrect'));
  }
  if (feedback.correct === false) tone = 'incorrect';
  if (effect.paused) messages.push(t('beginner.paused'));
  else if (effect.target_added > 0) messages.push(t('beginner.target', {count: effect.target_added}));
  if (effect.example_passed) messages.push(t('beginner.examplePassed'));
  else if (completionKey) messages.push(t(completionKey));
  learningHint(access, messages.join(' '), feedback.submission_id, tone);
}
