import type { CategoryRiskLevelDto } from '@leen-mart/contracts';
import type { StatusBadgeProps } from '@leen-mart/ui';

export const CATEGORY_RISK_TONE: Record<CategoryRiskLevelDto, StatusBadgeProps['tone']> = {
  LOW: 'success',
  MEDIUM: 'warning',
  RESTRICTED: 'danger',
};
