/**
 * ErrorBoundary — catches render errors in a tab so one bad tab shows a
 * readable message instead of white-screening the whole app.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
}
interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the webview console too (visible in devtools / forwarded logs).
    console.error(`[${this.props.label}] render crash:`, error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-6">
          <div className="max-w-2xl rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950 p-4">
            <p className="text-red-700 dark:text-red-300 font-semibold text-sm">
              {this.props.label} crashed while rendering
            </p>
            <pre className="mt-2 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            {this.state.info ? (
              <pre className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-all max-h-48 overflow-auto">
                {this.state.info}
              </pre>
            ) : null}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
