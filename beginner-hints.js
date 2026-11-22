import {t} from './i18n.js?v=be658212c777c70e';

let region, timer, frame, lastEvent;

export function clearLearningHint() {
  clearTimeout(timer);
  cancelAnimationFrame(frame);
  if (region) region.textContent = '';
}

window.addEventListener('hashchange', clearLearningHint);

export function learningHint(access, message, eventId) {
  if (access?.beginner_mode_enabled !== true || !message || document.hidden) return;
  const event = eventId && `${access.learner_id}:${eventId}`;
  if (event && event === lastEvent) return;
  lastEvent = event;
  if (!region) {
    region = document.createElement('div');
    region.className = 'beginnerHint';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-atomic', 'true');
    document.body.append(region);
  }
  clearLearningHint();
  frame = requestAnimationFrame(() => {
    region.textContent = message;
    timer = setTimeout(clearLearningHint, 4500);
  });
}

export function practiceHint(access, feedback, submissionId) {
  const effect = feedback?.learning_effect;
  if (!effect || feedback.submission_id !== submissionId) return;
  const messages = [];
  if (effect.example_passed) messages.push(t('beginner.examplePassed'));
  if (effect.queue_added > 0) {
    const key = effect.queue_added === 1 ? 'beginner.queueOne' : effect.queue_added === 2 ? 'beginner.queueTwo' : 'beginner.queue';
    messages.push(t(key, {count: effect.queue_added}));
  }
  if (effect.paused) messages.push(t('beginner.paused'));
  else if (effect.target_added > 0) messages.push(t('beginner.target', {count: effect.target_added}));
  learningHint(access, messages.join(' '), submissionId);
}
