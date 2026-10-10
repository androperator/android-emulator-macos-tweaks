import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../src/platform.js';
export async function generateIcons(root, destination) {
  const icons = join(destination, 'icons');
  await mkdir(icons, { recursive: true });
  await cp(join(root, 'assets/256.png'), join(icons, 'phone.png'));
  const variants = {
    tablet: '<rect x="59" y="42" width="138" height="172" rx="14" fill="#4083F7"/><rect x="71" y="55" width="114" height="146" rx="3" fill="white"/>',
    tv: '<rect x="31" y="64" width="194" height="124" rx="12" fill="#4083F7"/><rect x="43" y="76" width="170" height="100" rx="3" fill="white"/><path d="M109 188h38v15h25v10H84v-10h25z" fill="#4083F7"/>',
    watch: '<rect x="104" y="29" width="48" height="198" rx="15" fill="#4083F7"/><rect x="75" y="69" width="106" height="118" rx="28" fill="#4083F7"/><rect x="86" y="80" width="84" height="96" rx="20" fill="white"/>',
    automotive: '<path d="M58 109l17-43h106l17 43 13 12v68h-24v-19H69v19H45v-68z" fill="#4083F7"/><path d="M84 77h88l11 32H73z" fill="white"/><rect x="67" y="119" width="122" height="40" rx="7" fill="white"/>'
  };
  const config = await readFile(join(root, 'assets/Emulator.icon/icon.json'), 'utf8');
  for (const [variant, frame] of Object.entries(variants)) {
    const folder = join(destination, 'render', variant);
    const source = join(folder, 'Emulator.icon');
    await mkdir(join(source, 'Assets'), { recursive: true });
    await mkdir(join(folder, 'compiled'), { recursive: true });
    await writeFile(join(source, 'icon.json'), config);
    const scale = variant === 'watch' ? 0.8 : variant === 'automotive' ? 0.5 : 1;
    const y = variant === 'automotive' ? 138 : 126;
    const android = `<g transform="translate(128 ${y}) scale(${scale})"><path d="M-37 14a37 37 0 0 1 74 0z" fill="#35D780"/><path d="M-23-14l-8-12m54 12l8-12" stroke="#35D780" stroke-width="3" stroke-linecap="round"/><circle cx="-16" cy="2" r="3.5" fill="white"/><circle cx="16" cy="2" r="3.5" fill="white"/></g>`;
    await writeFile(join(source, 'Assets/emulator-symbol.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 256 256">${frame}${android}</svg>`);
    await run('/usr/bin/xcrun', ['actool', source, '--compile', join(folder, 'compiled'), '--app-icon', 'Emulator', '--platform', 'macosx', '--minimum-deployment-target', '14.0', '--output-partial-info-plist', join(folder, 'compiled/info.plist')]);
    await run('/usr/bin/iconutil', ['-c', 'iconset', join(folder, 'compiled/Emulator.icns'), '-o', join(folder, 'Emulator.iconset')]);
    await cp(join(folder, 'Emulator.iconset/icon_128x128@2x.png'), join(icons, `${variant}.png`));
  }
}
