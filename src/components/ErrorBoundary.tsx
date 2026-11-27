import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("[Mindstone] UI error", error);
    void window.rea?.log("error", `UI error in ${this.props.label ?? "app"}: ${error.message}
${error.stack ?? ""}`);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="panel max-w-md p-5">
          <div className="mb-1 font-medium">Something went wrong{this.props.label ? ` in ${this.props.label}` : ""}</div>
          <p className="mb-3 text-ui text-muted">Your data is stored locally and was not affected. Details: {this.state.error.message}</p>
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}
