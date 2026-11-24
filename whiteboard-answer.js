const prefix = '\u241eGME-WHITEBOARD-1\n';

export function fromWhiteboard(value) {
  return typeof value === 'string' && value.startsWith(prefix);
}

export function whiteboardText(value) {
  return fromWhiteboard(value) ? value.slice(prefix.length) : value;
}

export function questionWhiteboard({key, editable, current, submit, request, question, language, activePart}) {
  if (!key || question.academy || question.hyperskill || question.interaction?.grading === 'unavailable') return;
  const ocrLanguage = language === 'en' ? 'en' : 'zh';
  const content = document.createElement('template');
  content.innerHTML = [question.html, activePart?.html].filter(Boolean).join('<br>');
  for (const element of content.content.querySelectorAll('script,style,template,[hidden],[inert],[aria-hidden="true"]')) element.remove();
  for (const element of content.content.querySelectorAll('[style]')) {
    if (element.style.display === 'none' || element.style.visibility === 'hidden') element.remove();
  }
  for (const details of content.content.querySelectorAll('details:not([open])')) details.replaceWith(details.querySelector('summary')?.textContent || '');
  for (const formula of content.content.querySelectorAll('[data-tex],[data-math-source]')) {
    formula.replaceWith(formula.getAttribute('data-tex') || formula.getAttribute('data-math-source') || '');
  }
  for (const image of content.content.querySelectorAll('img')) image.replaceWith(image.alt || '');
  for (const element of content.content.querySelectorAll('p,li,br,tr,div')) element.after('\n');
  const text = [...[content.content.textContent || question.question || '', question.constraints || ''].join('\n').trim()]
    .slice(0, 7000).join('').toWellFormed();
  return {
    key, editable, isCurrent: current,
    submit: async png => {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(png);
      });
      if (!current()) return '';
      const result = await request('whiteboard/recognize', {method: 'POST', timeout: 38000, body: {image, question: text, language: ocrLanguage}});
      if (!current()) return '';
      if (result.status === 'insufficient') return result.feedback;
      if (result.status !== 'ready' || typeof result.answer !== 'string' || !result.answer.trim()) {
        throw Error(ocrLanguage === 'en' ? 'The whiteboard could not be read.' : '未能读取白板作答。');
      }
      await submit(prefix + result.answer);
      return '';
    },
  };
}
