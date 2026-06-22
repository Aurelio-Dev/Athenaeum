import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import "./styles/index.css";

type ErrorBoundaryState = {
  error: Error | null;
};

class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Erro ao renderizar o Athenaeum.", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-app px-6 text-center text-text-primary">
          <div className="max-w-md rounded-lg border border-border-muted bg-surface-panel p-6 shadow-card">
            <h1 className="text-lg font-bold">Nao foi possivel carregar o Athenaeum</h1>
            <p className="mt-3 text-sm text-text-secondary">
              Feche o aplicativo e abra novamente. Se continuar acontecendo, o erro foi registrado no console do app.
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
