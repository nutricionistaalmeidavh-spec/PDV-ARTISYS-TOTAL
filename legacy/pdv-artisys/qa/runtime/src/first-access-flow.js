function selectorOf(step) {
  return typeof step?.selector === 'string' ? step.selector : '';
}

function isLegacyQuickDemoFlow(steps) {
  return steps.some(step => (
    step?.action === 'click'
    && step?.text === 'Criar administrador'
  )) && steps.some(step => (
    step?.action === 'fill'
    && selectorOf(step) === "#auth-overlay input[type='password']"
  ));
}

export function normalizeFirstAccessFlowSteps(steps) {
  if (!Array.isArray(steps)) return steps;

  const hasLegacySetupForm = steps.some(step => selectorOf(step).includes('#setup-form'));
  const hasLegacyQuickDemo = isLegacyQuickDemoFlow(steps);
  if (!hasLegacySetupForm && !hasLegacyQuickDemo) return steps;

  const normalized = [];
  let skipLegacyLogin = false;

  for (const step of steps) {
    const selector = selectorOf(step);

    if (skipLegacyLogin && selector === '#auth-overlay' && step.state === 'hidden') {
      normalized.push(structuredClone(step));
      skipLegacyLogin = false;
      continue;
    }
    if (skipLegacyLogin && (hasLegacyQuickDemo || selector.includes('#login-form'))) continue;

    if (
      hasLegacyQuickDemo
      && step.action === 'fill'
      && selector === "#auth-overlay input[type='password']"
    ) {
      const upgraded = {
        ...structuredClone(step),
        selector: "#first-access-form input[name='password']",
      };
      normalized.push(upgraded);
      normalized.push({
        ...structuredClone(upgraded),
        selector: "#first-access-form input[name='passwordConfirm']",
        name: `${step.name || 'setup-admin-password'}-confirm`,
      });
      continue;
    }

    if (hasLegacyQuickDemo && step.action === 'click' && step.text === 'Criar administrador') {
      const upgraded = structuredClone(step);
      delete upgraded.text;
      delete upgraded.exact;
      upgraded.selector = "#first-access-form button[type='submit']";
      normalized.push(upgraded);
      skipLegacyLogin = true;
      continue;
    }

    if (!selector.includes('#setup-form')) {
      normalized.push(structuredClone(step));
      continue;
    }

    const upgraded = {
      ...structuredClone(step),
      selector: selector.replaceAll('#setup-form', '#first-access-form'),
    };
    normalized.push(upgraded);

    if (step.action === 'fill' && /input\[name=['"]password['"]\]/.test(selector)) {
      normalized.push({
        ...structuredClone(upgraded),
        selector: "#first-access-form input[name='passwordConfirm']",
        name: `${step.name || 'setup-admin-password'}-confirm`,
      });
    }

    if (step.action === 'click' && /button\[type=['"]submit['"]\]/.test(selector)) skipLegacyLogin = true;
  }

  return normalized;
}
