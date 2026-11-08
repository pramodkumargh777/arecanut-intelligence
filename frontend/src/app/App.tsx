import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { LoadingState } from "../components/State";
import { MarketDataPage } from "../pages/CooperativeMarketPage";
import { LanguageProvider } from "../services/language";

const HomePage = lazy(() => import("../pages/HomePage").then((module) => ({ default: module.HomePage })));
const SellOrHoldPage = lazy(() => import("../pages/SellOrHoldPage").then((module) => ({ default: module.SellOrHoldPage })));
const OverviewPage = lazy(() => import("../pages/OverviewPage").then((module) => ({ default: module.OverviewPage })));
const PricesPage = lazy(() => import("../pages/PricesPage").then((module) => ({ default: module.PricesPage })));
const AnalyticsPage = lazy(() => import("../pages/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })));
const ComparePage = lazy(() => import("../pages/ComparePage").then((module) => ({ default: module.ComparePage })));
const DataQualityPage = lazy(() => import("../pages/DataQualityPage").then((module) => ({ default: module.DataQualityPage })));
const MonthlyTrendsPage = lazy(() => import("../pages/MonthlyTrendsPage").then((module) => ({ default: module.MonthlyTrendsPage })));
const HistoricalAnalyticsPage = lazy(() => import("../pages/HistoricalAnalyticsPage").then((module) => ({ default: module.HistoricalAnalyticsPage })));
const DecisionToolsPage = lazy(() => import("../pages/DecisionToolsPage").then((module) => ({ default: module.DecisionToolsPage })));
const IntelligencePage = lazy(() => import("../pages/IntelligencePage").then((module) => ({ default: module.IntelligencePage })));
const QualityInspectionsPage = lazy(() => import("../pages/QualityInspectionsPage").then((module) => ({ default: module.QualityInspectionsPage })));
const ForecastEvaluationPage = lazy(() => import("../pages/ForecastEvaluationPage").then((module) => ({ default: module.ForecastEvaluationPage })));
const SupplyPage = lazy(() => import("../pages/SupplyPage").then((module) => ({ default: module.SupplyPage })));
const AssistantPage = lazy(() => import("../pages/AssistantPage").then((module) => ({ default: module.AssistantPage })));
const WorkspacePage = lazy(() => import("../pages/WorkspacePage").then((module) => ({ default: module.WorkspacePage })));
const NotFoundPage = lazy(() => import("../pages/NotFoundPage").then((module) => ({ default: module.NotFoundPage })));
const ForecastsPage = lazy(() => import("../pages/ForecastsPage").then((module) => ({ default: module.ForecastsPage })));

export function App() {
  return (
    <LanguageProvider><BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Suspense fallback={<LoadingState />}><HomePage /></Suspense>} />
          <Route path="sell-or-hold" element={<Suspense fallback={<LoadingState />}><SellOrHoldPage /></Suspense>} />
          <Route path="overview" element={<Suspense fallback={<LoadingState />}><MarketDataPage official={<OverviewPage />} /></Suspense>} />
          <Route path="prices" element={<Suspense fallback={<LoadingState />}><MarketDataPage official={<PricesPage />} /></Suspense>} />
          <Route path="monthly-trends" element={<Suspense fallback={<LoadingState />}><MonthlyTrendsPage /></Suspense>} />
          <Route path="history" element={<Suspense fallback={<LoadingState />}><HistoricalAnalyticsPage /></Suspense>} />
          <Route path="decision-tools" element={<Suspense fallback={<LoadingState />}><DecisionToolsPage /></Suspense>} />
          <Route path="intelligence" element={<Navigate to="/intelligence/production" replace />} />
          <Route path="intelligence/quality" element={<Suspense fallback={<LoadingState />}><QualityInspectionsPage /></Suspense>} />
          <Route path="intelligence/:domain" element={<Suspense fallback={<LoadingState />}><IntelligencePage /></Suspense>} />
          <Route path="supply" element={<Suspense fallback={<LoadingState />}><SupplyPage /></Suspense>} />
          <Route path="forecasts" element={<Suspense fallback={<LoadingState />}><ForecastsPage /></Suspense>} />
          <Route path="forecasts/evaluation" element={<Suspense fallback={<LoadingState />}><ForecastEvaluationPage /></Suspense>} />
          <Route path="assistant" element={<Suspense fallback={<LoadingState />}><AssistantPage /></Suspense>} />
          <Route path="analytics" element={<Suspense fallback={<LoadingState />}><MarketDataPage official={<AnalyticsPage />} /></Suspense>} />
          <Route path="compare" element={<Suspense fallback={<LoadingState />}><MarketDataPage official={<ComparePage />} /></Suspense>} />
          <Route path="workspace" element={<Suspense fallback={<LoadingState />}><WorkspacePage /></Suspense>} />
          <Route path="data-quality" element={<Suspense fallback={<LoadingState />}><DataQualityPage /></Suspense>} />
          <Route path="*" element={<Suspense fallback={<LoadingState />}><NotFoundPage /></Suspense>} />
        </Route>
      </Routes>
    </BrowserRouter></LanguageProvider>
  );
}
