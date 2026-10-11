// 阅读器公共逻辑：设置项、存档读写
// 手环 9 Pro 只跑单页，这里的函数不做缓存，避免页面销毁后仍被全局引用

import storage from '@system.storage'

// 正文字号可无级调节。剧本里存的是**原始文本**，分页由 game.ux 在运行时按当前
// 字号现算（每行字数 = 正文框宽 / 字号），所以字号能随便调，不会出现折行。
export const SIZE_MIN = 14
export const SIZE_MAX = 30

// 打字机速度：每字毫秒，0 = 整句立即显示
export const SPEED_MIN = 0
export const SPEED_MAX = 120

// 自动播放：每字停留毫秒，0 = 关闭
export const AUTO_MIN = 0
export const AUTO_MAX = 200

export const DEFAULT_SETTINGS = {
  size: 20,       // 正文字号 px
  speed: 28,      // 打字机 每字毫秒
  autoMs: 0,      // 自动播放 每字停留毫秒（0 = 关）
  fast: false,    // 快速播放（瞬间出字 + 连播，遇到选项/结局自动停）
  keepOn: true,   // 阅读时屏幕常亮（走 @system.brightness）
  longpress: true // 长按画面隐藏界面（关掉后长按不再隐藏，用来防误触）
}

export const MAX_SLOTS = 6

function clampInt(v, lo, hi, dflt) {
  const n = Math.round(Number(v))
  if (!isFinite(n)) return dflt
  return Math.max(lo, Math.min(hi, n))
}

export function normalizeSettings(raw) {
  const s = Object.assign({}, DEFAULT_SETTINGS, raw || {})
  s.size = clampInt(s.size, SIZE_MIN, SIZE_MAX, DEFAULT_SETTINGS.size)
  s.speed = clampInt(s.speed, SPEED_MIN, SPEED_MAX, DEFAULT_SETTINGS.speed)
  s.autoMs = clampInt(s.autoMs, AUTO_MIN, AUTO_MAX, DEFAULT_SETTINGS.autoMs)
  s.fast = !!s.fast
  // keepOn / longpress 默认都是 true，所以不能用 !!s.xxx ——
  // 老存档里没有这些键时会被压成 false，行为会跟默认不一致。
  for (const k of ['keepOn', 'longpress']) {
    s[k] = (s[k] === undefined || s[k] === null) ? DEFAULT_SETTINGS[k] : !!s[k]
  }
  // 旧版本存的是 auto(bool) + autoSpeed 三档，这里直接丢掉、走默认
  delete s.auto
  delete s.autoSpeed
  return s
}

// 自动播放停留：基础 700ms + 每字 autoMs，夹在 1.2~12 秒
export function autoDelay(text, autoMs) {
  const n = String(text || '').replace(/\s/g, '').length
  return Math.max(1200, Math.min(12000, Math.round(700 + n * autoMs)))
}

// ---------------------------------------------------------------- 换行与分页
// 正文页和关于页共用这一套。之所以在运行时算而不是构建期切好，
// 是因为设置里字号可以无级调节，切好的行会随字号变化而失效。
// 断行优先落在标点之后，避免标点跑到行首。

const BREAK_AFTER = '，。！？；：、）」』…—'

export function wrapText(text, cpl) {
  const lines = []
  const raws = String(text || '').split('\n')
  for (let i = 0; i < raws.length; i++) {
    let s = raws[i]
    if (s === '') { lines.push(''); continue }
    while (s.length > cpl) {
      let cut = cpl
      const lo = Math.max(2, cpl - 8)
      for (let k = cpl; k > lo; k--) {
        if (BREAK_AFTER.indexOf(s.charAt(k - 1)) >= 0) { cut = k; break }
      }
      lines.push(s.slice(0, cut))
      s = s.slice(cut)
    }
    lines.push(s)
  }
  return lines.length ? lines : ['']
}

export function paginateText(text, cpl, lpp) {
  const lines = wrapText(text, cpl)
  const pages = []
  for (let i = 0; i < lines.length; i += lpp) pages.push(lines.slice(i, i + lpp))
  return pages.length ? pages : [['']]
}

// ---------------------------------------------------------------- storage

export function readJSON(key, fallback, done) {
  storage.get({
    key: key,
    default: '',
    success: (v) => {
      if (!v) return done(fallback)
      try {
        done(JSON.parse(v))
      } catch (e) {
        done(fallback)
      }
    },
    fail: () => done(fallback)
  })
}

export function writeJSON(key, value, done) {
  storage.set({
    key: key,
    value: JSON.stringify(value),
    success: () => { if (done) done(true) },
    fail: () => { if (done) done(false) }
  })
}

export function loadSettings(done) {
  readJSON('settings', null, (v) => done(normalizeSettings(v)))
}

export function saveSettings(s, done) {
  writeJSON('settings', s, done)
}

export function loadSaves(done) {
  readJSON('saves', [], (v) => done(Array.isArray(v) ? v : []))
}

export function saveSaves(list, done) {
  writeJSON('saves', list, done)
}

export function loadAutoSave(done) {
  readJSON('autoSave', null, done)
}

export function saveAutoSave(data, done) {
  writeJSON('autoSave', data, done)
}

// ---------------------------------------------------------------- CG 鉴赏解锁记录
// 存的是「看过的 CG 图片下标」数组，对应原作里的 renpy.seen_image(...)
export function loadSeen(done) {
  readJSON('cgSeen', [], (v) => done(Array.isArray(v) ? v : []))
}

export function saveSeen(list, done) {
  writeJSON('cgSeen', list, done)
}

// ---------------------------------------------------------------- 通关记录
// 只有真结局才算通关；后日谈是通关奖励，通关前不出现在章节选择里
export function loadCleared(done) {
  readJSON('cleared', null, (v) => done(!!(v && v.ok)))
}

export function markCleared(done) {
  writeJSON('cleared', { ok: 1, at: Date.now() }, done)
}
