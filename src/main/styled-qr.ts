import QRCode from "qrcode";

// Styled QR matching the game's qr-code-styling look (rounded dots +
// extra-rounded violet finder corners on white), rendered from the qrcode
// matrix so it ships in the asar and is injectable into the read-only lobby.
// Replaces the flat qrcode-lib SVG, which looked plain after the join-URL patch.
export function buildStyledQrSvg(
  data: string,
  opts: { dotColor?: string; cornerColor?: string; cornerDotColor?: string; bg?: string; margin?: number } = {},
): string {
  const dotColor = opts.dotColor ?? "#2e1065";
  const cornerColor = opts.cornerColor ?? "#7c3aed";
  const cornerDotColor = opts.cornerDotColor ?? "#2e1065";
  const bg = opts.bg ?? "#ffffff";
  const margin = opts.margin ?? 2;

  const qr = QRCode.create(data, { errorCorrectionLevel: "M" });
  const N = qr.modules.size;
  const bits = qr.modules.data; // 1 = dark
  const dark = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < N && c < N && bits[r * N + c] === 1;
  const inFinder = (r: number, c: number) => {
    const box = (br: number, bc: number) => r >= br && r < br + 7 && c >= bc && c < bc + 7;
    return box(0, 0) || box(0, N - 7) || box(N - 7, 0);
  };

  const total = N + margin * 2;
  const p: string[] = [`<rect width="${total}" height="${total}" fill="${bg}"/>`];

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (!dark(r, c) || inFinder(r, c)) continue;
      const x = (c + margin + 0.06).toFixed(2);
      const y = (r + margin + 0.06).toFixed(2);
      p.push(`<rect x="${x}" y="${y}" width="0.88" height="0.88" rx="0.34" fill="${dotColor}"/>`);
    }
  }

  const finder = (br: number, bc: number) => {
    const x = bc + margin, y = br + margin;
    p.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="2" ry="2" fill="none" stroke="${cornerColor}" stroke-width="1"/>`);
    p.push(`<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.9" ry="0.9" fill="${cornerDotColor}"/>`);
  };
  finder(0, 0); finder(0, N - 7); finder(N - 7, 0);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">${p.join("")}</svg>`;
}
