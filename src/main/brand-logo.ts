// Razzoozle wordmark logo (inline SVG), embedded so it ships inside the asar and
// is injectable into the game lobby (which is read-only and renders only the
// plain "Razzoozle" title text). Source: Razzoozle/cd-src/branding/razzoozle-logo.svg.
export const RAZZOOZLE_LOGO_SVG = `<svg viewBox="0 0 560 140" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="rz-title">
  <title id="rz-title">Razzoozle</title>
  <defs>
    <linearGradient id="rzViolet" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8B5CF6"/>
      <stop offset="1" stop-color="#6D28D9"/>
    </linearGradient>
    <g id="rzWord">
      <path d="M20 32 h34 a26 26 0 0 1 5 51 l20 21 h-27 l-17-19 h-2 v19 h-22 z M42 53 h-22 v12 h22 a6 6 0 0 0 0-12 z"/>
      <path d="M98 80 a24 24 0 0 1 47-7 v31 h-21 v-4 a23 23 0 1 1 -3-39 a23 23 0 0 1 3 1 a24 24 0 0 0 -26 18 z M122 72 a11 11 0 1 0 0 22 a11 11 0 0 0 0-22 z"/>
      <path d="M156 58 h44 v14 l-21 18 h21 v14 h-46 v-14 l23-18 h-21 z"/>
      <path d="M210 58 h44 v14 l-21 18 h21 v14 h-46 v-14 l23-18 h-21 z"/>
      <path d="M289 56 a24 24 0 1 1 0 48 a24 24 0 0 1 0-48 z M289 73 a7 7 0 1 0 0 14 a7 7 0 0 0 0-14 z"/>
      <path d="M347 56 a24 24 0 1 1 0 48 a24 24 0 0 1 0-48 z M347 73 a7 7 0 1 0 0 14 a7 7 0 0 0 0-14 z"/>
      <path d="M385 58 h44 v14 l-21 18 h21 v14 h-46 v-14 l23-18 h-21 z"/>
      <path d="M439 28 h21 v76 h-21 z"/>
      <path fill-rule="evenodd" d="M495 56 a24 24 0 1 0 17 41 l-11-12 a9 9 0 0 1 -6 3 a9 9 0 0 1 -8-12 h31 a24 24 0 0 0 -23-20 z M495 73 a9 9 0 0 0 -8 5 h16 a9 9 0 0 0 -8-5 z"/>
    </g>
  </defs>
  <use href="#rzWord" fill="url(#rzViolet)"/>
</svg>`;
