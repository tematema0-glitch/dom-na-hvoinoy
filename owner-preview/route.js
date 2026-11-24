import { readFile } from 'node:fs/promises';

// Private, isolated preview. No database mutations or booking handlers.
export function mountOwnerPreview(app, isAdmin) {
  app.get('/admin/dark-side', async (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (!isAdmin(req)) {
      return res.status(401).type('text/plain').send('Требуется вход владельца. Откройте кабинет владельца на главной странице.');
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      return res.type('html').send(await readFile(new URL('./dark-side.html', import.meta.url), 'utf8'));
    } catch (error) { return next(error); }
  });
}
