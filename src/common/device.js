/**
 * 屏幕探测 —— 自适应的第一步
 *
 * 一次构建要跑在不同尺寸的设备上（手环 9/10 标准版 192x490 / 212x520、
 * 9/10 Pro 336x480），所以**屏幕尺寸必须在运行时拿到**，不能写死在 CSS 里。
 *
 * 两条路：
 *   1. global.Env.deviceWidth / deviceHeight —— 同步，读到就能立刻排版
 *      （工具链的 velaTestLibrary.js 里有 global.Env.designWidth / deviceWidth，
 *       说明运行时确实挂了这么个全局对象；但它没有正式文档，所以必须有兜底）
 *   2. @system.device 的 getInfo() —— 官方文档明确有 screenWidth / screenHeight，
 *      但是异步的
 *
 * 策略：先试同步的，拿不到就用异步的；异步回来之前先用一个保守的默认值排版，
 * 拿到真实尺寸后重新算一遍（页面会重渲染）。
 */
import device from '@system.device'

// 保守默认值。取 Pro 的尺寸：它是「宽而矮」的那一档，
// 猜错时内容会往上挤，比猜成窄屏把内容挤出屏幕外安全。
const FALLBACK = { w: 336, h: 480 }

export const screen = {
  w: FALLBACK.w,
  h: FALLBACK.h,
  known: false,   // 是否是探测出来的（不是默认值）
  model: '',      // @system.device 的 model
  product: '',    // @system.device 的 product（有的固件只有这个）
  shape: '',
  dpr: 0,
  logged: false,  // 认型号那行日志只打一次（见 common/geo.js）
}

let probing = false
const waiters = []

/** 屏幕尺寸确定后回调（已经确定过就立刻回调） */
export function onScreenReady(cb) {
  if (screen.known) { cb(screen); return }
  waiters.push(cb)
}

function settle() {
  screen.known = true
  while (waiters.length) {
    const cb = waiters.shift()
    try { cb(screen) } catch (e) { /* 单个回调出错不影响其它 */ }
  }
}

function applySync() {
  try {
    const g = (typeof global !== 'undefined') ? global : null
    const env = g && g.Env
    if (env && env.deviceWidth > 0 && env.deviceHeight > 0) {
      screen.w = env.deviceWidth
      screen.h = env.deviceHeight
      if (env.designWidth) screen.designWidth = env.designWidth
      settle()
      return true
    }
  } catch (e) { /* 没有就往下走 */ }
  return false
}

/**
 * 开始探测。可以重复调用，只会真正探测一次。
 * 拿到尺寸后会调用 onScreenReady 注册的回调。
 */
export function probeScreen() {
  if (screen.known || probing) return
  probing = true

  if (applySync()) return

  // 同步拿不到，走异步
  let done = false
  const finish = (ok) => {
    if (done) return
    done = true
    if (ok) settle()
    else probing = false          // 失败就允许以后再试一次
  }

  try {
    device.getInfo({
      success: (r) => {
        if (r) {
          // 横屏设备上 screenWidth/Height 可能是横过来的，统一成竖屏
          const a = Number(r.screenWidth) || 0
          const b = Number(r.screenHeight) || 0
          if (a > 0 && b > 0) {
            screen.w = Math.min(a, b)
            screen.h = Math.max(a, b)
            screen.dpr = Number(r.screenDensity) || 0
          }
          screen.model = r.model || ''
          // product 是设备代号，有的固件只给这个而不给 model ——
          // 认型号时两个都试（见 common/models.js）
          screen.product = r.product || ''
          screen.shape = r.screenShape || ''
        }
        finish(screen.w > 0 && screen.h > 0 && (screen.w !== FALLBACK.w || screen.h !== FALLBACK.h))
      },
      fail: () => finish(false),
      complete: () => { /* success/fail 里已经处理 */ },
    })
  } catch (e) {
    finish(false)
  }
}
