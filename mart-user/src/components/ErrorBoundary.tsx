import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for the whole app.
 *
 * Without this, a single throw during render leaves the root unmounted and the
 * PWA showing nothing at all: on a phone that is an installed app with no
 * address bar to recover with. The boundary keeps the app mounted and offers a
 * way back instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Left to Sentry/hosting integration if one is wired up later. Logging is
    // deliberate: swallowing this would make field reports impossible to triage.
    console.error('[mart] unhandled render error', error, info.componentStack);
  }

  private reload = () => window.location.reload();

  /**
   * Clears the persisted cart, guest tracking tokens and flow state, then
   * reloads. Offered separately from reload because a corrupt cached value is a
   * common trigger, and reload alone would hit it again forever.
   */
  private startFresh = () => {
    try {
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('guest_') || k.startsWith('mart_') || k === 'cart')
        .forEach((k) => window.localStorage.removeItem(k));
    } catch {
      // Storage can throw in private browsing; a plain reload still helps.
    }
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-950 px-6">
        <div className="max-w-sm text-center">
          <div className="text-5xl mb-4" aria-hidden="true">
            🛒
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Something went wrong
          </h1>
          <p className="text-sm text-gray-600 dark:text-slate-400 mb-6">
            This screen hit an error. Your cart is saved — reloading usually
            brings it back.
          </p>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={this.reload}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-colors"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.startFresh}
              className="w-full py-3 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-800 dark:text-slate-200 font-semibold transition-colors"
            >
              Reload and clear saved data
            </button>
          </div>

          {process.env.NODE_ENV === 'development' && (
            <pre className="mt-6 text-left text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-lg p-3 overflow-auto max-h-40">
              {this.state.error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}