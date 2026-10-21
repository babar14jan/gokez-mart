/**
 * The wording for a closed store.
 *
 * Both places the customer meets a closure — the strip under the header and
 * the card that opens on arrival — say the same things, so the wording lives
 * here rather than being written twice and drifting apart.
 */

/**
 * The heading used when the store has not written one of its own.
 *
 * The store's own greeting is used first when there is one. This is the
 * fallback, and both the strip and the card use it, so the customer is never
 * told two different things about the same closure.
 *
 * The zone is deliberately not named here: the navbar directly above the
 * strip already says which store this is, and repeating it was noise.
 */
export function defaultClosedHeading(): string {
  return 'Your neighbourhood store is closed right now.';
}

/**
 * The reopening line.
 *
 * It answers the two questions a customer actually has: can I still order,
 * and when will it arrive. The order is still accepted while the store is
 * shut, and it is prepared when the store reopens, so the line says both
 * rather than leaving the customer to work it out.
 *
 * The reopening time is included when the store knows when it reopens, and it
 * is worded the way the server words it — "tomorrow at 9:00 AM" rather than a
 * date, "on 22 Oct at 6:00 PM" when it is further away. A store closed by
 * hand has no reopening time to promise, so the line says "as soon as we
 * reopen" rather than inventing one.
 */
export function reopenLine(resumeLabel: string | null | undefined): string {
  if (!resumeLabel) {
    return "You can still place your order — we'll deliver it as soon as we reopen.";
  }
  return `You can still place your order — we'll deliver it when we reopen ${resumeLabel}.`;
}

/**
 * The same reassurance in the form that fits inside the card's solid block,
 * where the time is already on the line above it.
 */
export function reopenBlockLine(resumeLabel: string | null | undefined): string {
  if (!resumeLabel) {
    return "You can still place your order — we'll deliver it as soon as we reopen.";
  }
  return "You can still place your order — we'll deliver it then.";
}
