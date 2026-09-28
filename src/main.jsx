import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "mapbox-gl/dist/mapbox-gl.css";
import "./styles.css";
import "./batch-accordion.css";

createRoot(document.getElementById("root")).render(<App />);
