import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import HomePage from "@/pages/Home";
import AddConnectionPage from "@/pages/AddConnection";
import AddConnectionFormPage from "@/pages/AddConnectionForm";
import LocalPostgresSelectionPage from "@/pages/LocalPostgresSelection";
import DatabaseView from "@/pages/DatabaseView";
import SettingsPage from "@/pages/Settings";
import { MainLayout } from "@/components/main-layout";
import { TitleBar } from "@/components/title-bar";
import "@/index.css";

const queryClient = new QueryClient();

/**
 * Persists the app layout (left sidebar, connection switcher) across the
 * database sub-routes so the workspace stays mounted and tab state is preserved.
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
        <div className="flex flex-col h-screen overflow-hidden bg-background">
          <TitleBar />
          <div className="flex-1 min-h-0 overflow-hidden">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/add-connection" element={<AddConnectionPage />} />
              <Route path="/add-connection/local" element={<LocalPostgresSelectionPage />} />
              <Route path="/add-connection/:provider" element={<AddConnectionFormPage />} />
              <Route path="/db/:connection" element={<DbLayout />}>
                <Route index element={<DatabaseView />} />
                <Route path="table/:table" element={<DatabaseView />} />
                <Route path="query" element={<DatabaseView />} />
                <Route path="visualizer" element={<DatabaseView />} />
              </Route>
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </div>
        </div>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

export default App;
