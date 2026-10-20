import { create } from 'zustand';

/**
 * How a new build reaches a running client.
 *
 *   silent — applied on the next open, or when the app is backgrounded. An
 *            active customer is never interrupted.
 *   force  — the running app swaps to the new build straight away, including
 *            an installed PWA that was opened after the deploy.
 */
export type UpdateMode = 'silent' | 'force';

interface UpdateState {
  /**
   * The first version check has resolved. Until it has, the app cannot know
   * whether it is up to date, so anything that depends on that (the launch
   * splash) has to wait.
   */
  checked: boolean;
  /**
   * The build this app is running is not the build the server is serving.
   */
  stale: boolean;
  /** The deploy mode the server is asking for. */
  mode: UpdateMode;
  /**
   * A build swap is under way. The launch splash is held over it, so the
   * customer sees one continuous launch that ends on the new build rather
   * than the stale app, then the splash, then the new app.
   */
  swapPending: boolean;
  set: (patch: Partial<Omit<UpdateState, 'set'>>) => void;
}

export const useUpdateStore = create<UpdateState>()((set) => ({
  checked: false,
  stale: false,
  mode: 'silent',
  swapPending: false,
  set: (patch) => set(patch),
}));
