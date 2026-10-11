/**
 * Yurite —— 跨设备自适应版面引擎
 * ================================================================
 *
 * 这是整套引擎的**公开入口**。名字取自「百合」(yuri) + 「ite」(器件 / 设备)：
 * 让同一份 galgame 代码在任何形状的穿戴屏上都能排出版面。
 *
 * ## 它解决什么
 *
 * 穿戴设备的屏幕形状差异极大：
 *
 *   手环 9/10 Pro    336 × 480   宽而矮   比例 0.70
 *   手环 9/10 标准版 192×490 / 212×520   又窄又长  比例 0.39~0.41
 *   REDMI Watch 5/6  432 × 514   近方形   比例 0.84
 *
 * 靠 `designWidth` 等比缩放**不够**：那只缩得了横向，纵向会留一大片空白或者挤成一团。
 * 所以纵向几何必须运行时算。
 *
 * ## 三层结构
 *
 * ```
 *   devices.js   探测：屏幕多宽多高、什么型号      ← 运行时唯一的外部依赖
 *       ↓
 *   models.js    认型号：认识的用调好的参数，不认识的返回 null
 *       ↓
 *   layout.js    出几何：computeLayout(宽, 高, 型号) → 一整套设计坐标
 *       ↓
 *   geo.js       页面入口：缓存 + 就绪回调
 * ```
 *
 * 页面只跟 `geo.js` 打交道：拿 `currentLayout()` 里的数值拼成内联 style。
 * 脚本和工具可以直接用 `layout.js` / `models.js`（它们不 import 任何运行时模块，
 * 所以 Node 里能直接跑测试）。
 *
 * ## 设计坐标系
 *
 * 宽度固定 336（= manifest 的 designWidth），高度由屏幕比例算：
 *
 *     设计高 H = 336 × 屏幕高 / 屏幕宽
 *
 * 于是同一份代码：Pro 是 336×480、标准版是 336×824/858、REDMI Watch 是 336×400。
 * **横向一份布局就够，纵向才是各型号真正不同的地方。**
 *
 * ## 关键约定
 *
 * - `layout.js` 的比例是照着手环 9 Pro（H=480）的原有版式**反推**出来的，
 *   所以 Pro 上算出来与老版本逐像素一致 —— `tools/test_layout.mjs` 会核对，
 *   改坏任何一条比例都会失败。这是「重构没走样」的硬保证。
 * - 型号的 tune 是**增量**：空的 tune（Pro）就等于纯推导的结果。
 * - 认不出型号也要能跑：走纯推导，只是没有针对该型号的微调。
 *
 * ## 怎么加一个新型号
 *
 *   1. `profiles.json` 加一条档案（屏幕尺寸 + 包信息）
 *   2. `models.js` 加一条型号（尺寸 + 型号字符串 + tune）
 *   3. 出图、构建
 *
 * 布局本身不用动 —— 比例推导会先排出一个合理版面，tune 只用来调得更好。
 */
export { computeLayout, textMetrics, describe, DESIGN_W } from './layout.js'
export { detectModel, describeModel, MODELS } from './models.js'
export { currentLayout, currentModel, currentModelLabel, onLayoutReady, screen }
  from './geo.js'

/** 引擎版本（跟应用版本分开：版面逻辑变了才动它） */
export const YURITE_VERSION = '1.0'
