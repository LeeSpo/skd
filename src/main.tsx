import "./lib/i18n";
import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/globals.css";
import { initializeTheme } from "./lib/utils";

// Initialize theme before rendering
initializeTheme();

const mode = new URLSearchParams(window.location.search).get("mode");
const Root = lazy(() => {
  if (mode === "file-viewer") {
    return import("./FileViewerWindow.tsx").then((module) => ({
      default: module.FileViewerWindow,
    }));
  }
  return import("./App.tsx");
});

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}>
    <Root />
  </Suspense>,
);
