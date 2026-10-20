// "iPhone · Safari" from a browser's user-agent string, so a list of registered phones is recognisable. Best effort: an unknown
// agent reads as "Device".
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? `${device} · ${browser}` : device;
}
