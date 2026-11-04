import type { ApplicationSummaryDto } from '@seatbook/shared';

export const toApplicationDto = (a: {
  _id: unknown;
  status: ApplicationSummaryDto['status'];
  organizationName: string;
  rejectionReason?: string | null;
  createdAt: Date;
}): ApplicationSummaryDto => ({
  id: String(a._id),
  status: a.status,
  organizationName: a.organizationName,
  rejectionReason: a.rejectionReason ?? null,
  createdAt: a.createdAt.toISOString(),
});
