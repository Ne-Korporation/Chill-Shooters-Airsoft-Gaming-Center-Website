import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { RequireAuth } from './routes/RequireAuth'
import { LandingPage } from './pages/auth/LandingPage'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { OtpVerificationPage } from './pages/auth/OtpVerificationPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'

import { DashboardHomePage } from './pages/dashboard/DashboardHomePage'
import { ReservationCalendarPage_FIXED as ReservationCalendarPage } from './pages/reservations/ReservationCalendarPage_FIXED'

import { PackageRecommendationPage } from './pages/packages/PackageRecommendationPage'
import { WaiverPage } from './pages/waiver/WaiverPage'
import { PaymentPage } from './pages/payments/PaymentPage'
import { PlayerProfilePage } from './pages/players/PlayerProfilePage'

import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminReservationsPage } from './pages/admin/AdminReservationsPage'
import { AdminPlayersPage } from './pages/admin/AdminPlayersPage'
import { AdminEquipmentPage } from './pages/admin/AdminEquipmentPage'
import { AdminWeaponsPage } from './pages/admin/AdminWeaponsPage'
import { AdminRentalPackagesPage } from './pages/admin/AdminRentalPackagesPage'
import { AdminPaymentsPage } from './pages/admin/AdminPaymentsPage'
import { AdminReportsPage } from './pages/admin/AdminReportsPage'
import { AdminNotificationsPage } from './pages/admin/AdminNotificationsPage'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'

import { ReservationManagementPage } from './pages/admin/ReservationManagementPage'
import { PlayerManagementPage } from './pages/admin/PlayerManagementPage'

import { RegistrarDashboardHomePage } from './pages/registrar/RegistrarDashboardHomePage'
import { RegistrarReservationsPage } from './pages/registrar/RegistrarReservationsPage'
import { RegistrarOngoingGamesPage } from './pages/registrar/RegistrarOngoingGamesPage'
import { RegistrarAvailedPackagesPage } from './pages/registrar/RegistrarAvailedPackagesPage'
import { RegistrarSubmittedWaiversPage } from './pages/registrar/RegistrarSubmittedWaiversPage'
import { RegistrarSubmittedPaymentsPage } from './pages/registrar/RegistrarSubmittedPaymentsPage'

import { RequireRole } from './routes/RequireRole'

function RegistrarReservationsPageWrapper() {
  return (
    <RequireRole roles={['registrar', 'admin']}>
      <RegistrarReservationsPage />
    </RequireRole>
  )
}


function RegistrarOngoingGamesPageWrapper() {
  return (
    <RequireRole roles={['registrar']}>
      <RegistrarOngoingGamesPage />
    </RequireRole>
  )
}

function RegistrarAvailedPackagesPageWrapper() {
  return (
    <RequireRole roles={['registrar']}>
      <RegistrarAvailedPackagesPage />
    </RequireRole>
  )
}

function RegistrarSubmittedWaiversPageWrapper() {
  return (
    <RequireRole roles={['registrar']}>
      <RegistrarSubmittedWaiversPage />
    </RequireRole>
  )
}

function RegistrarSubmittedPaymentsPageWrapper() {
  return (
    <RequireRole roles={['registrar']}>
      <RegistrarSubmittedPaymentsPage />
    </RequireRole>
  )
}

export default function App() {

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/otp" element={<OtpVerificationPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardHomePage />} />
        <Route path="reservations" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<ReservationCalendarPage />}</RequireRole>} />
        <Route path="packages" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<PackageRecommendationPage />}</RequireRole>} />
        <Route path="waiver" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<WaiverPage />}</RequireRole>} />
        <Route path="payment" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<PaymentPage />}</RequireRole>} />
        <Route path="players/:playerId" element={<PlayerProfilePage />} />
        <Route
          path="games"
          element={
            <RequireRole roles={['marshal', 'admin']}>
              <RegistrarOngoingGamesPage />
            </RequireRole>
          }
        />




        <Route path="admin" element={<AdminDashboardPage />} />
        <Route path="admin/reservations" element={<AdminReservationsPage />} />
        <Route path="admin/reservation-management" element={<ReservationManagementPage />} />
        <Route path="admin/players" element={<AdminPlayersPage />} />
        <Route path="admin/player-management" element={<PlayerManagementPage />} />
        <Route path="admin/equipment" element={<AdminEquipmentPage />} />
        <Route path="admin/weapons" element={<AdminWeaponsPage />} />
        <Route path="admin/rental-packages" element={<AdminRentalPackagesPage />} />
        <Route path="admin/payments" element={<AdminPaymentsPage />} />
        <Route path="admin/reports" element={<AdminReportsPage />} />
        <Route path="admin/notifications" element={<AdminNotificationsPage />} />
        <Route path="admin/audit-logs" element={<AdminAuditLogsPage />} />

        <Route index element={<RegistrarDashboardHomePage />} />
        <Route path="registrar/reservations" element={<RegistrarReservationsPageWrapper />} />
        <Route path="registrar/games" element={<RegistrarOngoingGamesPageWrapper />} />
        <Route path="registrar/availed-packages" element={<RegistrarAvailedPackagesPageWrapper />} />
        <Route path="registrar/waivers" element={<RegistrarSubmittedWaiversPageWrapper />} />
        <Route path="registrar/submitted-payments" element={<RegistrarSubmittedPaymentsPageWrapper />} />

      </Route>




      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

