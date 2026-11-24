import {t, translateMessage} from './i18n.js?v=2469085234b24522';
import {subjectHref, subjectLabel} from './subjects.js?v=2469085234b24522';
import {catalogPath, workspaceLayout} from './catalog-workspace.js?v=2469085234b24522';
import {renderReviewSections} from './review-directory.js?v=2469085234b24522';
import {createReviewTaskStarter} from './review-papers.js?v=2469085234b24522';

const encode = encodeURIComponent;

export function createFreeStudyView({root, request, scopedRequest, savedCourseRoot, taskTree, node, control, link, loading}) {
  let dispose = () => {};

  async function open({subjects, canReview, canClip, isCurrent}) {
    let selection = (await request('free-study')).subjects;
    if (!isCurrent()) return;

    const title = node('h1', 'portalPageTitle', t('freeStudy.title'));
    const market = control(t('freeStudy.market'), 'secondaryButton', () => edit());
    market.setAttribute('aria-haspopup', 'dialog');
    const header = node('header', 'freeStudyHeader');
    header.append(title, market);
    const sidebar = node('nav', 'freeStudySidebar');
    sidebar.setAttribute('aria-label', t('freeStudy.selectedSubjects'));
    const {layout, tasks} = workspaceLayout(sidebar);
    layout.classList.add('freeStudyLayout');

    const dialog = node('dialog', 'identityDialog freeStudyMarket');
    dialog.setAttribute('aria-labelledby', 'freeStudyMarketTitle');
    const dialogTitle = node('h2', '', t('freeStudy.market'));
    dialogTitle.id = 'freeStudyMarketTitle';
    const dialogHeader = node('div', 'dialogHeading');
    const close = control(t('freeStudy.close'), 'textButton', () => dialog.close());
    dialogHeader.append(dialogTitle, close);
    const chooser = node('select');
    chooser.id = 'freeStudySubject';
    const field = node('label', '', t('freeStudy.subject'));
    field.htmlFor = chooser.id;
    for (const subject of subjects) {
      const option = node('option', '', subjectLabel(subject));
      option.value = subject.id;
      chooser.append(option);
    }
    const editor = node('div');
    dialog.append(dialogHeader, field, chooser, editor);
    const current = id => selection.find(entry => entry.subject_id === id);

    let reviewGeneration = 0, editGeneration = 0;
    const timers = new Set();
    function clearReviews() {
      ++reviewGeneration;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    }
    dispose = () => {
      clearReviews();
      ++editGeneration;
      if (dialog.open) dialog.close();
    };

    function renderReviews(section, subject) {
      const generation = reviewGeneration;
      const active = () => isCurrent() && generation === reviewGeneration;
      const read = (path, options) => scopedRequest(path, options, subject.id);
      const href = path => subjectHref(subject.id, path.replace(/^#/, ''));
      const start = createReviewTaskStarter({request: read, href, isCurrent: active});
      const inbox = node('div'), courses = node('div');
      section.append(node('h3', 'trainingSectionTitle', t('paper.title')));
      if (!canReview) {
        section.append(node('p', 'inputHint', t('portal.learning.is.not.enabled.for.your.account.please.contact.your.admi.55')));
        return;
      }
      section.append(inbox, courses);

      function refresh(target, path, render) {
        let previous;
        target.append(loading());
        async function load() {
          try {
            if (previous === undefined || !document.hidden) {
              const data = await read(path);
              if (!active()) return;
              const signature = JSON.stringify(data);
              if (previous !== signature) {
                target.replaceChildren();
                render(data);
                previous = signature;
              }
            }
          } catch (error) {
            if (!active()) return;
            previous = undefined;
            target.replaceChildren(node('p', 'fieldError', translateMessage(error.message)));
          }
          if (!active()) return;
          const timer = setTimeout(() => { timers.delete(timer); void load(); }, 15000);
          timers.add(timer);
        }
        void load();
      }

      refresh(inbox, 'review-papers/inbox', data => renderReviewSections(inbox, data, {taskTree, start}));
      refresh(courses, 'free-study/course-reviews', data => {
        if (!data.tasks.length) return;
        courses.append(node('h4', 'trainingSectionTitle', t('freeStudy.courseReviews')));
        const list = node('div', 'courseTree');
        const target = task => href(task.start_href + (task.start_href.includes('?') ? '&' : '?') + 'course=' + encode(task.course_id));
        taskTree(list, {...data, course: {id: `free-study:${subject.id}`}}, {review: true, target});
        courses.append(list);
      });
    }

    function render() {
      clearReviews();
      tasks.replaceChildren();
      sidebar.replaceChildren();
      sidebar.hidden = !selection.length;
      layout.classList.toggle('freeStudyEmpty', !selection.length);
      if (!selection.length) {
        tasks.append(node('p', 'portalEmpty', t('freeStudy.empty')));
        return;
      }
      for (const subject of subjects) {
        const entry = current(subject.id);
        if (!entry) continue;
        const section = node('section', 'freeStudySubject');
        const id = `freeStudy-${subject.id}`;
        const heading = node('h2', '', subjectLabel(subject));
        heading.id = id;
        section.setAttribute('aria-labelledby', id);
        const bar = node('header', 'freeStudyHeader');
        bar.append(heading, control(t('freeStudy.edit'), 'textButton', () => edit(subject.id)));
        section.append(bar);
        sidebar.append(control(subjectLabel(subject), 'textButton', () => {
          heading.tabIndex = -1;
          heading.focus({preventScroll: true});
          heading.scrollIntoView({block: 'start'});
        }));
        if (entry.course) {
          const coursePath = catalogPath('courses', entry.course.id, savedCourseRoot(entry.course.id, subject.id));
          section.append(collection(t('freeStudy.currentCourse'), [link(entry.course.title, subjectHref(subject.id, coursePath))]));
        }
        if (entry.banks.length) section.append(collection(t('training.banks'), entry.banks.map(bank =>
          link(bank.title, subjectHref(subject.id, catalogPath('banks', bank.id))))));
        if (!entry.course && !entry.banks.length && !entry.show_reviews) section.append(node('p', 'inputHint', t('freeStudy.noContent')));
        if (entry.show_reviews) {
          const review = node('div', 'freeStudyReviews');
          section.append(review);
          renderReviews(review, subject);
        }
        tasks.append(section);
      }
    }

    function collection(title, links) {
      const section = node('div');
      const list = node('ul', 'freeStudyLinks');
      for (const anchor of links) {
        const item = node('li'); item.append(anchor); list.append(item);
      }
      section.append(node('h3', 'trainingSectionTitle', title), list);
      return section;
    }

    function checkbox(label, checked) {
      const row = node('label', 'freeStudyOption'), input = node('input');
      input.type = 'checkbox'; input.checked = checked;
      row.append(input, node('span', '', label));
      return {row, input};
    }

    async function loadEditor() {
      const subjectId = chooser.value, generation = ++editGeneration;
      const active = () => isCurrent() && dialog.open && generation === editGeneration;
      editor.replaceChildren(loading());
      try {
        const data = await scopedRequest('free-study/banks', undefined, subjectId);
        if (!active()) return;
        const entry = current(subjectId);
        const selected = new Set(entry?.banks.map(bank => bank.id));
        const banks = node('fieldset', 'freeStudyOptions');
        banks.append(node('legend', '', t('training.banks')));
        const inputs = new Map();
        for (const bank of data.banks) {
          const {row, input} = checkbox(bank.title, selected.has(bank.id));
          banks.append(row); inputs.set(bank.id, input);
        }
        if (!inputs.size) banks.append(node('p', 'inputHint', t('freeStudy.noBanks')));
        const reviews = checkbox(t('freeStudy.showReviews'), Boolean(entry?.show_reviews));
        const actions = node('div', 'dialogActions');
        const status = node('p', 'fieldError');
        status.setAttribute('role', 'alert');
        const save = control(t(entry ? 'freeStudy.save' : 'freeStudy.add'), 'primaryButton', () => submit(true));
        const remove = control(t('freeStudy.remove'), 'textButton', () => submit(false));
        if (entry) actions.append(remove);
        actions.append(save);
        editor.replaceChildren(node('p', 'inputHint', t('freeStudy.courseFollows')), banks, reviews.row, status, actions);

        async function submit(enabled) {
          if (save.disabled) return;
          const bankIds = [...inputs].filter(([, input]) => input.checked).map(([id]) => id);
          chooser.disabled = close.disabled = banks.disabled = reviews.input.disabled = save.disabled = remove.disabled = true;
          status.textContent = '';
          let saved = false;
          try {
            const result = await request('free-study', {method: 'POST', body: {
              subject_id: subjectId, enabled, bank_ids: enabled ? bankIds : [], show_reviews: enabled && reviews.input.checked,
            }});
            if (!isCurrent()) return;
            selection = result.subjects;
            saved = true;
            if (active()) dialog.close();
            render();
          } catch (error) {
            if (active()) status.textContent = translateMessage(error.message);
          } finally {
            chooser.disabled = close.disabled = banks.disabled = reviews.input.disabled = save.disabled = remove.disabled = false;
            if (saved) market.focus();
          }
        }
      } catch (error) {
        if (active()) editor.replaceChildren(node('p', 'fieldError', translateMessage(error.message)),
          control(t('freeStudy.retry'), 'secondaryButton', () => void loadEditor()));
      }
    }

    function edit(subjectId = subjects.find(subject => !current(subject.id))?.id || subjects[0]?.id) {
      if (!subjectId || chooser.disabled) return;
      chooser.value = subjectId;
      dialog.showModal();
      void loadEditor();
    }

    chooser.addEventListener('change', () => void loadEditor());
    dialog.addEventListener('cancel', event => { if (close.disabled) event.preventDefault(); });
    market.disabled = !subjects.length;
    root.replaceChildren(header, layout, dialog);
    if (canClip) {
      const clips = node('section', 'clipperLibrary');
      header.after(clips);
      try {
        const {mountClipperLibrary} = await import('./clipper-library.js?v=2469085234b24522');
        if (isCurrent() && clips.isConnected) mountClipperLibrary({root: clips, request, node, control, link, isCurrent});
      } catch (error) {
        if (isCurrent() && clips.isConnected) clips.append(node('p', 'fieldError', error.message));
      }
      if (!isCurrent()) return;
    }
    render();
  }

  return {open, stop: () => { dispose(); dispose = () => {}; }};
}
