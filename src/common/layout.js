/**
 * 自适应几何引擎
 *
 * 设计坐标系的宽度固定为 DESIGN_W（= manifest 里的 designWidth），
 * 高度按屏幕实际比例算出来：
 *
 *     设计高 H = DESIGN_W × 屏幕高 / 屏幕宽
 *
 * 于是同一份代码：
 *   手环 9/10 Pro   336×480  ->  H = 480
 *   手环 10 标准版  212×520  ->  H = 824
 *   手环 9 标准版   192×490  ->  H = 858
 * 宽度方向永远是 336，横向布局一份就够；纵向才是各型号真正不同的地方，
 * 所以**所有纵向几何都由这里按 H 算出来**，页面里不要再写死 top。
 *
 * 所有返回值单位都是设计 px（Vela 会按 designWidth 自动缩放到物理像素）。
 */

export const DESIGN_W = 336

// 各值的基准：下面这些比例是照着手环 9 Pro（H=480）原有版式反推出来的，
// 换言之 H=480 时算出来的结果和老版本逐像素一致。
const R = {
  panelRatio: 0.3125,   // 底板高 = H × 0.3125   -> 480 时 150
  panelMin: 150,
  panelMax: 240,        // 标准版按比例会算出 258，太高了，封顶
  nameRatio: 0.21,      // 说话人底板高 = 底板高 × 0.21 -> 150 时 32
  nameGap: 6,
  textInset: 0.187,     // 正文盒高 = 底板高 × (1-0.187) -> 150 时 122
  textTopPad: 0.053,    // 正文顶 = 底板顶 + 底板高 × 0.053 -> 330+8
  spriteH: 380,         // 立绘固定尺寸，不随屏高变（见下）
  spriteW: 143,
  spriteBottom: 0,      // 立绘底部贴屏幕底（会被底板压住一截，这是有意的）
  margin: 10,
  hudTop: 10,
  hudH: 26,
  mbSize: 52,
  mbTop: 6,
  mbRight: 6,
  moreBottom: 18,
  cgTrack: 240,         // CG 查看器的位置指示条轨道宽度
  homeGap: 16,          // 主页封面图与按钮面板之间的间距
  homeMinH: 240,        // 主页面板的最小高度（= 老版式的面板高，也是按钮倍率的基准）
  homeRowsV: 8,         // 竖排时的行数：开始/继续 + 存档/章节/CG/设置/关于 + 退出
  homeMinBtn: 48,       // 按钮低于这个高度就点不准了，竖排必须够得着
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const ri = (v) => Math.round(v)

/**
 * 由屏幕物理尺寸算出整套几何
 * @param {number} sw 屏幕宽（物理像素）
 * @param {number} sh 屏幕高（物理像素）
 */
export function computeLayout(sw, sh, model) {
  const w = Number(sw) > 0 ? Number(sw) : 336
  const h = Number(sh) > 0 ? Number(sh) : 480
  // 型号微调。分工：
  //   本函数的比例推导   → 对**任何**屏幕都能排出合理版面（兜底）
  //   model.tune         → 对**已知型号**把版面调到最好（覆盖兜底值）
  // Pro 的 tune 是空的，所以它走的就是纯推导的结果，与老版式逐像素一致。
  const tune = (model && model.tune) || {}
  // 字号整体倍率：标准版屏只有约 21mm 宽（Pro 是 25mm），
  // 同样的设计字号在标准版上实际更小，所以按型号放大一点。
  // 这是「按型号调」能做、而「按比例推」做不到的事。
  const fb = tune.fontBoost > 0 ? tune.fontBoost : 1

  const W = DESIGN_W
  const H = Math.max(320, ri(W * h / w))

  // ---- 对话底板（纵向几何的锚点，其余都挂在它上面）
  const panelH = clamp(ri(H * R.panelRatio), R.panelMin, R.panelMax)
  const panelTop = H - panelH

  const nameH = clamp(ri(panelH * R.nameRatio), 28, 48)
  const nameTop = panelTop - nameH - R.nameGap
  const nameFont = clamp(ri(panelH * 0.133 * fb), 18, 30)

  const textTop = panelTop + ri(panelH * R.textTopPad)
  const textLeft = 10
  const textW = W - textLeft * 2                    // 316
  const textPad = 6
  const textBoxH = panelH - ri(panelH * R.textInset)

  // ---- 立绘
  // 固定尺寸，不跟着 H 放大：设计宽只有 336，三张立绘本来就靠重叠才排得下，
  // 再放大会互相盖住。屏高多出来的部分就让背景露着，VN 里这是正常构图。
  let spW = R.spriteW
  let spH = R.spriteH
  let spTop = H - R.spriteBottom - spH
  // 矮屏（设计高比立绘还矮）时按剩余空间整体缩小，别让立绘捅出屏幕顶部
  const spMinTop = R.hudTop + R.hudH + 8
  if (spTop < spMinTop) {
    const avail = H - R.spriteBottom - spMinTop
    if (avail > 60) {
      const k = avail / R.spriteH
      spH = ri(R.spriteH * k)
      spW = ri(R.spriteW * k)
      spTop = H - R.spriteBottom - spH
    } else {
      spTop = spMinTop
    }
  }
  const step = Math.floor((W - spW - R.margin * 2) / 2)
  const spX = [R.margin, R.margin + step, R.margin + step * 2]

  // ---- CG 宽图
  // 素材是 16:9 的宽图，高 = 屏幕高，宽 = ceil(h × 16/9)（物理像素，由 gen_assets.py 出）。
  // 换算到设计坐标要乘 W/w。用 ceil 是为了和出图脚本一致 ——
  // 老的 854 正是 ceil(480×16/9)，不是 round(853.33)。
  const cgW = Math.round(W * Math.ceil(h * 16 / 9) / w)
  // 可拖动的横向范围：图比屏幕宽出来的部分
  const cgRange = Math.max(0, cgW - W)
  // 位置指示条的滑块宽度 = 屏幕宽 / 图宽 × 轨道宽
  const trackW = Math.round(R.cgTrack * W / cgW)

  // ---- 顶部
  const hudTop = R.hudTop
  const hudH = R.hudH
  const mbSize = R.mbSize
  const mbTop = R.mbTop
  const mbLeft = W - mbSize - R.mbRight

  // ---- 主页
  // 主页只有两块：上面是封面图（按宽度完整铺下，3:2），下面是按钮面板。
  //
  // **面板顶 = 封面底 + 间距，面板一直铺到屏幕底** —— 也就是让面板"顶住"封面，
  // 中间不留空。屏越高面板就越高，按钮跟着等比放大（顺便更好点）。
  //
  // 这样算出来在 Pro 上正好是 240：封面高 336/1.5 = 224，加 16 间距 = 240，
  // 与老版式的 .panel { top: 240px } 一致，所以 Pro 的观感不变。
  const homeArtH = Math.round(W / 1.5)
  // 正常情况下面板顶 = 封面底 + 间距，也就是紧贴封面下方。
  // 但屏幕矮到装不下 240 的面板时（比如某些方形屏，设计高只有 336），
  // 就让面板**往上盖住一部分封面**，而不是把按钮压小 —— 按钮太小没法点。
  const homePanelTop = Math.min(homeArtH + R.homeGap, Math.max(0, H - R.homeMinH))
  const homePanelH = Math.max(0, H - homePanelTop)
  // 按钮与间距的放大倍数。基准 240 就是老版式下面板的高度，
  // 所以 Pro（设计高 480、面板 240）算出来是 1.00，老版式一点不变。
  const homeScale = homePanelH > 0 ? homePanelH / R.homeMinH : 1
  // 字号不跟着等比放，否则会大得离谱；开平方缓一缓
  const homeFontScale = Math.sqrt(homeScale) * fb

  // ---- 主页按钮是横排还是竖排
  // 老版式把「存档 章节 CG 设置 关于」5 个挤在一行 —— 在 Pro 上还行，
  // 但标准版屏只有 21mm 宽，每个小按钮才 2.9mm，根本点不上。
  // 所以屏高够的时候改成**8 个按钮各占一行**（3 个主按钮 + 5 个原来挤一行的 + 退出）。
  //
  // 判据：先按竖排算一下每个按钮能分到多高，够得着「能点」的下限就竖排，
  // 否则退回横排。Pro 上竖排只有 18 高（远低于下限），所以自动退回横排，老版式不变。
  const hGap = Math.round(8 * Math.min(homeScale, 1.5))
  const hResume = Math.round(28 * homeFontScale)
  // 面板的顶距也要从可用高度里扣掉，否则算出来的按钮高会正好把最后一行顶出面板
  // （踩过：标准版上 8 行 + 顶距 = 627 > 面板 618，「退出」被切掉半截）
  const hPadTop = Math.round(12 * Math.max(1, homeScale))
  const hBtnV = Math.floor(
    (homePanelH - hResume - R.homeRowsV * hGap - hPadTop) / R.homeRowsV)
  // 型号明确指定了就听型号的（标准版屏高足够，直接竖排）；
  // 没指定就按「竖排时按钮够不够高」判（Pro 会因此退回横排）。
  const homeVertical = (tune.homeVertical !== undefined)
    ? !!tune.homeVertical
    : hBtnV >= R.homeMinBtn
  // 竖排：按钮高按剩余空间分。横排：沿用老版式的 40 × 倍数（Pro 时正好 40）。
  const homeBtnH = homeVertical ? hBtnV : Math.round(40 * homeScale)

  // ---- 设置页
  // 版面：标题贴顶、按钮贴底，中间那块（5 行设置 + 2 行提示 + 预览框）按剩余高度放大。
  //
  // 参考高度取老版式在 H=480 下的「从标题到按钮底」= 456，所以 Pro 上 settScale = 1.00，
  // 每个位置都是老版式的原值。
  //
  // 三种倍数分开，因为各种元素能承受的放大程度不一样：
  //   settScale  行距与纵向尺寸（可以放得比较开）
  //   settFont   字号（开平方缓一缓，否则大得离谱）
  //   settCtrl   控件尺寸（宽高都受屏幕宽度限制，封顶 1.5）
  //
  // 屏矮于参考高度时（比如 Redmi Watch 5/6 的设计高只有 400）要**整体缩小**，
  // 不能用 max(1, ...) 硬撑 —— 那样滑块/开关会和提示、预览框叠在一起。
  // 老版式在 H=480 时恰好装得下，所以 Pro 上仍然是 1.00。
  const settFit = (sc) => {
    const font = Math.min(Math.sqrt(sc) * fb, 1.25)
    const ctrl = Math.min(sc, 1.5)
    const lastRowBottom = 34 + Math.round(228 * sc) + ri(30 * ctrl)
    const btnTop = H - ri(20 * ctrl) - ri(40 * ctrl)
    const pvTop = btnTop - ri(6 * sc) - ri(88 * sc)
    const hint1 = pvTop - ri(16 * font) - ri(14 * font)
    // 最后一行开关的底边不能压到第一行提示；预览框和按钮也要留在屏内
    return lastRowBottom <= hint1 && pvTop > 60 && btnTop > 120
  }
  let settScale = Math.max(0.5, (H - 24) / 456)
  for (let i = 0; i < 40 && !settFit(settScale); i++) settScale -= 0.01
  settScale = Math.max(0.5, settScale)
  // 字号封顶 1.25：再大「自动播放速度」这 6 个字的标签就会和左边的步进按钮撞上
  // （最长的标签 6 字 + 步进按钮 + 数值 + 步进按钮，横向就 336 宽，横向是没法放大的）。
  //
  // 注意是**乘完型号倍率之后**再封顶：标准版上 sqrt(1.75)=1.32 本身就顶到上限了，
  // 再乘 1.15 只会把标签撑宽、把步进按钮挤进标签里（自检在真实路径上抓到过这个）。
  // 也就是说设置页的字号受横向硬约束、型号倍率在这一页不起作用 —— 这是对的，
  // 这一页靠放大**控件**（settCtrl）来解决难点，那才是难点所在。
  const settFont = Math.min(Math.sqrt(settScale) * fb, 1.25)
  const settCtrl = Math.min(settScale, 1.5)

  const stStepW = ri(32 * settCtrl)
  const stStepH = ri(28 * settCtrl)
  const stValW = ri(50 * settFont)
  const stRightMargin = 18
  const stPlus = W - stRightMargin - stStepW
  const stVal = stPlus - 4 - stValW
  const stMinus = stVal - 4 - stStepW

  const stSldH = ri(32 * settCtrl)
  const stPillW = ri(44 * settCtrl)
  const stPillH = ri(30 * settCtrl)
  const stPillGap = ri(6 * settCtrl)
  // 开关那两个药丸靠右排，左边界由「两个药丸 + 间距」反推，别让它们戳出屏幕
  const stPillLeft = W - 12 - (stPillW * 2 + stPillGap)

  const stBtnH = ri(40 * settCtrl)
  const stBtnBottom = ri(20 * settCtrl)
  const stBtnW = Math.min(W - 48, ri(236 * settCtrl))
  const stBtnTop = H - stBtnBottom - stBtnH
  const stPvH = ri(88 * settScale)
  const stPvTop = stBtnTop - ri(6 * settScale) - stPvH
  const stHint2 = stPvTop - ri(16 * settFont)
  const stHint1 = stHint2 - ri(14 * settFont)

  // 5 行的纵向位置：把老版式的 rowStep 按 settScale 拉开
  // （老版式：34 / 98 / 162 是三个滑块，228 / 262 是两个开关）
  const SETT_ROW0 = 34
  const stRowStep = [0, 64, 128, 194, 228]
  const stRowTop = stRowStep.map((d) => SETT_ROW0 + Math.round(d * settScale))

  return {
    W, H, panelH, panelTop,
    nameH, nameTop, nameFont,
    textLeft, textW, textPad, textTop, textBoxH,
    spW, spH, spTop, spX, step,
    hudTop, hudH, hudFont: ri(17 * fb), hudSubFont: ri(15 * fb),
    mbSize, mbTop, mbLeft, mbIcon: ri(mbSize * 0.577 * fb),
    moreBottom: R.moreBottom,
    moreLeft: W - 28,
    cgW, cgRange, cgTrackW: trackW,
    cgTrackLeft: Math.round((W - R.cgTrack) / 2),
    homeArtH, homePanelTop, homePanelH, homeScale, homeFontScale,
    homeVertical, homeBtnH, homeGap: hGap, homeResumeH: hResume, homePadTop: hPadTop,
    fontBoost: fb, model: model ? model.id : '', modelLabel: model ? model.label : '',
    settScale, settFont, settCtrl,
    stStepW, stStepH, stValW, stMinus, stVal, stPlus,
    stSldH, stPillW, stPillH, stPillGap, stPillLeft,
    stBtnH, stBtnW, stBtnTop, stBtnBottom,
    stPvH, stPvTop, stHint1, stHint2, stRowTop,
  }
}

/**
 * 正文分页参数：CPL（每行字数）与 LPP（每页行数）
 * 字号变了这两个都要跟着变，所以单独一个函数。
 */
export function textMetrics(lay, size) {
  // 字号要乘上型号倍率 —— 否则标准版上「设置里选 20」实际渲染是 23，
  // 分页却按 20 算，行会放不下、字会被裁掉。
  const raw = Number(size) > 0 ? Number(size) : 20
  const s = Math.round(raw * ((lay && lay.fontBoost) || 1))
  const cpl = Math.max(6, Math.floor((lay.textW - lay.textPad) / s))
  const lpp = clamp(Math.floor(lay.textBoxH / (s + 4)), 1, 8)
  return { cpl, lpp, lineH: s + 4 }
}

/** 把几何对象拼成可读的一行，方便在真机日志里核对 */
export function describe(lay) {
  return 'design ' + lay.W + 'x' + lay.H +
    ' panel ' + lay.panelTop + '+' + lay.panelH +
    ' name ' + lay.nameTop +
    ' text ' + lay.textTop + '+' + lay.textBoxH +
    ' sprite ' + lay.spW + 'x' + lay.spH + '@' + lay.spTop
}
