import { Route, Routes } from 'react-router';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { NotFoundPage } from '@/components/NotFoundPage';

export function AppRoutes() {
  return (
    <Routes>
      {/* Public: SeatBook's home is the event list (Day 10), which guests can browse too. */}
      <Route path="/" element={<p className="p-8">Events come on Day 10 🎭</p>} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
