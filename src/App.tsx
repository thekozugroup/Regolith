import { BrowserRouter, Routes, Route } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { AppBar } from "./components/AppBar";
import { Dashboard } from "./pages/Dashboard";
import { Files } from "./pages/Files";
import { Control } from "./pages/Control";
import { Tune } from "./pages/Tune";
import { ConsolePage } from "./pages/Console";
import { SettingsPage } from "./pages/Settings";

function App() {
  return (
    <BrowserRouter>
      <Sidebar />
      <AppBar />
      <main className="ml-14 mt-13 min-h-[calc(100vh-3.25rem)]">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/print" element={<Files />} />
          <Route path="/control" element={<Control />} />
          <Route path="/tune" element={<Tune />} />
          <Route path="/console" element={<ConsolePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}

export default App;
