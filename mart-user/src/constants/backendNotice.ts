// The full-screen notice shown when the *backend itself* is unreachable — a
// suspended or stopped server, a failed deploy, a database outage. It is not
// shown when the customer's own device is offline (that keeps its own screen).
//
// This file exists so the wording can be changed without touching any
// component: edit the strings below and redeploy the Cloudflare Pages site
// (`npm run build --workspace=mart-user`, output `mart-user/dist`).
// NetworkStatus renders whatever is declared here.
//
// Set `enabled` to false to fall back to the generic "Something went wrong"
// copy for the same outage.

export interface BackendNotice {
  /** Turn the notice off without deleting the wording below. */
  enabled: boolean;
  /** Path under `public/`. Rendered above the text. */
  image: string;
  /** Intrinsic pixel size, so layout space is reserved before it loads. */
  imageWidth: number;
  imageHeight: number;
  /** The heading, rendered as the large line above the message. */
  title: string;
  /** Supporting lines, rendered in order underneath the heading. */
  body: string[];
  /** Label of the button that re-checks the backend and hides the notice. */
  checkAgainLabel: string;
}

export const BACKEND_NOTICE: BackendNotice = {
  enabled: true,
  image: '/backend_donw.webp',
  imageWidth: 841,
  imageHeight: 619,
  title: 'Your neighbourhood store is taking a little break.',
  body: ['On the occasion of festival.', 'Thank you for your patience!'],
  checkAgainLabel: 'Check Again',
};
