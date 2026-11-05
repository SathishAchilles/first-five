export class ProviderUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
  }
}
