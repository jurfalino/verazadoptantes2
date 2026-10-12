// The /api/v1/docs page (Scalar explorer over /api/v1/openapi.json).
//
// This page runs third-party code on our origin, so it is locked down:
//   - the bundle is pinned to one version with a Subresource Integrity hash
//     (a compromised release can't run here);
//   - Scalar's request proxy (proxy.scalar.com, its default) and telemetry are
//     off: "try it" calls carry the partner's key and person data and must go
//     straight to us;
//   - the page's own CSP only lets it talk to this origin (connect-src 'self'),
//     which also enforces the above if a config option is ever ignored.
// Upgrading Scalar = change SCALAR_VERSION and SCALAR_SRI together
// (sha384 of dist/browser/standalone.js) and the inline-script hash if the
// config line changes.
export const SCALAR_VERSION = '1.73.1';
export const SCALAR_SRI = 'sha384-kYDGzV91Jnn3TbHINV3nt54riK2uMJDfN5Al8dAkz4FssELTBWbD8rgw32sTKfOi';
export const INLINE = `Scalar.createApiReference('#app', { url: '/api/v1/openapi.json', proxyUrl: '', telemetry: false, withDefaultFonts: false, hideClientButton: true });`;
export const INLINE_SHA256 = 'sha256-urk7NsSaUutkZVdGpg5VyOWxBO8fxNAoInqGuCEM17g=';

export const CSP = [
    "default-src 'none'",
    `script-src https://cdn.jsdelivr.net '${INLINE_SHA256}'`,
    "style-src 'unsafe-inline'",
    "connect-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
].join('; ');

export const PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BuenAdoptante API</title>
  <meta name="robots" content="noindex" />
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js" integrity="${SCALAR_SRI}" crossorigin="anonymous"></script>
  <script>${INLINE}</script>
</body>
</html>`;
