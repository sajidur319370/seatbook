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
// More DTOs are added day by day.
