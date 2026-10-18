import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FeedbackProvider } from "./components/FeedbackCenter";
import "mapbox-gl/dist/mapbox-gl.css";
import "./styles.css";
import "./styles/batch-history.css";

createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <FeedbackProvider>
      <App />
    </FeedbackProvider>
  </ErrorBoundary>,
);
