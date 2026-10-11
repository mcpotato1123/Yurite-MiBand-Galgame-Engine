// 核对自适应几何：H=480 必须和老版式逐像素一致，其它尺寸要合理
import { computeLayout, textMetrics, describe } from '../src/common/layout.js'
import { detectModel, MODELS } from '../src/common/models.js'

// 老版式（手环 9 Pro / v2.4 写死的值）
const OLD = {
  panelTop: 330, panelH: 150,
  nameTop: 292, nameH: 32, nameFont: 20,
  textLeft: 10, textW: 316, textPad: 6, textTop: 338, textBoxH: 122,
  spW: 143, spH: 380, spTop: 100, spX: [10, 96, 182],
  mbSize: 52, mbTop: 6, mbLeft: 278,
}

const DEVICES = [
  ['手环 9 Pro / 10 Pro', 336, 480],
  ['手环 10 标准版', 212, 520],
  ['手环 9 标准版', 192, 490],
  // 方形表（REDMI Watch 5/6）。设计高只有 400 —— 比参考高度 456 还矮，
  // 是唯一会把设置页「缩小」而不是「放大」的型号。
  ['REDMI Watch 5 / 6', 432, 514],
  // 极端情况：万一某台机器报出来的比例很奇怪
  ['正方假想屏', 400, 400],
  ['极窄假想屏', 150, 600],
]

let bad = 0
const layouts = {}

