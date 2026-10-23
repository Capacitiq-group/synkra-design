import { lazy, Suspense } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { PageLoader } from './PageLoader'
import { RouteErrorPage } from './RouteErrorPage'
import { AuthLayout } from './layouts/AuthLayout'
import { MarketingLayout } from './layouts/MarketingLayout'
import { RootLayout } from './layouts/RootLayout'

const PresenterViewPage = lazy(() => import('@/pages/PresenterViewPage'))

const HomeGate = lazy(() => import('@/pages/synkra/HomeGate'))
const VideoEditorPage = lazy(() => import('@/pages/synkra/VideoEditorPage'))
const AgentHomePage = lazy(() => import('@/pages/synkra/agent/AgentHomePage'))
const AgentProjectPage = lazy(() => import('@/pages/synkra/agent/AgentProjectPage'))
const AgentSkillsPage = lazy(() => import('@/pages/synkra/agent/AgentSkillsPage'))
const AgentDesignSystemsPage = lazy(() => import('@/pages/synkra/agent/AgentDesignSystemsPage'))
const LandingPage = lazy(() => import('@/pages/LandingPage'))
const TemplatesPage = lazy(() => import('@/pages/TemplatesPage'))
const FeaturesPage = lazy(() => import('@/pages/FeaturesPage'))
const FaqPage = lazy(() => import('@/pages/FaqPage'))
const ContactPage = lazy(() => import('@/pages/ContactPage'))
const TemplateDetailPage = lazy(() => import('@/pages/TemplateDetailPage'))
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'))
const SignupPage = lazy(() => import('@/pages/auth/SignupPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'))
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'))
const CreatePage = lazy(() => import('@/pages/CreatePage'))
const LocalEditorPage = lazy(() => import('@/pages/LocalEditorPage'))
const DesignEditorPage = lazy(() => import('@/pages/DesignEditorPage'))
const SharedDesignPage = lazy(() => import('@/pages/SharedDesignPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
const DashboardLayout = lazy(() => import('@/features/dashboard/DashboardLayout'))
const DashboardHomePage = lazy(() => import('@/pages/dashboard/HomePage'))
const DesignsPage = lazy(() => import('@/pages/dashboard/DesignsPage'))
const DashboardTemplatesPage = lazy(() => import('@/pages/dashboard/TemplatesPage'))
const BrandPage = lazy(() => import('@/pages/dashboard/BrandPage'))
const UploadsPage = lazy(() => import('@/pages/dashboard/UploadsPage'))
const TrashPage = lazy(() => import('@/pages/dashboard/TrashPage'))
const SettingsPage = lazy(() => import('@/pages/dashboard/SettingsPage'))

const page = (element: React.ReactNode) => <Suspense fallback={<PageLoader />}>{element}</Suspense>

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      // `/` is context-aware: the SYNKRA Design dashboard for signed-in users, the marketing
      // landing page for everyone else. Both live behind the HomeGate.
      { index: true, element: page(<HomeGate />) },
      {
        element: <MarketingLayout />,
        children: [
          { path: 'templates', element: <TemplatesPage /> },
          { path: 'templates/:slug', element: <TemplateDetailPage /> },
          { path: 'features', element: <FeaturesPage /> },
          { path: 'faq', element: <FaqPage /> },
          { path: 'contact', element: <ContactPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      // Future product areas — working routes with polished placeholders, no functionality yet.
      { path: 'video-editor', element: page(<VideoEditorPage />) },
      // SYNKRA Agent Studio (powered by OpenDesign) — the AI design agent workspace.
      { path: 'ai-studio', element: page(<AgentHomePage />) },
      { path: 'ai-studio/skills', element: page(<AgentSkillsPage />) },
      { path: 'ai-studio/design-systems', element: page(<AgentDesignSystemsPage />) },
      { path: 'ai-studio/projects/:id', element: page(<AgentProjectPage />) },
      {
        element: <AuthLayout />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'signup', element: <SignupPage /> },
          { path: 'forgot-password', element: <ForgotPasswordPage /> },
          { path: 'reset-password', element: <ResetPasswordPage /> },
          { path: 'verify-email', element: <VerifyEmailPage /> },
        ],
      },
      { path: 'create', element: page(<CreatePage />) },
      { path: 'local/:localId', element: page(<LocalEditorPage />) },
      { path: 's/:token', element: page(<SharedDesignPage />) },
      { element: <RequireAuth keepOpenWhenSessionEnds />, children: [{ path: 'design/:id', element: page(<DesignEditorPage />) }] },
      {
        element: <RequireAuth />,
        children: [
          {
            element: page(<DashboardLayout />),
            children: [
              { path: 'dashboard', element: <DashboardHomePage /> },
              { path: 'dashboard/designs', element: <DesignsPage /> },
              { path: 'dashboard/designs/folder/:folderId', element: <DesignsPage /> },
              { path: 'dashboard/starred', element: <DesignsPage starred /> },
              { path: 'dashboard/templates', element: <DashboardTemplatesPage /> },
              { path: 'dashboard/brand', element: <BrandPage /> },
              { path: 'dashboard/uploads', element: <UploadsPage /> },
              { path: 'dashboard/trash', element: <TrashPage /> },
              { path: 'settings', element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: 'dashboard/*', element: <Navigate to="/dashboard" replace /> },
      // The presenter view ("Present with notes" second window) — hosted on its own route so the
      // window the editor opens shares this app's origin and styles.
      { path: 'presenter-view', element: page(<PresenterViewPage />) },
    ],
  },
]
