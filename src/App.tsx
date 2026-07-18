import { BrowserRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import HomePage from "@/pages/Home";
import AddConnectionPage from "@/pages/AddConnection";
import AddConnectionFormPage from "@/pages/AddConnectionForm";
import DatabaseView from "@/pages/DatabaseView";
import QueryView from "@/pages/QueryView";
import VisualizerPage from "@/pages/VisualizerPage";
import "@/index.css";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/add-connection" element={<AddConnectionPage />} />
          <Route path="/add-connection/:provider" element={<AddConnectionFormPage />} />
          <Route path="/db/:connection" element={<DatabaseView />} />
          <Route path="/db/:connection/query" element={<QueryView />} />
          <Route path="/db/:connection/table/:table" element={<DatabaseView />} />
          <Route path="/db/:connection/visualizer" element={<VisualizerPage />} />
        </Routes>
      </BrowserRouter>
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}

export default App;
