import {parsePlatformRoute} from './subjects.js?v=e4f0b61b1957cdae';

const siteRoot = new URL('./', import.meta.url);
const freeStudy = {id: 'free-study', directory: 'pwa-free-study/', home: '#/free-study', installLabel: 'pwa.installFreeStudy'};
const mathCourses = {id: 'math-courses', directory: 'pwa-math-courses/', home: '#/subjects/math/courses', installLabel: 'pwa.installMathCourses'};
const site = {id: 'site', directory: '', home: '#/', installLabel: 'pwa.install'};
const apps = [freeStudy, mathCourses];

export const currentPwa = apps.find(app => app.id === document.documentElement.dataset.pwaApp) || site;
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const coursePage = path => /^\/courses(?:\/[^/]+(?:\/progress)?)?$/.test(path);
const topicPage = path => /^\/topic\/[^/]+(?:\/content)?$/.test(path);
const reviewPage = path => /^\/review\/[^/]+\/[^/]+$/.test(path);

function sectionFor({subjectId, path, params}) {
  if (!subjectId && path === '/free-study') return freeStudy;
  if (subjectId === 'math' && (coursePage(path) ||
      (params.get('course') && (topicPage(path) || reviewPage(path))))) return mathCourses;
  return site;
}

export function installEntry(route) {
  const app = sectionFor(route);
  return {url: new URL(app.directory + (app === site ? 'download.html' : 'install.html'), siteRoot), label: app.installLabel};
}

export function routeInPwaScope(app, route) {
  return app === site || sectionFor(route) === app;
}

export function pwaLocationKey(app, apiOrigin, access) {
  const identity = [apiOrigin, access.role, access.learner_id];
  // Keep the published site's existing saved locations compatible.
  if (app !== site) identity.push(app.id);
  return 'graspmemoedu:pwa-learning-location:' + JSON.stringify(identity);
}

export function restorableHash(app, hash) {
  if (!hash?.startsWith('#/')) return false;
  const route = parsePlatformRoute(hash);
  const {subjectId, path, params} = route;
  if (!routeInPwaScope(app, route)) return false;
  if (!subjectId) return /^\/(?:free-study|settings|progress|help|qa(?:\/[^/]+)?|admin\/(?:pauses|students))?$/.test(path);
  // A review without an existing session can start new work on open.
  if (reviewPage(path)) return !path.endsWith('/atomic') && Boolean(params.get('session'));
  if (/^\/banks(?:\/[^/]+){0,2}$/.test(path)) return params.get('review') !== '1' && params.get('card') !== '1';
  return coursePage(path) || topicPage(path) || /^\/(?:reading|guide|reviews)$/.test(path);
}

export function observeScopeDeparture(app, reset) {
  const scope = new URL(app.directory || './', siteRoot);
  const leavesScope = url => (url.protocol === 'https:' || url.protocol === 'http:') &&
    (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname));
  let departure = null;
  window.addEventListener('pagehide', () => {
    if (departure && !departure.aborted) reset();
    departure = null;
  });
  window.navigation?.addEventListener('navigate', event => {
    departure = !event.downloadRequest && leavesScope(new URL(event.destination.url)) ? event.signal : null;
  });
  window.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') ||
        event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    departure = leavesScope(new URL(link.href)) ? {aborted: false} : null;
  });
}
