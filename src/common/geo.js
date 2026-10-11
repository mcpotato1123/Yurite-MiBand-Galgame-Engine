/**
 * 页面取几何的唯一入口
 *
 * layout.js 是纯函数（不 import 任何运行时模块），这样 Node 里能直接跑测试；
 * 把「屏幕探测」「认型号」「算几何」「缓存」串起来放在这里。
 *
 * 引擎只有一套：
 *   认识的型号 → 用该型号调好的参数
 *   不认识的设备 → 按屏幕比例推导（走同一份 computeLayout，只是没有 tune）
 *
 * 用法：
 *   import { currentLayout, currentModel, onLayoutReady } from '../../common/geo.js'
 *   protected: { lay: currentLayout(), ... }
 *   onInit() {
 *     onLayoutReady(() => { this.lay = currentLayout(); this.applyGeometry() })
 *   }
 */
import { computeLayout } from './layout.js'
import { detectModel, describeModel } from './models.js'
import { screen, probeScreen, onScreenReady } from './device.js'

let cached = null
let cachedModel = null
let cachedKey = ''

function rebuild() {
  // 型号字符串优先用 model，其次 product —— 有的固件只有其中一个
  const idStr = screen.model || screen.product || ''
  cachedModel = detectModel(screen.w, screen.h, idStr)
  cached = computeLayout(screen.w, screen.h, cachedModel)
  cachedKey = screen.w + 'x' + screen.h + '|' + idStr
  if (!screen.logged) {
    screen.logged = true
    console.log('[Yurite] 屏幕 ' + screen.w + '×' + screen.h +
      '  型号字符串="' + idStr + '"' +
      '  → ' + describeModel(cachedModel, screen.w, screen.h) +
      '（fontBoost ' + cached.fontBoost + '，设计高 ' + cached.H + '）')
  }
}

/** 当前的几何。屏幕尺寸/型号变了会重算。同步可用。 */
export function currentLayout() {
  const idStr = screen.model || screen.product || ''
  const key = screen.w + 'x' + screen.h + '|' + idStr
  if (!cached || cachedKey !== key) rebuild()
  return cached
}

/** 当前认出来的型号（可能为 null = 不认识的设备，走通用推导） */
export function currentModel() {
  currentLayout()
  return cachedModel
}

/** 型号的中文名，给 About 页显示用 */
export function currentModelLabel() {
  return describeModel(currentModel(), screen.w, screen.h)
}

/**
 * 屏幕尺寸就绪后回调。如果已经就绪会立刻回调一次。
 * 页面在 onInit 里调它，拿到真实尺寸后重算几何并刷新样式。
 */
export function onLayoutReady(cb) {
  probeScreen()
  onScreenReady(() => {
    cached = null          // 让 currentLayout 重算（含重新认型号）
    cb(currentLayout())
  })
}

export { screen }
