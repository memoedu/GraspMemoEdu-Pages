import {getLanguage} from './i18n.js?v=ad5665f8f97afbd9';

export function calculatorButton(config) {
  if (!['basic', 'scientific', 'advanced', 'cas'].includes(config?.level)) return null;
  const english = getLanguage() === 'en';
  const launch = document.createElement('button');
  launch.type = 'button';
  launch.className = 'secondaryButton calculatorLaunch';
  launch.textContent = english ? 'Calculator' : '计算器';
  launch.setAttribute('aria-haspopup', 'dialog');
  launch.addEventListener('click', async () => {
    launch.disabled = true;
    try {
      const {openCalculator} = await import('./calculator-panel.js?v=ad5665f8f97afbd9');
      if (launch.isConnected) openCalculator(launch, config, english);
    } catch {
      launch.textContent = english ? 'Retry calculator' : '重试计算器';
    } finally {
      launch.disabled = false;
    }
  });
  return launch;
}
