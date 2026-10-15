import { t } from './ui-text';

// Translate display text only. Callers keep the original provider value in storage and requests.
export function reasoningEffortLabel(value: string): string {
 switch (value) {
  case 'none': return t('不思考');
  case 'minimal': return t('最低');
  case 'low': return t('低');
  case 'medium': return t('中等');
  case 'high': return t('高');
  case 'xhigh': return t('很高');
  case 'max': return t('最大');
  case 'ultra': return t('极深');
  default: return value;
 }
}

export function reasoningEffortOption(value: string): HTMLOptionElement {
 return new Option(reasoningEffortLabel(value), value);
}
