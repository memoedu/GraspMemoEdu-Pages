import {t, getLanguage} from './i18n.js?v=d703cbf2a73e0061';

export const ideaSetupSection = 'idea-setup';
export const ideaSetupHash = `#/subjects/cs/guide?section=${ideaSetupSection}`;
const repository = 'https://github.com/memoedu/GraspMemoEdu-IDEA';
const sourceRepository = 'https://github.com/memoedu/GraspMemoEdu';
const site = 'https://memoedu.github.io/GraspMemoEdu-Pages/';
export const ideaFeedback = {
  suggestion: {title: 'academy.feedbackSuggestion', description: 'academy.feedbackSuggestionHint', prefix: '【IDEA 安装建议】\n'},
  problem: {title: 'academy.feedbackProblem', description: 'academy.feedbackProblemHint', prefix: '【IDEA 安装问题】\n'},
};
export const ideaFeedbackHash = kind => ideaSetupHash + '&idea-feedback=' + kind;
export const ideaFeedbackId = kind => 'idea-feedback-' + kind;

const prompt = {
  'zh-CN': [
    '请在我的电脑上完成 GraspMemoEdu 的 IntelliJ IDEA 安装和账号连通。请直接检查并操作本机，遇到问题就排查、修复并重试，直到网站收到 IDEA 成功打开题目的回执。',
    `GraspMemoEdu IDEA 插件的公开仓库是 ${repository}。先读取仓库的兼容说明和 Releases，核对下载文件的 SHA-256。检查本机系统、架构、现有 IDEA、插件和项目环境。若缺少兼容的 IntelliJ IDEA，从 JetBrains 官方渠道安装与插件匹配的版本。复用可用的安装，并补齐兼容的 JetBrains Academy 插件和当前题目实际需要的 JDK、Python 或其他运行环境。使用当前电脑的实际路径和设置，保留我的项目、代码和 IDE 配置。`,
    '使用仓库指向的安装和配置入口，配置 IDEA 的题目打开协议及 GraspMemoEdu Academy Bridge。使用我已登录的 GraspMemoEdu 账号和有权访问的课程项目，为原题匹配本机课程及清单版本。需要本机测试包或其他课程依赖时，从该课程授权渠道取得并校验。不要编造课程清单、借用其他账号的配置，或把邀请码、Cookie、连接票据、答案和代码复制到聊天、日志或外部服务。',
    '如果我从题目跳转到这份指南，用浏览器返回上一页回到原题，再选择“在 IDEA 中打开”。核对 IDEA 打开的题目和代码文件，并确认原网页显示 IDEA 已连接或已收到检查结果。验证时不要代我提交答案。需要我完成账号登录、系统授权或关闭正在使用的 IDEA 时，只请我处理对应确认，然后继续。遇到缺失的授权课程材料时，告诉我缺的具体项目或包，拿到后继续到验证通过。',
    '遇到困难，请先根据本机证据排查、修复并重试。全部完成后，把有复用价值的发现写成「输入建议」，说明原来的卡点、验证有效的解决办法，以及建议如何修改安装流程或提示词。确实无法继续时，写成「问题反馈」，说明卡在哪一步、相关版本、如何复现、实际现象、已试办法和需要哪种协助。没有可复用的发现时可以省略建议。',
    `优先用当前已授权的 GitHub CLI 或 API 提交反馈。插件安装、兼容性和安装文档反馈先查 ${repository}/issues。网站提示词、引导或网站代码反馈查 ${sourceRepository}/issues。先查同类 Issue 和 PR，已有记录就沿用，只补充新的证据。能给出已验证、可独立审阅的改动时，用 gh pr create 向维护相应文件的仓库提交 PR，否则用 gh issue create 提交 Issue。仅提交脱敏且适合公开的信息，排除凭据、连接票据、个人路径、私有课程材料和完整日志。若 GitHub 不可用或反馈不适合公开，且你能操作已登录的浏览器，请在计算机科学指南的 IDEA 安装区直接填写「输入建议」${site}${ideaFeedbackHash('suggestion')} 或「问题反馈」${site}${ideaFeedbackHash('problem')}，点击「发送反馈」并核对页面上的发送结果。发完告诉我链接或站内发送结果。两条渠道都不可用时，把可复制的反馈草稿留给我。`,
  ],
  en: [
    'Set up IntelliJ IDEA on my computer and connect it to my GraspMemoEdu account. Inspect and operate the computer directly. Diagnose and retry any failed step until the site confirms that IDEA opened the exercise.',
    `The public GraspMemoEdu IDEA plugin repository is ${repository}. Read its compatibility notes and Releases, and verify the SHA-256 of the download. Inspect my OS, architecture, installed IDE, plugins and project environment. If needed, install a compatible IntelliJ IDEA from JetBrains. Reuse working installations and fill in missing dependencies, including the compatible JetBrains Academy plugin and any JDK, Python or other runtime required by the exercise. Use paths from this computer and preserve my projects, code and IDE settings.`,
    'Follow the repository references to install and configure the GraspMemoEdu Academy Bridge and its exercise link handler. Use my signed-in GraspMemoEdu account and course project that I am authorized to access. Match the local course and manifest version to the exercise. Obtain any required test bundle or other course dependency from its authorized source and verify it. Keep invitation codes, cookies, connection tickets, answers and code out of chat, logs and external services.',
    'If I arrived here from an exercise, go back in the browser and use “Open in IDEA” on the original exercise. Verify that IDEA opened the correct exercise and files and that the site confirms the connection or shows check results. Do not submit an answer for me. Ask only for the specific sign-in, system authorization or permission to close IDEA that needs my involvement, then continue. If authorized course materials are missing, identify the exact project or bundle and resume verification once it is available.',
    'Diagnose, fix and retry problems on this computer first. When setup succeeds, send an improvement suggestion if you found something reusable. Include the original friction, the verified fix, and what to change in the workflow or prompt. If you are still blocked after troubleshooting, report the failing step, relevant versions, reproduction steps, observed result, attempted fixes and what help is needed.',
    `Prefer the authorized GitHub CLI or API. Use ${repository}/issues for plugin setup, compatibility and installation docs, and ${sourceRepository}/issues for the website prompt, onboarding or site code. Search existing issues and PRs first. Reuse a match and add only new evidence. Use gh pr create in the repository that owns the changed files for a verified, reviewable change, or gh issue create to report a finding. Share only sanitized public details. Exclude credentials, tickets, personal paths, private course materials and full logs. If GitHub is unavailable or unsuitable for the feedback and you can use my signed-in browser, fill in the improvement suggestion form at ${site}${ideaFeedbackHash('suggestion')} or the problem report form at ${site}${ideaFeedbackHash('problem')} directly in the IDEA setup section of the Computer Science guide. Click “Send feedback” and verify the result on the same page. Return the link or confirmation. If neither channel is available, give me a copyable draft.`,
  ],
};

