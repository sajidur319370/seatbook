import { lazy } from 'react';
import { Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { NotFoundPage } from '@/components/NotFoundPage';
import { BecomeOrganizerPage } from '@/features/applications/BecomeOrganizerPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequirePermission } from '@/features/auth/permissions';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';

// Lazy, so attendees never download the organizer and admin areas (NFR-PERF-08).
const MyEventsPage = lazy(() =>
  import('@/features/organizer/MyEventsPage').then((m) => ({ default: m.MyEventsPage })),
);
const NewEventPage = lazy(() =>
  import('@/features/organizer/NewEventPage').then((m) => ({ default: m.NewEventPage })),
);
const EventEditorPage = lazy(() =>
  import('@/features/organizer/EventEditorPage').then((m) => ({ default: m.EventEditorPage })),
);
const AdminOverviewPage = lazy(() =>
  import('@/features/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const ApplicationsPage = lazy(() =>
  import('@/features/admin/ApplicationsPage').then((m) => ({ default: m.ApplicationsPage })),
);
const UsersPage = lazy(() =>
  import('@/features/admin/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const AdminEventsPage = lazy(() =>
  import('@/features/admin/AdminEventsPage').then((m) => ({ default: m.AdminEventsPage })),
);

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      <Route element={<AppShell />}>
        {/* Public: SeatBook's home is the event list (Day 10), which guests can browse too. */}
        <Route path="/" element={<p>Events come on Day 10 🎭</p>} />

        <Route element={<RequireAuth />}>
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/become-organizer" element={<BecomeOrganizerPage />} />

          <Route element={<RequirePermission perm="event:manage" />}>
            <Route path="/organizer" element={<MyEventsPage />} />
            <Route path="/organizer/events/new" element={<NewEventPage />} />
            <Route path="/organizer/events/:eventId" element={<EventEditorPage />} />
          </Route>

          <Route element={<RequirePermission perm="admin:overview" />}>
            <Route path="/admin" element={<AdminOverviewPage />} />
            <Route path="/admin/applications" element={<ApplicationsPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/admin/events" element={<AdminEventsPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
