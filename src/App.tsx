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
import { ReservationCalendarPage } from './pages/reservations/ReservationCalendarPage'
import { MyReservationsPage } from './pages/reservations/MyReservationsPage'

import { PackageRecommendationPage } from './pages/packages/PackageRecommendationPage'
import { WaiverPage } from './pages/waiver/WaiverPage'
import { PaymentPage } from './pages/payments/PaymentPage'
import { SplitPaymentPage } from './pages/payments/SplitPaymentPage'
import { PlayerProfilePage } from './pages/players/PlayerProfilePage'
import { MyWeaponsAndEquipmentPage } from './pages/players/MyWeaponsAndEquipmentPage'

import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminReservationsPage } from './pages/admin/AdminReservationsPage'
import { AdminGameplayPage } from './pages/admin/AdminGameplayPage'
import { AdminEquipmentPage } from './pages/admin/AdminEquipmentPage'
import { AdminWeaponsPage } from './pages/admin/AdminWeaponsPage'
import { AdminWaiversPage } from './pages/admin/AdminWaiversPage'
import { AdminRentalPackagesPage } from './pages/admin/AdminRentalPackagesPage'
import { AdminPaymentsPage } from './pages/admin/AdminPaymentsPage'
import { AdminReportsPage } from './pages/admin/AdminReportsPage'
import { AdminNotificationsPage } from './pages/admin/AdminNotificationsPage'
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage'
import { AdminPartnershipsPage } from './pages/admin/AdminPartnershipsPage'
import { AdminFeedbackPage } from './pages/admin/AdminFeedbackPage'
import { AdminReachFundPage } from './pages/admin/AdminReachFundPage'
import { SafetyLogPage } from './pages/marshal/SafetyLogPage'
import { TeamGroupingPage } from './pages/operations/TeamGroupingPage'
import { FieldCheckInPage } from './pages/operations/FieldCheckInPage'
import { GuardianApprovalPage } from './pages/guardian/GuardianApprovalPage'
import { CounterPage } from './pages/operations/CounterPage'
import { RentalsPage } from './pages/operations/RentalsPage'
import { RepairsPage } from './pages/operations/RepairsPage'

import { PlayerManagementPage } from './pages/admin/PlayerManagementPage'

import { RegistrarDashboardHomePage } from './pages/registrar/RegistrarDashboardHomePage'
import { RegistrarReservationsPage } from './pages/registrar/RegistrarReservationsPage'
import { RegistrarOngoingGamesPage, RegistrarArchivedGamesPage } from './pages/registrar'
import { RegistrarAvailedPackagesPage } from './pages/registrar/RegistrarAvailedPackagesPage'
import { RegistrarSubmittedWaiversPage } from './pages/registrar/RegistrarSubmittedWaiversPage'
import { RegistrarSubmittedPaymentsPage } from './pages/registrar/RegistrarSubmittedPaymentsPage'
import { MarshalDashboardHomePage } from './pages/marshal/MarshalDashboardHomePage'
import { PlayerFeedbackPage } from './pages/players/PlayerFeedbackPage'

import { RequireRole } from './routes/RequireRole'
import { NotificationProvider } from './context/NotificationContext'
import { useAuth } from './context/AuthContext'

function AppHomePage() {
  const { user } = useAuth()
  if (user?.role === 'admin') {
    return <AdminDashboardPage />
  }
  if (user?.role === 'registrar') {
    return <RegistrarDashboardHomePage />
  }
  if (user?.role === 'marshal') {
    return <MarshalDashboardHomePage />
  }
  return <DashboardHomePage />
}

function RegistrarReservationsPageWrapper() {
  return (
    <RequireRole roles={['registrar', 'admin']}>
      <RegistrarReservationsPage />
    </RequireRole>
  )
}

function AdminDashboardPageWrapper() {
  return (
    <RequireRole roles={['admin']}>
      <AdminDashboardPage />
    </RequireRole>
  )
}

