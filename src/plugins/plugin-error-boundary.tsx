// §69 Plugin Error Boundary — Catches and isolates plugin render errors
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  pluginId: string;
}

interface State {
  error: Error | null;
  hasError: boolean;
}

export class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[PluginErrorBoundary] Plugin "${this.props.pluginId}" crashed:`,
      error,
      errorInfo,
    );
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          className="plugin-error-boundary"
          style={{
            padding: "12px 16px",
            margin: "8px 0",
            borderRadius: "6px",
            backgroundColor: "var(--color-error-bg, #fef2f2)",
            color: "var(--color-error, #dc2626)",
            fontSize: "13px",
            border: "1px solid var(--color-error-border, #fecaca)",
          }}
        >
          <strong>Plugin Error</strong>
          <p style={{ margin: "4px 0 0" }}>
            Plugin &quot;{this.props.pluginId}&quot; encountered an error and
            has been disabled.
          </p>
          {this.state.error && (
            <pre
              style={{
                margin: "8px 0 0",
                fontSize: "11px",
                whiteSpace: "pre-wrap",
                opacity: 0.7,
              }}
            >
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
