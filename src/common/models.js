/**
 * 型号登记表 —— 让引擎「认识」设备，而不是只对数字做反应
 *
 * 分工：
 *   layout.js 的比例推导   → 对**任何**屏幕都能排出一个合理的版面（兜底）
 *   本文件的 tune 微调      → 对**已知型号**把版面调到最好（覆盖兜底值）
 *
 * 所以引擎只有一套：认识型号就用调好的，不认识就按比例推，两条路走的是同一份代码。
 *
 * ## 怎么认
 *
 * 两路信息互相印证，因为哪一路都可能拿不到：
 *   1. **屏幕尺寸**（@system.device 的 screenWidth/screenHeight）—— 一定拿得到，
 *      但固件报出来的值可能和官方规格差一两像素，所以带容差匹配。
 *   2. **型号字符串**（model / product）—— 能区分「同样是 336×480 的 9 Pro 和 10 Pro」，
 *      但有些固件返回空串，所以只能当辅助。
 *
 * 匹配顺序：先按尺寸找候选，再用型号字符串在里面挑；字符串对不上就用尺寸唯一确定的那台。
 * 两个 16 Pro 类设备（9 Pro / 10 Pro）屏幕完全相同，靠字符串区分；分不出来时
 * 用哪一台都行（版面一样），只是 About 页显示的名字会不同。
 */

// 尺寸匹配的容差：官方规格与固件上报值可能有 1~2 像素出入
const SIZE_TOL = 3

export const MODELS = [
  {
    id: 'band9',
    label: '小米手环 9',
    short: '手环 9',
    w: 192, h: 490,
    // 型号字符串（小米的型号号 / 产品名）
    patterns: [/M2345/i, /band\s*9\b(?!\s*pro)/i, /smart\s*band\s*9\b(?!\s*pro)/i],
    tune: {
      // 标准版屏只有约 21mm 宽（Pro 是 25mm），同样设计字号的实际物理尺寸更小，
      // 所以整体把字放大一点 —— 这是「按型号调」而不是「按比例推」能做的事。
      fontBoost: 1.15,
      // 屏高足够，主页按钮排成 8 行整行大按钮（老版式挤一行的 5 个小按钮点不上）
      homeVertical: true,
    },
  },
  {
    id: 'band10',
    label: '小米手环 10',
    short: '手环 10',
    w: 212, h: 520,
    patterns: [/M2459/i, /band\s*10\b(?!\s*pro)/i, /smart\s*band\s*10\b(?!\s*pro)/i],
    tune: {
      fontBoost: 1.15,
      homeVertical: true,
    },
  },
  {
    id: 'watch5',
    label: 'REDMI Watch 5',
    short: 'Watch 5',
    // 432x514 的方形屏（2.07"）。设计高 = 336 × 514/432 = 400，
    // 比 Pro 的 480 还矮，所以设置页会整体缩一点（layout.js 里自动求解）。
    w: 432, h: 514,
    patterns: [/redmi\s*watch\s*5/i, /watch\s*5\b/i],
    tune: {
      // 2.07" 屏比 Pro 的 1.74" 大，同样设计字号的实际物理尺寸反而略大，
      // 所以不放大（和 Pro 一样是 1）。这两条靠 tune 表达，不是靠猜。
      fontBoost: 1,
      // 设计高只有 400，面板分不到 8 行的高度，所以主页走横排
      homeVertical: false,
    },
  },
  {
    id: 'watch6',
    label: 'REDMI Watch 6',
    short: 'Watch 6',
    // 面板与 Watch 5 完全相同（同为 432x514），所以版面参数一致，只是名字不同。
    w: 432, h: 514,
    patterns: [/redmi\s*watch\s*6/i, /watch\s*6\b/i],
    tune: {
      fontBoost: 1,
      homeVertical: false,
    },
  },
  {
    id: 'band9pro',
    label: '小米手环 9 Pro',
    short: '手环 9 Pro',
    w: 336, h: 480,
    patterns: [/M2311/i, /band\s*9\s*pro/i],
    // Pro 是参照机型：tune 留空 = 比例推导出来的就是老版式，
    // 所以它必须与 2.4 逐像素一致（tools/test_layout.mjs 会核对）。
    tune: {},
  },
  {
    id: 'band10pro',
    label: '小米手环 10 Pro',
    short: '手环 10 Pro',
    w: 336, h: 480,
    patterns: [/M2458/i, /band\s*10\s*pro/i],
    // 面板与 9 Pro 完全相同，版面参数也一致 —— 只是名字不同。
    tune: {},
  },
]

/** 尺寸是否匹配某个型号（带容差） */
function sizeMatches(m, w, h) {
  return Math.abs(m.w - w) <= SIZE_TOL && Math.abs(m.h - h) <= SIZE_TOL
}

/**
 * 认型号
 * @param {number} w 屏幕宽（物理像素，竖屏）
 * @param {number} h 屏幕高
 * @param {string} str 可选的型号/产品字符串
 * @returns {object|null} 命中的型号条目，认不出返回 null
 */
export function detectModel(w, h, str) {
  const cands = MODELS.filter((m) => sizeMatches(m, w, h))
  if (!cands.length) return null                 // 不认识的屏 → 调用方走通用推导

  if (str) {
    const hit = cands.find((m) => m.patterns.some((re) => re.test(str)))
    if (hit) return hit
  }
  // 字符串没用上（空串或不认识），退回尺寸：
  // 同尺寸有多台时取第一台 —— 它们的面板参数一样，只是显示名不同。
  return cands[0]
}

/** 型号的中文名，认不出就报尺寸，方便在日志/About 页里核对 */
export function describeModel(model, w, h) {
  return model ? model.label : ('未知设备 ' + w + '×' + h)
}