for (const [name, w, h] of DEVICES) {
  // 走**真实路径**：先认型号再算几何（认不出就是 null，走通用推导）。
  // 不传型号的话测的是兜底路径，和真机上跑的不是同一条 —— 那等于没测。
  const model = detectModel(w, h, '')
  const L = computeLayout(w, h, model)
  layouts[name] = L
  const tm20 = textMetrics(L, 20)
  console.log(`\n${name}  ${w}x${h}`)
  console.log(`  ${describe(L)}`)
  console.log(`  正文: ${tm20.cpl} 字/行 × ${tm20.lpp} 行 = ${tm20.cpl * tm20.lpp} 字/页`)
  console.log(`  立绘 x: ${L.spX.join(' / ')}  最右边缘 ${L.spX[2] + L.spW}`)

  // ---- 硬性检查
  const errs = []
  if (L.panelTop + L.panelH !== L.H) errs.push('底板没贴底')
  if (L.nameTop < L.hudTop + 26) errs.push('说话人顶到 HUD')
  if (L.nameTop + L.nameH > L.panelTop) errs.push('说话人压到底板')
  if (L.spX[2] + L.spW > L.W) errs.push('最右立绘出屏')
  if (L.mbLeft + L.mbSize > L.W) errs.push('菜单按钮出屏')
  if (L.textTop + 1 > L.panelTop + L.panelH) errs.push('正文顶出底板')
  if (tm20.lpp < 1) errs.push('一页放不下 1 行')
  // 正文盒不能捅穿底板
  const textBottom = L.textTop + tm20.lpp * tm20.lineH
  if (textBottom > L.panelTop + L.panelH - 4) errs.push('正文捅穿底板底边')
  // ▼ 不能压到正文
  if (L.H - L.moreBottom < textBottom) errs.push('▼ 压到正文')

  // ---- 主页：面板必须**顶住封面**并铺到屏幕底
  // （面板高度固定的话，标准版上封面和面板之间会空一大片）
  const HOME_GAP = 16
  const HOME_MIN = 240
  // 正常是紧贴封面下方；屏幕矮到装不下 HOME_MIN 时允许往上盖住封面
  if (L.homePanelTop > L.homeArtH + HOME_GAP) {
    errs.push('主页面板顶(' + L.homePanelTop + ') 比封面底(' +
      (L.homeArtH + HOME_GAP) + ') 还低：中间会空出一段')
  }
  if (L.homePanelTop + L.homePanelH !== L.H) errs.push('主页面板没铺到屏幕底')
  if (L.homePanelH < Math.min(HOME_MIN, L.H)) {
    errs.push('主页面板只有 ' + L.homePanelH + '，应至少 ' + Math.min(HOME_MIN, L.H))
  }
  if (L.homeScale < 1) errs.push('主页按钮倍率 < 1（按钮被压小了）：' + L.homeScale)
  // 面板内容（顶距 + 提示行 + 各按钮 + 间距）必须装得进面板，否则最后一行会被切掉。
  // 踩过：竖排 8 行时没扣顶距，标准版上内容 627 > 面板 618，「退出」露半截。
  const hbH = L.homeBtnH
  const hRows = L.homeVertical ? 8 : 4
  const hContent = L.homePadTop + L.homeResumeH + hRows * (hbH + L.homeGap)
  if (hContent > L.homePanelH) {
    errs.push('主页面板内容(' + hContent + ') 装不进面板(' + L.homePanelH +
      ')：最后一行的按钮会被切掉')
  }
  // 竖排时按钮必须够高（不够就该退回横排）
  if (L.homeVertical && hbH < 48) {
    errs.push('主页选了竖排但按钮只有 ' + hbH + ' 高（< 48），应该退回横排')
  }
  // 横排时按钮高必须还是老版式的 40 × 倍率
  if (!L.homeVertical && hbH !== Math.round(40 * L.homeScale)) {
    errs.push('主页横排按钮高 ' + hbH + ' ≠ 40 × ' + L.homeScale.toFixed(2))
  }

  // ---- 设置页：5 行设置项不能互相压，也不能压到提示/预览/按钮
  //
  // 老版式在 H=480 时恰好排满，屏更矮就整体缩小（settScale < 1）——
  // 缩到多小由 layout.js 迭代求解，这里的检查就是给那个求解兜底。
  if (true) {
    for (let i = 1; i < L.stRowTop.length; i++) {
      if (L.stRowTop[i] <= L.stRowTop[i - 1] + 20) {
        errs.push('设置项第 ' + i + ' 行(' + L.stRowTop[i] + ') 和第 ' +
          (i - 1) + ' 行(' + L.stRowTop[i - 1] + ') 挨太近')
      }
    }
    // 最后一个滑块行的正文盒（占 stSldH）不能压到第一行提示
    const sldBottom = L.stRowTop[2] + Math.round(26 * L.settScale) + L.stSldH
    if (sldBottom > L.stHint1) {
      errs.push('设置页滑块底(' + sldBottom + ') 压到提示(' + L.stHint1 + ')')
    }
    // 开关行不能压到提示
    if (L.stRowTop[4] + L.stPillH > L.stHint1) {
      errs.push('设置页开关行底(' + (L.stRowTop[4] + L.stPillH) + ') 压到提示(' + L.stHint1 + ')')
    }
    if (L.stHint2 > L.stPvTop) errs.push('设置页第二行提示压到预览框')
    if (L.stPvTop + L.stPvH > L.stBtnTop) errs.push('设置页预览框压到按钮行')
    if (L.stBtnTop + L.stBtnH > L.H) errs.push('设置页按钮行出屏')
    // 控件不能戳出屏幕右边缘
    if (L.stPlus + L.stStepW > L.W) errs.push('设置页步进按钮出屏')
    if (L.stPillLeft + L.stPillW * 2 + L.stPillGap > L.W) errs.push('设置页开关药丸出屏')
    // 步进按钮不能和左边的标签撞上。最长的标签是「自动播放速度」6 个字，
    // 字号 16 × settFont，从 x=14 开始排。
    const labelRight = 14 + Math.round(16 * L.settFont) * 6
    if (L.stMinus < labelRight + 8) {
      errs.push('设置页步进按钮(' + L.stMinus + ') 会撞上标签（标签右边界约 ' +
        labelRight + '）')
    }
  }

  if (errs.length) { bad++; console.log('  ✖ ' + errs.join('；')) }
  else console.log('  ✔ 布局检查通过')
}

