/**
 * One region of the page dies instead of the whole page.
 *
 * `Player.publishUi` runs inside the `requestAnimationFrame` callback, which
 * has already re-scheduled itself by the time React renders. So a panel that
 * throws on one bad value in one slice throws out of `world.update`, React 19
 * drops the partially-rendered tree, and what is left is a blank page and an
 * exception sixty times a second with nothing in it that says which panel or
 * which value. A boundary turns that into a bordered box where the panel was,
 * naming the region and the message, with the rest of the page still live.
 *
 * **Recovery is explicit, and never automatic.** Retry is a button, and it is
 * the only thing that clears the state. Do not reset the boundary when the
 * projection changes, do not give it a `key` that moves with the frame, do not
 * reset it in `componentDidUpdate`: the store publishes at up to 60 Hz, and a
 * boundary that resets on each publish re-renders the throwing component sixty
 * times a second. That is a tight loop that burns the frame budget and floods
 * the console — strictly worse than the blank page it was meant to prevent.
 * The projection is a pure function of the world, so a value that threw once
 * will keep throwing until the world moves on, which the person watching can
 * see and a `componentDidUpdate` cannot.
 *
 * This is a class because `getDerivedStateFromError` and `componentDidCatch`
 * still have no hook equivalent in React 19, and a dependency for a component
 * this size would not pay for itself — see `web/tools/verify_ui.mjs`'s header
 * for the standing argument about what a new package costs this repo.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  /** What died, in the words a person reading the fallback would use. */
  label: string;
  children: ReactNode;
  /** Reported once centrally as well; `app/ui_root.ts` supplies it. */
  onError?: (label: string, error: unknown, info?: unknown) => void;
}

/**
 * The caught value is **boxed**, and the box is what says a throw happened.
 *
 * A bare `error: unknown` compared against `null` cannot tell "healthy" from
 * "something threw `null`", and `throw null` is legal. React would catch it,
 * `getDerivedStateFromError` would store `null`, the boundary would read that
 * as healthy, render the children, and they would throw again -- the sixty
 * times a second loop this file exists to prevent, arrived at from the other
 * direction. The box has no such value to collide with.
 */
interface ErrorBoundaryState {
  thrown: { value: unknown } | null;
}

/** Whatever was thrown, as something worth putting in front of a person. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export class ErrorBoundary
    extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { thrown: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { thrown: { value: error } };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(this.props.label, error, info);
  }

  override render(): ReactNode {
    const { thrown } = this.state;
    // No wrapper element while the region is healthy. `#stagearea` is a grid
    // that places its four columns by source order, so a boundary that added a
    // `<div>` around `#left` or `#right` would move the column it was meant to
    // protect.
    if (thrown === null) return this.props.children;
    return (
      <div className="errbox" role="alert">
        <div className="errbox-label">{this.props.label} failed</div>
        <div className="errbox-msg">{messageOf(thrown.value)}</div>
        <button type="button" className="mini"
                onClick={() => this.setState({ thrown: null })}>
          Retry
        </button>
      </div>
    );
  }
}
