/**
 * 将源 PNG 处理成符合 macOS 规范的 ICNS 图标，解决 Tauri 生成的 Mac 图标过大的问题。
 * 参考: https://blog.csdn.net/weixin_44786530/article/details/143712658
 *
 * 处理流程:
 *   1. 重置为 1024x1024 (contain, 透明背景)
 *   2. 叠加 SVG 圆角蒙版 (rx=ry=250)
 *   3. 上下左右各扩展 120px 透明边距
 *   4. 用 png2icons 转成 ICNS
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const SIZE = 1024;
const PADDING = 120;
const RADIUS = 250;

const appPng = path.join(__dirname, 'app.png');
const repoIconPng = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.png');
// 优先使用 scripts/app.png（设计源图），没有则回退到 make-icon 生成的 1024 图标
const inputPath = fs.existsSync(appPng) ? appPng : repoIconPng;
const os = require('os');
const tmpPath = path.join(os.tmpdir(), 'music-bin-icon.png');
const outputPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.icns');

async function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`源图不存在: ${inputPath}，请先放置 scripts/app.png 或执行 npm run icon 生成 src-tauri/icons/icon.png`);
  }

  // 1. 重置尺寸 (contain, 透明背景)
  const resized = await sharp(inputPath)
    .resize(SIZE, SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  // 2. 叠加圆角蒙版 (dest-in: 保留蒙版不透明区域)
  const roundedMask = Buffer.from(
    `<svg width="${SIZE}" height="${SIZE}">
      <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="black"/>
    </svg>`
  );
  const rounded = await sharp(resized)
    .composite([{ input: roundedMask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 3. 扩展透明边距
  await sharp(rounded)
    .extend({
      top: PADDING,
      bottom: PADDING,
      left: PADDING,
      right: PADDING,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(tmpPath);

  // 4. 转 ICNS
  const data = fs.readFileSync(tmpPath);
  const icns = png2icons.createICNS(data, 1, 0);
  fs.writeFileSync(outputPath, icns);

  console.log(`✓ 已生成 macOS 图标: ${outputPath}`);
  console.log(`  尺寸信息: 源图已加圆角(${RADIUS}) + 边距(${PADDING}px)`);
}

main().catch((e) => {
  console.error('生成图标失败:', e);
  process.exit(1);
});
