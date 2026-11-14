// Apply the saved or system theme before first paint (store/theme.ts keeps it in sync).
// A classic blocking script in its own file, so the CSP can stay `script-src 'self'`.
try {
  var t = localStorage.getItem('spotter-theme')
  if (t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches))
    document.documentElement.classList.add('dark')
} catch (e) {}
