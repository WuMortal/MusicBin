// Rasterize the branded SVG logo into a 1024x1024 PNG for `tauri icon`.
const fs = require('node:fs')
const path = require('node:path')
const { Resvg } = require('@resvg/resvg-js')

const root = path.resolve(__dirname, '..')
const svgPath = path.join(root, 'src-tauri', 'icons', 'logo.svg')
const outPath = path.join(root, 'src-tauri', 'icons', 'icon.png')

const svg = fs.readFileSync(svgPath, 'utf8')
const resvg = new Resvg(svg, {
  fitTo: { mode: 'width', value: 1024 },
  background: 'rgba(0,0,0,0)',
})
const png = resvg.render().asPng()
fs.writeFileSync(outPath, png)
console.log(`Wrote ${outPath} (${png.length} bytes)`)
