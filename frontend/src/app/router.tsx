import { lazy, Suspense } from 'react';
import { PageLoading } from '../components/PageStates';
import { createBrowserRouter } from 'react-router-dom';
import { MainLayout } from './layout/MainLayout';
import { AudienceProvider } from './audience';

const Dashboard = lazy(() => import('../pages/Dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })));
const Settings = lazy(() => import('../pages/Settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AgentWorkbench = lazy(() => import('../pages/AgentWorkbench/AgentWorkbenchPage').then(m => ({ default: m.AgentWorkbenchPage })));
const ScenarioLibrary = lazy(() => import('../pages/ScenarioLibrary/ScenarioLibraryPage').then(m => ({ default: m.ScenarioLibraryPage })));
const ModelCenter = lazy(() => import('../pages/ModelCenter/ModelCenterPage').then(m => ({ default: m.ModelCenterPage })));
const ComponentLibrary = lazy(() => import('../pages/ComponentLibrary/ComponentLibraryPage').then(m => ({ default: m.ComponentLibraryPage })));
const FunctionAssets = lazy(() => import('../pages/FunctionAssets/FunctionAssetsPage').then(m => ({ default: m.FunctionAssetsPage })));
const TaskCenter = lazy(() => import('../pages/TaskCenter/TaskCenterPage').then(m => ({ default: m.TaskCenterPage })));
const ResultCenter = lazy(() => import('../pages/ResultCenter/ResultCenterPage').then(m => ({ default: m.ResultCenterPage })));
const ModelServices = lazy(() => import('../pages/ModelServices/ModelServicesPage').then(m => ({ default: m.ModelServicesPage })));
const SkillCenter = lazy(() => import('../pages/SkillCenter/SkillCenterPage').then(m => ({ default: m.SkillCenterPage })));
const ModelCreation = lazy(() => import('../features/model-creation/ModelCreationPage').then(m => ({ default: m.ModelCreationPage })));
const load = (node: React.ReactNode) => <Suspense fallback={<PageLoading />}>{node}</Suspense>;

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AudienceProvider><MainLayout /></AudienceProvider>,
    children: [
      { index: true, element: load(<Dashboard />) },
      { path: 'scenarios', element: load(<ScenarioLibrary />) },
      { path: 'models', element: load(<ModelCenter />) },
      { path: 'models/create', element: load(<ModelCreation />) },
      { path: 'models/:id/edit', element: load(<ModelCreation />) },
      { path: 'models/:id', element: load(<ModelCenter />) },
      { path: 'components', element: load(<ComponentLibrary />) },
      { path: 'components/:id', element: load(<ComponentLibrary />) },
      { path: 'functions', element: load(<FunctionAssets />) },
      { path: 'runtime', element: load(<Settings variant="runtime" />) },
      { path: 'tasks', element: load(<TaskCenter />) },
      { path: 'results', element: load(<ResultCenter />) },
      { path: 'services', element: load(<ModelServices />) },
      { path: 'model-services', element: load(<ModelServices />) },
      { path: 'skills', element: load(<SkillCenter />) },
      { path: 'agents', element: load(<AgentWorkbench />) },
      { path: 'settings', element: load(<Settings variant="settings" />) },
    ],
  },
]);
