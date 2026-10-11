// 把各型号算出来的几何导出成 JSON，给 tools/draw_layout.py 画示意图用。
// 这样示意图和运行时用的是**同一份 layout.js**，不会各画各的。
import { computeLayout, textMetrics } from '../src/common/layout.js'
import { readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const prof = JSON.parse(readFileSync(join(here, '..', 'profiles.json'), 'utf8')).profiles

const out = []
for (const [key, p] of Object.entries(prof)) {
  for (const d of p.devices) {
    const L = computeLayout(d.w, d.h)
    const tm = textMetrics(L, 20)
    out.push({
      profile: key, name: d.name, phys: [d.w, d.h], lay: L,
      text20: { cpl: tm.cpl, lpp: tm.lpp, lineH: tm.lineH },
    })
  }
}

// 直接写文件：PowerShell 的 > 重定向会写成 UTF-16，Python 那边读不了
const dst = process.argv[2] || join(here, '..', 'layout.json')
writeFileSync(dst, JSON.stringify(out, null, 1), 'utf8')
console.log('  -> ' + dst + '  ' + out.length + ' 个型号')
