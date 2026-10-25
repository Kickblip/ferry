/** An error that maps to an HTTP response: `{ error: { code, message } }`. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

/** A Nessie call failed. `retryable` is false for 4xx responses that won't succeed on retry. */
export class NessieError extends Error {
  constructor(
    message: string,
    public status: number | null,
    public retryable: boolean
  ) {
    super(message)
  }
}
