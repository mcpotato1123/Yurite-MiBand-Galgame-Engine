# Yurite · 手环 Galgame 引擎

一份代码，在各种形状的穿戴屏上跑 galgame。

**只含引擎**：版面引擎、阅读器、存档、CG 鉴赏、章节跳转、设备型号表、构建工具链。
**不含任何美术与剧本** —— 仓库里的图是程序生成的纯色占位图、剧本是占位文本，
所以 clone 下来不装任何资源就能直接构建、直接跑。把你的内容接进来见
[移植教程](#移植教程)。

> 引擎名 **Yurite**（yuri + ite）。公开入口是 `src/common/yurite.js`，那份文件也是设计说明。

---

## 它解决什么问题

穿戴设备的屏幕形状差得太远：

| 设备 | 分辨率 | 比例 |
|---|---|---|
| 小米手环 9 / 10 标准版 | 192×490 / 212×520 | 0.39 ~ 0.41（又窄又长） |
| 小米手环 9 Pro / 10 Pro | 336×480 | 0.70（宽而矮） |
| REDMI Watch 5 / 6 | 432×514 | 0.84（近方形） |

靠 `designWidth` 等比缩放**不够** —— 那只缩得了横向，纵向会留一大片空白或者挤成一团。
所以纵向几何必须**运行时算**。

## 主要原理

### 一、设计坐标系：宽固定，高按比例算

`manifest.json` 里 `designWidth` 固定 **336**，设计高度由屏幕比例推出来：

```
设计高 H = 336 × 屏幕高 / 屏幕宽
```

于是同一份代码在不同设备上拿到不同的设计空间：

| 设备 | 设计空间 |
|---|---|
| 手环 9 Pro / 10 Pro | 336 × 480 |
| 手环 10 标准版 | 336 × 824 |
| 手环 9 标准版 | 336 × 858 |
| REDMI Watch 5 / 6 | 336 × 400 |

**横向一份布局就够，纵向才是各型号真正不同的地方。** 所有纵向数值都由 `H` 算出来，
页面通过内联 `style="{{...}}"` 绑定（Vela 的 CSS 是静态的，只有内联样式能带运行时值）。

### 二、四层结构

```
device.js   探测：屏幕多宽多高、型号字符串      ← 运行时唯一的外部依赖
    ↓
models.js   认型号：认识的用它调好的参数，不认识的返回 null
    ↓
layout.js   出几何：computeLayout(宽, 高, 型号) → 一整套设计坐标（纯函数）
    ↓
geo.js      页面入口：缓存 + 就绪回调
```

页面只跟 `geo.js` 打交道。`layout.js` / `models.js` **不 import 任何运行时模块**，
所以 Node 里能直接跑测试（`tools/test_layout.mjs`）。

### 三、两层推导：先通用，再按型号微调

```
computeLayout(屏幕宽, 屏幕高, 型号)
  1. 按 layout.js 的比例**通用推导**   → 兜底，任何屏幕都能排
  2. 命中型号就用它的 tune **覆盖**    → 把版面调到该型号最好
```

比例不是拍脑袋定的：它们是照着手环 9 Pro 的既有版式**反推**出来的，
所以 `computeLayout(336, 480, 9Pro)` 与老版本逐像素一致 —— `tools/test_layout.mjs`
会核对这件事，改坏任何一条比例都会失败。这是「重构没走样」的硬保证。

`tune` 是**增量**：空的 tune（Pro）就等于纯推导的结果。目前支持：

| tune 项 | 作用 |
|---|---|
| `fontBoost` | 字号整体倍率。标准版屏只有约 21mm 宽（Pro 是 25mm），同样的设计字号实际更小 |
| `homeVertical` | 主页按钮竖排（整行大按钮）还是横排（一行小按钮） |

### 四、认型号：两路信息互相印证

因为**哪一路都可能拿不到**：

1. **屏幕尺寸**（`@system.device`）—— 一定拿得到，但固件上报值可能和官方规格差一两像素
   → 带 **±3 像素容差**
2. **型号字符串**（`model` / `product`）—— 能区分「同样是 336×480 的 9 Pro 和 10 Pro」，
   但有些固件返回空串 → 只能当辅助

先按尺寸找候选，再用型号字符串在里面挑。**认不出就返回 `null`，退回纯比例推导 —— 照样能跑**，
只是没有针对该型号的微调。这就是「一份代码适配所有设备」的保证。

启动时会打一行日志，出问题先看它：

```
[Yurite] 屏幕 212×520  型号字符串="M2459B1"  → 小米手环 10（fontBoost 1.15，设计高 824）
```

### 五、踩过的坑（都写进代码注释了）

Vela 这套东西有些行为和常见前端不一样，踩过一次就别再踩：

- **`<image>` 给了宽高必须配 `object-fit`**，否则按原始像素画
- **比屏幕宽的子元素会让页面变成可横向滚动** → 必须有明确的裁切容器
- **`swiper` / `list` 必须给明确宽高**，否则不渲染
- **`list` 要放在页面根节点的直接子级**，包在别的 `div` 里会导致整页渲染不出来
- **不要给带子元素的容器加 `opacity`**，会渲染出条纹
- **JS 对象字面量里重名的方法不报错**，后者静默覆盖前者 —— `tools/check_dup.py` 专治这个，
  我已经因为它在 `onHide` 上踩过一次（「离开阅读页关常亮」整段变成死代码）
- **`@system.device` 必须在 `manifest.features` 里声明**，否则 aiot 直接拒绝构建
- 触摸坐标要逐个试 `clientX → pageX → x → offsetX`，并**试 `changedTouches`** ——
  `touchend` 时 `touches` 是空的

---

## 支持的设备

屏幕尺寸取自小米官方规格页，**竖屏物理像素**：

| 型号 | 分辨率 | 设计空间 | 档案 |
|---|---|---|---|
| 小米手环 9 | 192 × 490 | 336 × 858 | `std` |
| 小米手环 10 | 212 × 520 | 336 × 824 | `std` |
| 小米手环 9 Pro | 336 × 480 | 336 × 480 | `pro` |
| 小米手环 10 Pro | 336 × 480 | 336 × 480 | `pro` |
| REDMI Watch 5 | 432 × 514 | 336 × 400 | `watch` |
| REDMI Watch 6 | 432 × 514 | 336 × 400 | `watch` |

**六个型号、三个包**：同面板的型号共用一个包（标准版按较大的 212×520 出图，
192×490 靠 `object-fit` 缩放，只差 5%）。

---

## 快速开始

```bash
# 1. 生成占位内容（纯色图 + 占位剧本），不装任何美术资源也能跑
python tools/gen_demo.py .

# 2. 布局自检（几何引擎的正确性全靠它）
node tools/test_layout.mjs

# 3. 构建
node tools/build.js --profile pro debug      # 手环 9/10 Pro
node tools/build.js --profile std debug      # 手环 9/10 标准版
node tools/build.js --profile watch debug    # REDMI Watch 5/6
```

产物在 `dist/`，文件名形如 `com.yurite.demo.pro.debug.1.0.rpk`。

> `img/` 一次只放得下一个档案的图。构建前会核对「现在这套图是不是这个档案的」，
> 对不上直接拒绝构建 —— 免得打出「包名是 std、图是 pro」的包。
> 要连图一起出，加 `--assets`。

在 AIoT-IDE 里的话：直接打开本目录，点构建。IDE 认工程靠 `package.json` +
`src/manifest.json` + `src/app.ux` 三样。

---

## 移植教程

### 第 0 步：先搞清楚你原来是什么

本引擎的剧本格式是从 **Ren'Py** 工程抽出来的（每条 `say` / `scene` / `show` / `menu` 一个节点）。
如果你的原作不是 Ren'Py，第 1 步要自己写个转换脚本，但**数据结构照抄下面即可**。

### 第 1 步：剧本

剧情放在 `src/common/story/`，切成若干分块 + 一份索引。

**索引 `index.txt`**（JSON）：

```json
{
  "ver": 1,
  "title": "你的标题",
  "nodeCount": 5569,
  "chunkSize": 128,
  "entry": 0,
  "chapters": [ { "id": "1_1", "title": "第一幕 · 月幕", "start": 0 } ],
  "chunks":   [ { "file": "/common/story/chunk-000.txt", "start": 0, "count": 128 } ]
}
```

**分块 `chunk-000.txt`**：一个 JSON 数组，每个元素是一个节点。节点类型：

| `t` | 含义 | 字段 |
|---|---|---|
| `s` | 一句台词 / 旁白 | `n` 说话人（空串=旁白）、`x` 正文、`bg` 背景号、`cs` 立绘、`cg` CG号、`tint` 色调 |
| `o` | 选项 | `x` 提示、`o` 选项数组（每项 `{t: 文本, j: 跳转节点}`） |
| `j` | 无条件跳转 | `j` 目标节点 |
| `cj` | 条件跳转 | `v` 标志名、`op` 比较符、`n` 值、`j` 目标 |
| `f` | 标志自增 | `v` 名、`n` 增量 |
| `sf` | 标志赋值 | `v` 名、`n` 值 |
| `e` | 结局 | `x` 结局文本 |

两个**语义上很容易搞错**的地方：

- **`bg` 相当于 Ren'Py 的 `scene`，会清空所有立绘。** 如果换景时还想有人，
  那一步要**同时带 `cs`**。只把 `bg` 当「换背景」的话，会出现「本该没人的界面站着上一位」。
- **`j`（跳转）不清立绘** —— Ren'Py 的 `jump` 本来就不换景，同场景内跳转应当保持。

**`cs` 是立绘数组**，每项 `{k: 角色键, i: 图片号, s: 槽位}`，槽位取 `left` / `c` / `right`。
**空数组 `[]` 表示清空**。

### 第 2 步：图片

尺寸公式（`tools/build.js` 的预检按这个核对，对不上会拒绝构建）：

设 `k = 屏宽 / 336`：

| 用途 | 尺寸 |
|---|---|
| 背景 `img/b/` | `(2×屏宽) × 屏高` —— 宽一倍是给全景平移留余量 |
| CG `img/c/` | `ceil(屏高 × 16 / 9) × 屏高` ← **是 ceil 不是 round** |
| 立绘 `img/s/` | `round(143k) × round(380k)` |
| CG 缩略 `img/t/` | `round(96k) × round(54k)` |
| 主页画 `home.png` | `屏宽 × 屏高` |
| 图标 `icon.png` | **固定 192×192** |

> `icon.png` 是启动器图标、规格固定，**不要跟着屏幕缩放**。
> 踩过：早期版本按 `round(192k)` 出图，在 REDMI Watch 上算出 247×247，
> 超规格的图标让安装器崩掉，真机上表现成「装完重启」。

`tools/gen_demo.py` 就是按这些公式生成占位图的，可以照它改。

### 第 3 步：索引表

`src/common/assets.js`：图片路径表，**下标就是剧本节点里的资源号**。

```js
export const IMG = ["/common/img/b/b0.png", "/common/img/c/c0.png", ...]
export const BG = { "b0": 0, "b1": 1 }        // 背景名 -> 下标
export const SP = { "s0|c": 2, "s0|left": 2 } // 立绘名|槽位 -> 下标
```

`src/common/cglist.js`：CG 鉴赏的分组。

```js
export const CGG = [
  { n: "组名", th: "/common/img/t/g0.png", u: 108, im: [108, 109] }  // u = 解锁条件，im = 该组图片号
]
```

### 第 4 步：改品牌与包名

- `src/manifest.json` 的 `package` / `name` / `versionName` / `versionCode`
- `src/pages/about/about.ux` 里的 `APP_VER` **必须和 `versionName` 一致**，否则构建会拒绝
- `profiles.json` 里三个档案的 `package` / 版本号

### 第 5 步：加一个你自己的型号

只动两处，**布局本身不用改**：

1. `profiles.json` 加一条档案（屏幕尺寸 + 包信息）
2. `src/common/models.js` 加一条型号（尺寸 + 型号字符串正则 + `tune`）

比例推导会先排出一个合理版面，`tune` 只用来调得更好。

---

## 目录结构

```
src/
  app.ux                    应用入口
  manifest.json             快应用清单（designWidth 固定 336）
  common/
    yurite.js               引擎公开入口 + 设计说明
    layout.js               几何引擎（纯函数，Node 里可直接测）
    models.js               设备型号表
    device.js               屏幕探测
    geo.js                  页面入口：缓存 + 就绪回调
    reader.js               正文分页 / 打字机 / 设置项定义
    assets.js               图片索引表（自动生成）
    cglist.js               CG 分组表（自动生成）
    story/                  剧本（index.txt + chunk-*.txt）
    img/                    素材（b 背景 / s 立绘 / c CG / t 缩略）
  pages/
    index/                  主页
    game/                   阅读页（引擎主体）
    saves/                  存档
    chapters/               章节跳转
    cg/                     CG 鉴赏
    settings/               设置
    about/                  关于
tools/
  gen_demo.py               生成占位内容
  build.js                  构建（档案切换、素材预检、签名检查）
  test_layout.mjs           几何自检（多设备 + 型号识别 + 与老版式逐像素比对）
  dump_layout.mjs           导出各型号版面数据（给预览图用）
  check_dup.py              查对象字面量重名（静默覆盖，编译期查不出来）
profiles.json               设备档案（尺寸 / 包名 / 版本）
```

## 已知限制

- **设置页内容在 H < 456 的屏上要靠整体缩小才装得下**（`layout.js` 里迭代求解，
  REDMI Watch 的 H=400 就走到这条路径）—— 控件会小一圈，但不会溢出
- **REDMI Watch 上主页封面与按钮面板会重叠**：设计坐标里 `224 + 240 = 464 > 400`，
  空间本身不够；面板是半透明的，看起来是「压住下半身」，和游戏里立绘被底板压住是同一套视觉语言
- `swiper` 在真机上不可靠，全景平移是用定时器小步改 `left` 做的

## 许可

MIT，见 [LICENSE](LICENSE)。
