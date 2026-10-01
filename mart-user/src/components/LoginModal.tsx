import LoginFlow, { LoginFlowProps } from './LoginFlow';

/**
 * The overlay host for the login flow.
 *
 * All of the behaviour lives in LoginFlow so the Account page can present the
 * exact same login without forking it. This file is only the chrome: the scrim,
 * the dialog box, the scroll container and the dialog semantics.
 *
 * Those container paddings are load-bearing, not cosmetic — LoginFlow's flush
 * login art is arithmetically tied to this px-5 / safe-area padding here and to
 * the px-7 it switches to at sm (see the note beside the image). Changing them
 * means changing those widths too. overflow-hidden is load-bearing for the same
 * reason: the art has no radius of its own, so this is what gives it the dialog's
 * corners at sm and up.
 */
export default function LoginModal(props: LoginFlowProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto overscroll-contain bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="relative flex w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-800 min-h-[calc(100dvh_-_var(--kb,0px))] sm:min-h-0 sm:rounded-3xl">

        <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-7 sm:pb-7">
          <LoginFlow {...props} variant="modal" />
        </div>
      </div>
    </div>
  );
}