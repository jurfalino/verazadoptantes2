/** Public base URL for links that go out in emails. */
export function appBaseUrl(): string {
    return process.env.APP_ENVIRONMENT === 'production'
        ? 'https://buenadoptante.org'
        : 'https://staging.buenadoptante.org';
}