export function ideaSetupLink() {
  const link = document.createElement('a');
  link.className = 'textButton';
  link.href = ideaSetupHash;
  link.textContent = t('academy.setupTitle');
  return link;
}

export function renderIdeaSetupSection(canSendFeedback) {
  const section = document.createElement('section');
  section.className = 'guideBody courseContent';
  section.setAttribute('aria-labelledby', ideaSetupSection);
  const title = document.createElement('h2');
  title.id = ideaSetupSection;
  title.tabIndex = -1;
  title.textContent = t('academy.setupTitle');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'primaryButton';
  copy.textContent = t('academy.copyPrompt');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const body = document.createElement('div');
  const paragraphs = prompt[getLanguage()] || prompt['zh-CN'];
  body.append(...paragraphs.map(text => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    return paragraph;
  }));
  copy.addEventListener('click', async () => {
    status.textContent = '';
    try {
      await navigator.clipboard.writeText(paragraphs.join('\n\n'));
      status.textContent = t('academy.promptCopied');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(body);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent = t('academy.promptCopyFailed');
    }
  });
  const feedbackTitle = document.createElement('h3');
  feedbackTitle.textContent = t('academy.feedbackTitle');
  const feedbackHint = document.createElement('p');
  const github = document.createElement('a');
  github.href = repository + '/issues';
  github.textContent = 'GitHub Issues';
  feedbackHint.append(t('academy.feedbackPreferred'), ' ', github);
  section.append(title, copy, status, body, feedbackTitle, feedbackHint);
  for (const [kind, feedback] of Object.entries(ideaFeedback)) {
    const entry = document.createElement('h4');
    entry.id = ideaFeedbackId(kind);
    entry.tabIndex = -1;
    entry.textContent = t(feedback.title);
    const detail = document.createElement('p');
    detail.textContent = t(feedback.description);
    const panel = document.createElement('div');
    panel.setAttribute('aria-labelledby', entry.id);
    panel.append(entry, detail);
    if (canSendFeedback) {
      const composer = document.createElement('div');
      composer.id = entry.id + '-composer';
      panel.append(composer);
    }
    section.append(panel);
  }
  if (!canSendFeedback) {
    const accessHint = document.createElement('p');
    accessHint.className = 'inputHint';
    accessHint.textContent = t('academy.feedbackAccess');
    section.append(accessHint);
  }
  return section;
}
