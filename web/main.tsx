import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider, readTheme } from "./theme";
import "./styles.css";
import "./customer-workspace.css";

document.documentElement.dataset.theme = readTheme();

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="fatal">
        <h1>Something interrupted the console.</h1>
        <p>Your saved data is still on the server. Reload to reconnect.</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Reload Keydock
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
