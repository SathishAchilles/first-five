import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppLayout, MarketingLayout } from "./components/layouts";
import { RequireAccess, RequireAuth } from "./lib/auth";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
import { AdminLayout, CodesCard, IntegrationsCard, OverviewCard, PaymentsCard } from "./pages/app/Admin";
import { AdminClientDetailPage } from "./pages/app/admin/ClientDetail";
import { AdminClientsPage } from "./pages/app/admin/Clients";
import { AdminReportPage, AdminSessionPage } from "./pages/app/admin/ClientViews";
import { NewTestPage } from "./pages/app/NewTest";
import { NewWebsitePage } from "./pages/app/NewWebsite";
import { ReportDetailPage } from "./pages/app/ReportDetail";
import { ReportsPage } from "./pages/app/Reports";
import { SessionDetailPage } from "./pages/app/SessionDetail";
import { SettingsPage } from "./pages/app/Settings";
import { EditTestPage } from "./pages/app/EditTest";
import { TestFindingsPage } from "./pages/app/TestFindings";
import { TestLayout } from "./pages/app/TestLayout";
import { TestOverviewPage } from "./pages/app/TestOverview";
import { TestParticipantsPage } from "./pages/app/TestParticipants";
import { TestReadyPage } from "./pages/app/TestReady";
import { TestsPage } from "./pages/app/Tests";
import { WebsiteDetailPage } from "./pages/app/WebsiteDetail";
import { WebsitesPage } from "./pages/app/Websites";
import { FeedbackPage } from "./pages/participant/Feedback";
import { StudyWelcomePage } from "./pages/participant/StudyWelcome";
import { LandingPage } from "./pages/public/Landing";
import { LoginPage, SetPasswordPage, SignupPage } from "./pages/public/Auth";
import { AccessPage, CheckoutPage, PaymentStatusPage, PrivacyPage, RedeemPage, TermsPage, WaitlistPage, WaitlistSuccessPage } from "./pages/public/Funnel";
import { NotFoundPage } from "./pages/public/NotFound";
import { PublishedReportPage } from "./pages/public/PublishedReport";
import { SampleReportPage } from "./pages/public/SampleReport";

/** New pages start at the top; in-page anchors (/#pricing) are handled by the landing page. */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    // Default title; pages with their own title set it in their effects, which run after this one.
    document.title = pathname.startsWith("/app") ? "First Five" : "First Five — Test Your Website With Real Users";
    if (!hash) window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname, hash]);
  return null;
}

export function App() {
  return (
    <>
    <ScrollToTop />
    <ImpersonationBanner />
    <Routes>
      <Route element={<MarketingLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/sample-report" element={<SampleReportPage />} />
      </Route>
      <Route path="/waitlist" element={<WaitlistPage />} />
      <Route path="/waitlist/success" element={<WaitlistSuccessPage />} />
      <Route path="/access" element={<AccessPage />} />
      <Route path="/redeem" element={<RedeemPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/payment/status" element={<PaymentStatusPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/t/:studyId" element={<StudyWelcomePage />} />
      <Route path="/t/:studyId/feedback" element={<FeedbackPage />} />
      <Route path="/r/:token" element={<PublishedReportPage />} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <RequireAccess>
              <AppLayout />
            </RequireAccess>
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/app/websites" replace />} />
        <Route path="websites" element={<WebsitesPage />} />
        <Route path="websites/new" element={<NewWebsitePage />} />
        <Route path="websites/:id/*" element={<WebsiteDetailPage />} />
        <Route path="tests" element={<TestsPage />} />
        <Route path="tests/new" element={<NewTestPage />} />
        <Route path="tests/:id/edit" element={<EditTestPage />} />
        <Route path="tests/:id/ready" element={<TestReadyPage />} />
        <Route path="tests/:id" element={<TestLayout />}>
          <Route index element={<TestOverviewPage />} />
          <Route path="participants" element={<TestParticipantsPage />} />
          <Route path="participants/:sessionId" element={<SessionDetailPage />} />
          <Route path="findings" element={<TestFindingsPage />} />
        </Route>
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="admin"
          element={
            <RequireAuth superadmin>
              <AdminLayout />
            </RequireAuth>
          }
        >
          <Route index element={<OverviewCard />} />
          <Route path="clients" element={<AdminClientsPage />} />
          <Route path="clients/:clientId" element={<AdminClientDetailPage />} />
          <Route path="clients/:clientId/sessions/:sessionId" element={<AdminSessionPage />} />
          <Route path="clients/:clientId/reports/:reportId" element={<AdminReportPage />} />
          <Route path="payments" element={<PaymentsCard />} />
          <Route path="codes" element={<CodesCard />} />
          <Route path="integrations" element={<IntegrationsCard />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </>
  );
}