// ---- H=480 必须与老版式一致
// 走的是「命中 Pro 型号」这条路（tune 为空，所以结果 = 纯推导的结果）
console.log('\n=== 与 v2.4 老版式逐项核对（336x480）===')
const L = computeLayout(336, 480, detectModel(336, 480, 'M2311B1'))
let diff = 0
for (const k of Object.keys(OLD)) {
  const a = JSON.stringify(L[k])
  const b = JSON.stringify(OLD[k])
  if (a !== b) { diff++; console.log(`  ✖ ${k}: 新 ${a} != 老 ${b}`) }
}
if (!diff) console.log('  ✔ 全部一致，老版式的观感不会变')
else bad++

// ---- 型号识别
console.log('\n=== 型号识别 ===')
{
  const CASES = [
    // [宽, 高, 型号字符串, 期望的 id]
    [192, 490, 'M2345B1', 'band9'],
    [192, 490, '', 'band9'],
    [212, 520, 'M2459B1', 'band10'],
    [212, 520, '', 'band10'],
    [336, 480, 'M2311B1', 'band9pro'],
    [336, 480, 'M2458B1', 'band10pro'],
    [336, 480, '', 'band9pro'],          // 同尺寸分不出来时取第一台
    [212, 521, '', 'band10'],            // 固件报的尺寸差 1 像素，容差要能兜住
    [191, 489, '', 'band9'],
    [400, 400, 'X', null],               // 不认识的屏 → 走通用推导
    [336, 480, '有些固件给别的串', 'band9pro'],  // 串不认识，退回按尺寸认
  ]
  let mBad = 0
  for (const [w, h, str, want] of CASES) {
    const got = detectModel(w, h, str)
    const id = got ? got.id : null
    if (id !== want) {
      mBad++
      console.log(`  ✖ ${w}x${h} "${str}" -> ${id}，应为 ${want}`)
    }
  }
  if (!mBad) console.log(`  ✔ ${CASES.length} 个用例全部识别正确（含容差与未知设备兜底）`)
  bad += mBad

  // 认不出的屏必须仍能排出合理版面（引擎只有一套：没 tune 也走同一份 computeLayout）
  const unknown = computeLayout(400, 400, null)
  if (!(unknown.panelTop > 0 && unknown.panelTop + unknown.panelH === unknown.H)) {
    bad++
    console.log('  ✖ 未知设备没能排出合理版面')
  } else {
    console.log('  ✔ 未知设备仍按比例排出合理版面（' + describe(unknown) + '）')
  }

  // 每个型号的 tune 都必须能落到版面上：fontBoost 影响字号、homeVertical 影响排法
  for (const m of MODELS) {
    const lm = computeLayout(m.w, m.h, m)
    const fb = m.tune.fontBoost || 1
    if (lm.fontBoost !== fb) {
      bad++; console.log('  ✖ ' + m.id + ' 的 fontBoost 没生效：' + lm.fontBoost + ' != ' + fb)
    }
    // 型号指定了排法就必须听型号的
    if (m.tune.homeVertical !== undefined && lm.homeVertical !== !!m.tune.homeVertical) {
      bad++; console.log('  ✖ ' + m.id + ' 的 homeVertical 没生效')
    }
    // 字号倍率必须同时作用到分页上，否则行会放不下
    const t1 = textMetrics(lm, 20)
    const t2 = textMetrics(computeLayout(m.w, m.h, null), 20)
    if (fb > 1 && t1.cpl >= t2.cpl) {
      bad++
      console.log('  ✖ ' + m.id + ' 的 fontBoost 没作用到分页：' +
        t1.cpl + ' 字/行 vs 未加倍的 ' + t2.cpl)
    }
  }
  if (!bad) console.log('  ✔ 型号微调（fontBoost / homeVertical）都落到了版面和分页上')
}

process.exit(bad ? 1 : 0)
