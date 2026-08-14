import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import HomePage from "@/pages/Home";
import AddConnectionPage from "@/pages/AddConnection";
import AddConnectionFormPage from "@/pages/AddConnectionForm";
import LocalPostgresSelectionPage from "@/pages/LocalPostgresSelection";
import DatabaseView from "@/pages/DatabaseView";
import QueryView from "@/pages/QueryView";
import VisualizerPage from "@/pages/VisualizerPage";
import SettingsPage from "@/pages/Settings";
import { MainLayout } from "@/components/main-layout";
import "@/index.css";

const queryClient = new QueryClient();

/**
 * Persists the app layout (left sidebar, connection switcher) across the
 * database sub-routes so navigating between Query / Tables / Schema Visualizer
 * only swaps the content area instead of remounting the whole layout.
 */
function DbLayout() {
  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/add-connection" element={<AddConnectionPage />} />
          <Route path="/add-connection/local" element={<LocalPostgresSelectionPage />} />
          <Route path="/add-connection/:provider" element={<AddConnectionFormPage />} />
          <Route path="/db/:connection" element={<DbLayout />}>
            <Route index element={<DatabaseView />} />
            <Route path="table/:table" element={<DatabaseView />} />
            <Route path="query" element={<QueryView />} />
            <Route path="visualizer" element={<VisualizerPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

export default App;
