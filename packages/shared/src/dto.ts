import type { Role } from './constants';

export type Id = string;

export interface UserDto {
  id: Id;
  email: string;
  name: string;
  avatarColor: string;
  timezone: string;
  role: Role; // the UI adapts to it; the API never trusts it from the client
  organizationName: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}
export interface ApplicationSummaryDto {
  id: Id;
  status: 'pending' | 'approved' | 'rejected';
  organizationName: string;
  rejectionReason: string | null;
  createdAt: string;
}
export interface MeResponse {
  user: UserDto;
  application: ApplicationSummaryDto | null; // organizer application, filled in on Day 5
}
// More DTOs are added day by day.
