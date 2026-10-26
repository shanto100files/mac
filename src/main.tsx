import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import { platformAxiosAdapter } from "./platform/network";
import "./styles/index.css";
import App from "./App";
import { installVegaLog } from "./lib/logging/vegaLog";
import {installTvHost} from './platform/tvHost';
import {initializeUiScale} from './lib/uiScale';

// First, so startup errors reach the exportable log file.
installVegaLog();
installTvHost();
initializeUiScale();

// The current host supplies HTTP access; direct browser requests remain available.
axios.defaults.adapter = platformAxiosAdapter;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
