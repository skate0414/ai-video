import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { ProjectLayout } from './components/ProjectLayout';
import { PipelinePage } from './pages/PipelinePage';
import { StylePage } from './pages/StylePage';
import { ScriptPage } from './pages/ScriptPage';
import { StoryboardPage } from './pages/StoryboardPage';
import { ProductionPage } from './pages/ProductionPage';
import { RefinePage } from './pages/RefinePage';
import { ReplayPage } from './pages/ReplayPage';
import { SettingsPage } from './pages/SettingsPage';

function AppRoutes() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<PipelinePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path=":projectId" element={<ProjectLayout />}>
          <Route index element={<Navigate to="style" replace />} />
          <Route path="style" element={<StylePage />} />
          <Route path="script" element={<ScriptPage />} />
          <Route path="storyboard" element={<StoryboardPage />} />
          <Route path="production" element={<ProductionPage />} />
          <Route path="refine" element={<RefinePage />} />
          <Route path="replay" element={<ReplayPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </ErrorBoundary>
  );
}