function AdminPageWrapper({ children }: { children: React.ReactElement }) {
  return <RequireRole roles={['admin']}>{children}</RequireRole>
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
    <NotificationProvider>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/otp" element={<OtpVerificationPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/guardian-approval/:token" element={<GuardianApprovalPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AppHomePage />} />
        <Route path="reservations" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<ReservationCalendarPage />}</RequireRole>} />
        <Route path="my-reservations" element={<RequireRole roles={['user']}><MyReservationsPage /></RequireRole>} />
        <Route path="packages" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<PackageRecommendationPage />}</RequireRole>} />
        <Route path="waiver" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<WaiverPage />}</RequireRole>} />
        <Route path="payment" element={<RequireRole roles={['user', 'admin', 'registrar']}>{<PaymentPage />}</RequireRole>} />
        <Route path="split-payments" element={<RequireRole roles={['user']}><SplitPaymentPage /></RequireRole>} />
        <Route path="feedback" element={<RequireRole roles={['user']}><PlayerFeedbackPage /></RequireRole>} />
        <Route path="notifications" element={<RequireRole roles={['user', 'admin', 'registrar', 'marshal']}>{<AdminNotificationsPage />}</RequireRole>} />
        <Route path="players/:playerId" element={<PlayerProfilePage />} />
        <Route path="players/:playerId/weapons-and-equipment" element={<MyWeaponsAndEquipmentPage />} />
        <Route
          path="games"
          element={
            <RequireRole roles={['marshal', 'admin']}>
              <RegistrarOngoingGamesPage />
            </RequireRole>
          }
        />
        <Route
          path="games/ongoing"
          element={
            <RequireRole roles={['marshal', 'admin']}>
              <RegistrarOngoingGamesPage />
            </RequireRole>
          }
        />
        <Route
          path="games/archived"
          element={
            <RequireRole roles={['marshal', 'admin']}>
              <RegistrarArchivedGamesPage />
            </RequireRole>
          }
        />




        <Route path="admin" element={<AdminDashboardPageWrapper />} />
        <Route path="admin/reservations" element={<AdminPageWrapper><AdminReservationsPage /></AdminPageWrapper>} />
        <Route path="admin/gameplay" element={<AdminPageWrapper><AdminGameplayPage /></AdminPageWrapper>} />
        {/* Old addresses kept as redirects so bookmarks and notification links still work. */}
        <Route path="admin/reservation-management" element={<Navigate to="/app/admin/reservations" replace />} />
        <Route path="admin/players" element={<Navigate to="/app/admin/player-management" replace />} />
        <Route path="admin/player-management" element={<AdminPageWrapper><PlayerManagementPage /></AdminPageWrapper>} />
        <Route
          path="admin/equipment"
          element={
            <RequireRole roles={['admin', 'marshal']}>
              <AdminEquipmentPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/weapons"
          element={
            <RequireRole roles={['admin', 'marshal']}>
              <AdminWeaponsPage />
            </RequireRole>
          }
        />
        <Route
          path="admin/waivers"
          element={
            <RequireRole roles={['admin']}>
              <AdminWaiversPage />
            </RequireRole>
          }
        />
        <Route path="admin/rental-packages" element={<AdminPageWrapper><AdminRentalPackagesPage /></AdminPageWrapper>} />
        <Route path="admin/payments" element={<AdminPageWrapper><AdminPaymentsPage /></AdminPageWrapper>} />
        <Route path="admin/partnerships" element={<AdminPageWrapper><AdminPartnershipsPage /></AdminPageWrapper>} />
        <Route path="admin/feedback" element={<AdminPageWrapper><AdminFeedbackPage /></AdminPageWrapper>} />
        <Route path="admin/reach-fund" element={<AdminPageWrapper><AdminReachFundPage /></AdminPageWrapper>} />
        <Route path="safety" element={<RequireRole roles={['marshal', 'admin']}><SafetyLogPage /></RequireRole>} />
        <Route path="team-grouping" element={<RequireRole roles={['marshal', 'admin']}><TeamGroupingPage /></RequireRole>} />
        <Route path="check-in" element={<RequireRole roles={['registrar', 'marshal', 'admin']}><FieldCheckInPage /></RequireRole>} />
        <Route path="counter" element={<RequireRole roles={['registrar', 'admin']}><CounterPage /></RequireRole>} />
        <Route path="rentals" element={<RequireRole roles={['marshal', 'registrar', 'admin']}><RentalsPage /></RequireRole>} />
        <Route path="repairs" element={<RequireRole roles={['marshal', 'admin']}><RepairsPage /></RequireRole>} />
        <Route path="admin/reports" element={<AdminPageWrapper><AdminReportsPage /></AdminPageWrapper>} />
        <Route path="admin/notifications" element={<AdminPageWrapper><AdminNotificationsPage /></AdminPageWrapper>} />
        <Route path="admin/audit-logs" element={<AdminPageWrapper><AdminAuditLogsPage /></AdminPageWrapper>} />

        <Route path="registrar" element={<RegistrarDashboardHomePage />} />
        <Route path="registrar/reservations" element={<RegistrarReservationsPageWrapper />} />
        <Route path="registrar/games" element={<RegistrarOngoingGamesPageWrapper />} />
        <Route path="registrar/availed-packages" element={<RegistrarAvailedPackagesPageWrapper />} />
        <Route path="registrar/waivers" element={<RegistrarSubmittedWaiversPageWrapper />} />
        <Route path="registrar/submitted-payments" element={<RegistrarSubmittedPaymentsPageWrapper />} />

      </Route>




      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </NotificationProvider>
  )
}
