/**
 * An error whose message is safe to show a customer, paired with the HTTP status
 * that says who is at fault.
 *
 * Why this exists: errorHandler() masks any 5xx as "Something went wrong" so that
 * internals never leak. That is correct for genuine faults, but the services used
 * to throw bare `new Error(...)` for ordinary customer mistakes -- a mistyped OTP,
 * an expired coupon, an address that does not exist. With no status attached those
 * all became 500 and the customer was told "Something went wrong" instead of the
 * message that would actually help them. Throwing an ApiError with a 4xx keeps the
 * useful text on the 4xx path where errorHandler passes it through untouched.
 *
 * Genuine server faults should still be thrown as a plain Error so they stay 500
 * and stay masked.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // Keeps `instanceof` working when the build targets ES5-era output.
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const unauthorized = (message: string) => new ApiError(401, message);
export const forbidden = (message: string) => new ApiError(403, message);
export const notFound = (message: string) => new ApiError(404, message);
export const conflict = (message: string) => new ApiError(409, message);
export const tooManyRequests = (message: string) => new ApiError(429, message);
export const badGateway = (message: string) => new ApiError(502, message);