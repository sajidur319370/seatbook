import { lazy } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { NotFoundPage } from '@/components/NotFoundPage';
import { RouteError } from '@/components/RouteError';
import { EventsPage } from '@/features/events/EventsPage';
import { BecomeOrganizerPage } from '@/features/applications/BecomeOrganizerPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequirePermission } from '@/features/auth/permissions';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';

// Lazy, so the home page doesn't carry the map and Markdown code.
const EventPage = lazy(() =>
  import('@/features/events/EventPage').then((m) => ({ default: m.EventPage })),
);
const SeatSelectionPage = lazy(() =>
  import('@/features/seats/SeatSelectionPage').then((m) => ({ default: m.SeatSelectionPage })),
);
const CheckoutPage = lazy(() =>
  import('@/features/checkout/CheckoutPage').then((m) => ({ default: m.CheckoutPage })),
);
const BookingPage = lazy(() =>
  import('@/features/bookings/BookingPage').then((m) => ({ default: m.BookingPage })),
);
const MyTicketsPage = lazy(() =>
  import('@/features/bookings/MyTicketsPage').then((m) => ({ default: m.MyTicketsPage })),
);
const TicketPage = lazy(() =>
  import('@/features/bookings/TicketPage').then((m) => ({ default: m.TicketPage })),
);

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
const CheckInPage = lazy(() =>
  import('@/features/checkin/CheckInPage').then((m) => ({ default: m.CheckInPage })),
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

// A data router, because the seat-map builder's leave warning (useBlocker) requires one.
export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route errorElement={<RouteError />}>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      <Route element={<AppShell />}>
        {/* Public: guests browse events, and only log in to choose seats. */}
        <Route path="/" element={<EventsPage />} />
        <Route path="/e/:slug" element={<EventPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/e/:slug/seats" element={<SeatSelectionPage />} />
          <Route path="/e/:slug/checkout" element={<CheckoutPage />} />
          <Route path="/bookings/:bookingId" element={<BookingPage />} />
          <Route path="/me/tickets" element={<MyTicketsPage />} />
          <Route path="/tickets/:ticketId" element={<TicketPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/become-organizer" element={<BecomeOrganizerPage />} />

          <Route element={<RequirePermission perm="event:manage" />}>
            <Route path="/organizer" element={<MyEventsPage />} />
            <Route path="/organizer/events/new" element={<NewEventPage />} />
            <Route path="/organizer/events/:eventId" element={<EventEditorPage />} />
            <Route path="/organizer/events/:eventId/check-in" element={<CheckInPage />} />
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
    </Route>,
  ),
);
