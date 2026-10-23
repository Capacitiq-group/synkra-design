// SYNKRA brand asset generator — replaces the legacy bunny mark/sticker.
// Renders the SYNKRA "S" bento monogram and the bento-stack sticker from
// hand-authored SVG via sharp, then writes every branded raster the app serves.
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'

const ROOT = '/home/z/my-project'
const ICONS = path.join(ROOT, 'public/icons')
const ASSETS = path.join(ROOT, 'public/studio-assets')

const INK = '#15161a'
const INK_SOFT = '#24262e'
const LIME = '#d6f824'
const LIME_SOFT = '#eefbc0'
const PEACH = '#fde6d2'
const SKY = '#d8e9fe'
const BONE = '#f4f3f0'

// ---------------------------------------------------------------- mark
// Bento rounded square, obsidian, with a geometric lime "S" drawn from two arcs.
function markSvg({ size = 512, radiusRatio = 0.24, maskable = false } = {}): string {
  const r = size * radiusRatio
  const pad = maskable ? size * 0.14 : 0
  const box = size - pad * 2
  // S geometry inside a box positioned at [pad, pad, box, box]
  const cx = pad + box / 2
  const top = pad + box * 0.24
  const mid = pad + box * 0.5
  const bot = pad + box * 0.76
  const arm = box * 0.26 // horizontal reach of each loop
  const stroke = box * 0.16
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" fill="${INK}"/>
  <g fill="none" stroke="${LIME}" stroke-width="${stroke}" stroke-linecap="round" transform="translate(${cx} ${mid}) scale(0.68) translate(${-cx} ${-mid})">
    <path d="M ${cx + arm},${top + stroke * 0.15} A ${box * 0.245},${box * 0.245} 0 1 0 ${cx},${mid}"/>
    <path d="M ${cx},${mid} A ${box * 0.245},${box * 0.245} 0 1 1 ${cx - arm},${bot - stroke * 0.15}"/>
  </g>
</svg>`
}

// ---------------------------------------------------------------- sticker
// Tall bento composition (523x713 like the old sticker): an S-mark card,
// a peach card with sky bubble, a sky card with a lime squiggle, a spark.
function stickerSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 523 713" width="523" height="713">
  <!-- back card: sky, rotated slightly -->
  <g transform="rotate(-4 250 420)">
    <rect x="60" y="300" width="360" height="330" rx="56" fill="${SKY}"/>
    <circle cx="150" cy="392" r="34" fill="${LIME}"/>
    <path d="M 120 520 Q 200 470 250 520 T 380 520" fill="none" stroke="${INK}" stroke-width="18" stroke-linecap="round"/>
    <rect x="120" y="560" width="180" height="16" rx="8" fill="${INK}" opacity="0.18"/>
  </g>
  <!-- middle card: peach -->
  <g transform="rotate(5 330 300)">
    <rect x="150" y="180" width="300" height="230" rx="48" fill="${PEACH}"/>
    <circle cx="240" cy="262" r="26" fill="${INK}"/>
    <path d="M 210 330 Q 300 372 390 330" fill="none" stroke="${INK}" stroke-width="16" stroke-linecap="round"/>
  </g>
  <!-- top card: obsidian with the lime S -->
  <g transform="rotate(-7 240 140)">
    <rect x="66" y="24" width="330" height="250" rx="52" fill="${INK}"/>
    <g fill="none" stroke="${LIME}" stroke-width="26" stroke-linecap="round" transform="translate(231 150) scale(0.78) translate(-231 -150)">
      <path d="M 288,84 A 62,62 0 1 0 231,150"/>
      <path d="M 231,150 A 62,62 0 1 1 174,216"/>
    </g>
  </g>
  <!-- spark -->
  <g transform="translate(420 84)">
    <path d="M 0,-38 C 6,-12 12,-6 38,0 C 12,6 6,12 0,38 C -6,12 -12,6 -38,0 C -12,-6 -6,-12 0,-38 Z" fill="${LIME}"/>
  </g>
</svg>`
}

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  mkdirSync(ICONS, { recursive: true })
  mkdirSync(ASSETS, { recursive: true })

  // 1. Standalone logo.svg (currentColor-independent, ink on transparent? no: full mark)
  writeFileSync(path.join(ROOT, 'public/logo.svg'), markSvg({ size: 512 }))

  // 2. App icons
  const iconTargets: [string, sharp.RenderOptions & { width: number; height: number }, Parameters<typeof markSvg>[0]][] = [
    ['favicon-32.png', { width: 32, height: 32 }, {}],
    ['apple-touch-icon.png', { width: 180, height: 180 }, {}],
    ['icon-192.png', { width: 192, height: 192 }, {}],
    ['icon-512.png', { width: 512, height: 512 }, {}],
    ['icon-maskable-512.png', { width: 512, height: 512 }, { maskable: true }],
  ]
  for (const [name, resize, opts] of iconTargets) {
    const png = await sharp(Buffer.from(markSvg({ size: 1024, ...opts })), { density: 300 })
      .resize(resize.width, resize.height)
      .png()
      .toBuffer()
    writeFileSync(path.join(ICONS, name), png)
  }

  // 3. Shell mark (used by Logo.tsx, previously bunny-mark.webp 128x128)
  const mark = await sharp(Buffer.from(markSvg({ size: 1024 })), { density: 300 })
    .resize(256, 256)
    .webp({ quality: 92 })
    .toBuffer()
  writeFileSync(path.join(ASSETS, 'synkra-mark.webp'), mark)

  // 4. Sticker (previously bunny-sticker.webp 523x713)
  const sticker = await sharp(Buffer.from(stickerSvg()), { density: 150 })
    .resize(1046, 1426)
    .webp({ quality: 92 })
    .toBuffer()
  writeFileSync(path.join(ASSETS, 'synkra-sticker.webp'), sticker)

  // 5. Open Graph image (1200x630) — SYNKRA bento branding, replaces the legacy bunny/Doory one
  const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${BONE}"/>
  <g fill="${INK}" opacity="0.06">
    ${Array.from({ length: 9 }, (_, col) => Array.from({ length: 5 }, (_, row) => `<circle cx="${64 + col * 134}" cy="${56 + row * 130}" r="3"/>`).join('')).join('')}
  </g>
  <g transform="translate(96 120) rotate(-6)">
    <rect x="0" y="0" width="360" height="360" rx="86" fill="${INK}"/>
    <g fill="none" stroke="${LIME}" stroke-width="52" stroke-linecap="round" transform="translate(180 180) scale(0.68) translate(-180 -180)">
      <path d="M 246,63 A 88,88 0 1 0 180,180"/>
      <path d="M 180,180 A 88,88 0 1 1 114,297"/>
    </g>
  </g>
  <g transform="translate(508 60) rotate(4)">
    <rect x="0" y="0" width="150" height="150" rx="38" fill="${SKY}"/>
    <circle cx="52" cy="48" r="22" fill="${LIME}"/>
    <path d="M 30 104 Q 75 84 120 104" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>
  </g>
  <g transform="translate(700 108) rotate(-5)">
    <rect x="0" y="0" width="118" height="118" rx="30" fill="${PEACH}"/>
    <path d="M 0,-30 C 5,-10 10,-5 30,0 C 10,5 5,10 0,30 C -5,10 -10,5 -30,0 C -10,-5 -5,-10 0,-30 Z" transform="translate(59 59)" fill="${LIME}"/>
  </g>
  <g transform="translate(508 336)">
    <text x="0" y="66" font-family="DejaVu Sans" font-weight="bold" font-style="italic" font-size="92" fill="${INK}">Synkra</text>
    <rect x="6" y="96" width="252" height="14" rx="7" fill="${LIME}"/>
    <text x="0" y="168" font-family="DejaVu Sans" font-size="34" fill="${INK}" opacity="0.75">Design anything in your browser.</text>
    <text x="0" y="222" font-family="LXGW WenKai" font-size="30" fill="${INK}" opacity="0.55">no sign-up to start</text>
  </g>
</svg>`
  const ogPng = await sharp(Buffer.from(og), { density: 144 }).resize(1200, 630).png().toBuffer()
  writeFileSync(path.join(ROOT, 'public/og-image.png'), ogPng)

  console.log('brand assets written: logo.svg, 5 icons, synkra-mark.webp, synkra-sticker.webp, og-image.png')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
