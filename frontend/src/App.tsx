import { Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { PublicOnly, RequireAuth } from './auth/RouteGuards'
import { HomePage } from './pages/HomePage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { WelcomePage } from './pages/auth/WelcomePage'
import { SignInPage } from './pages/auth/SignInPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { AuthCallbackPage } from './pages/auth/AuthCallbackPage'
import { StatementsPage } from './pages/StatementsPage'
import { UploadStatementPage } from './pages/statements/UploadStatementPage'
import { StatementDetailPage } from './pages/statements/StatementDetailPage'
import { SpendingPage } from './pages/SpendingPage'
import { TransactionDetailPage } from './pages/TransactionDetailPage'
import { BudgetPage } from './pages/BudgetPage'
import { InsightsPage } from './pages/InsightsPage'
import { ProfilePage } from './pages/ProfilePage'
import { BudgetPlanPage } from './pages/BudgetPlanPage'
import { SetupPage } from './pages/SetupPage'
import { ExplainPage } from './pages/ExplainPage'
import { PrivacyPage } from './pages/legal/PrivacyPage'
import { DataRetentionPage } from './pages/legal/DataRetentionPage'
import { CookiesPage } from './pages/legal/CookiesPage'
import { ProfileProvider, SetupGate } from './auth/ProfileProvider'

export default function App() {
  return (
    <Routes>
      {/* Signed-out screens */}
      <Route path="welcome" element={<PublicOnly><WelcomePage /></PublicOnly>} />
      <Route path="sign-in" element={<PublicOnly><SignInPage /></PublicOnly>} />
      <Route path="register" element={<PublicOnly><RegisterPage /></PublicOnly>} />

      {/* Email-link flows work whether or not someone is signed in */}
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="auth/callback" element={<AuthCallbackPage />} />

      {/* Policies: open to everyone, signed in or not */}
      <Route path="privacy" element={<PrivacyPage />} />
      <Route path="data-retention" element={<DataRetentionPage />} />
      <Route path="cookies" element={<CookiesPage />} />

      {/* Signed-in: profile loads once; new users go through setup first */}
      <Route element={<RequireAuth><ProfileProvider /></RequireAuth>}>
        <Route path="setup" element={<SetupPage />} />
        <Route element={<SetupGate><AppLayout /></SetupGate>}>
          <Route index element={<HomePage />} />
          <Route path="statements" element={<StatementsPage />} />
          <Route path="statements/upload" element={<UploadStatementPage />} />
          <Route path="statements/:id" element={<StatementDetailPage />} />
          <Route path="spending" element={<SpendingPage />} />
          <Route path="spending/:id" element={<TransactionDetailPage />} />
          <Route path="budget" element={<BudgetPage />} />
          <Route path="budget/plan" element={<BudgetPlanPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="insights/explain" element={<ExplainPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<ComingSoonPage title="Page not found" description="That page does not exist." />} />
        </Route>
      </Route>
    </Routes>
  )
}
