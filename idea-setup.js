import {t, getLanguage} from './i18n.js?v=02d2c1bdd280d1e5';

export const ideaSetupHash = '#/idea-setup';
const repository = 'https://github.com/memoedu/GraspMemoEdu-IDEA';

const prompt = {
  'zh-CN': [
    '请在我的电脑上完成 GraspMemoEdu 的 IntelliJ IDEA 安装和账号连通。请直接检查并操作本机，遇到问题就排查、修复并重试，直到网站收到 IDEA 成功打开题目的回执。',
    `GraspMemoEdu IDEA 插件的公开仓库是 ${repository}。先读取仓库的兼容说明和 Releases，核对下载文件的 SHA-256。检查本机系统、架构、现有 IDEA、插件和项目环境。若缺少兼容的 IntelliJ IDEA，从 JetBrains 官方渠道安装与插件匹配的版本。复用可用的安装，并补齐兼容的 JetBrains Academy 插件和当前题目实际需要的 JDK、Python 或其他运行环境。使用当前电脑的实际路径和设置，保留我的项目、代码和 IDE 配置。`,
    '使用仓库指向的安装和配置入口，配置 IDEA 的题目打开协议及 GraspMemoEdu Academy Bridge。使用我已登录的 GraspMemoEdu 账号和有权访问的课程项目，为原题匹配本机课程及清单版本。需要本机测试包或其他课程依赖时，从该课程授权渠道取得并校验。不要编造课程清单、借用其他账号的配置，或把邀请码、Cookie、连接票据、答案和代码复制到聊天、日志或外部服务。',
    '如果我从题目跳转到这份指南，用浏览器返回上一页回到原题，再选择“在 IDEA 中打开”。核对 IDEA 打开的题目和代码文件，并确认原网页显示 IDEA 已连接或已收到检查结果。验证时不要代我提交答案。需要我完成账号登录、系统授权或关闭正在使用的 IDEA 时，只请我处理对应确认，然后继续。遇到缺失的授权课程材料时，告诉我缺的具体项目或包，拿到后继续到验证通过。',
  ],
  en: [
    'Set up IntelliJ IDEA on my computer and connect it to my GraspMemoEdu account. Inspect and operate the computer directly. Diagnose and retry any failed step until the site confirms that IDEA opened the exercise.',
    `The public GraspMemoEdu IDEA plugin repository is ${repository}. Read its compatibility notes and Releases, and verify the SHA-256 of the download. Inspect my OS, architecture, installed IDE, plugins and project environment. If needed, install a compatible IntelliJ IDEA from JetBrains. Reuse working installations and fill in missing dependencies, including the compatible JetBrains Academy plugin and any JDK, Python or other runtime required by the exercise. Use paths from this computer and preserve my projects, code and IDE settings.`,
    'Follow the repository references to install and configure the GraspMemoEdu Academy Bridge and its exercise link handler. Use my signed-in GraspMemoEdu account and course project that I am authorized to access. Match the local course and manifest version to the exercise. Obtain any required test bundle or other course dependency from its authorized source and verify it. Keep invitation codes, cookies, connection tickets, answers and code out of chat, logs and external services.',
    'If I arrived here from an exercise, go back in the browser and use “Open in IDEA” on the original exercise. Verify that IDEA opened the correct exercise and files and that the site confirms the connection or shows check results. Do not submit an answer for me. Ask only for the specific sign-in, system authorization or permission to close IDEA that needs my involvement, then continue. If authorized course materials are missing, identify the exact project or bundle and resume verification once it is available.',
  ],
};

export function ideaSetupLink() {
  const link = document.createElement('a');
  link.className = 'textButton';
  link.href = ideaSetupHash;
  link.textContent = t('academy.setupTitle');
  return link;
}

export function renderIdeaSetup() {
  const page = document.createElement('article');
  page.className = 'guidePage';
  const title = document.createElement('h1');
  title.className = 'portalPageTitle';
  title.textContent = t('academy.setupTitle');
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'primaryButton';
  copy.textContent = t('academy.copyPrompt');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const body = document.createElement('div');
  body.className = 'guideBody courseContent';
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
  page.append(title, copy, status, body);
  return page;
}
