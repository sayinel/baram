import { Component, type ErrorInfo, type ReactNode } from "react";

import { logger } from "../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p
            style={{ color: "var(--color-text-secondary)", margin: "0.5rem 0" }}
          >
            {this.state.error?.message}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };
}
