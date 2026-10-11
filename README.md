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
#    img/ 一次只放得下一个档案的图，所以出图要指定档案
python tools/gen_demo.py . --profile pro      # 或 std / watch

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

从零到装进手表，一步一步来。**每一步都有可照抄的例子。**

### 第 0 步：准备

```bash
git clone <这个仓库>
cd Yurite
npm install                       # 装 aiot-toolkit
python tools/gen_demo.py . --profile pro   # 先出一套占位内容，确认工具链是通的
node tools/build.js --profile pro debug    # 能出包就说明环境没问题
```

跑通之后再动自己的内容。**别跳过这一步** —— 后面出错时你才能确定是自己的数据问题，
不是环境问题。

---

### 第 1 步：从原作里拿到素材和剧本

原作是 Ren'Py 的话，游戏目录里通常有：

```
game/
  script.rpy / script.rpyc     剧本（.rpyc 是编译过的，要反编译）
  images/                      图片
  *.rpa                        打包的资源（要解包）
```

**解包资源**（文件在 `*.rpa` 里）：

```bash
pip install rpatool
rpatool -x game/archive.rpa -o unpacked/
```

**反编译剧本**（`.rpyc` → `.rpy`）：

```bash
pip install unrpyc
python -m unrpyc game/script.rpyc
```

拿到 `.rpy` 之后，你要的东西是这几类语句：

| Ren'Py | 含义 |
|---|---|
| `scene bg_xxx` | 换背景，**并清空全部立绘** |
| `show xxx at center` | 显示立绘（`left` / `center` / `right` 是位置） |
| `hide xxx` | 收起立绘 |
| `menu:` + `"选项"` | 选项分支 |
| `jump label` / `label xxx:` | 跳转与标签 |
| `$ flag += 1` / `if flag >= n` | 变量与条件 |
| `"台词"` / `角色 "台词"` | 一句台词 |

#### 原作是 Unity 的话

Unity 游戏没有 `.rpa`／`.rpy`，是另一套结构。先看游戏目录：

```
GameName.exe
GameName_Data/
  level0                    场景与部分资源
  resources.assets          资源主包
  sharedassets0.assets      按场景分的资源
  StreamingAssets/          通常是明文（JSON / XML / 文本）
  Managed/                  编译后的 C# 程序集（Assembly-CSharp.dll）
GameName_Data/StreamingAssets/AssetBundles/   有些游戏把资源另打成 bundle
```

**脚本和文本优先翻 `StreamingAssets/`** —— 那里大多是明文。
很多对话系统（Ink、Yarn Spinner、Naninovel）把剧本存成 JSON／txt，直接就能读。

**其余资源用工具解包**：

| 工具 | 形态 | 适合 |
|---|---|---|
| [AssetRipper](https://github.com/AssetRipper/AssetRipper) | GUI | **首选**。支持版本最广，能直接导出图片并把 MonoBehaviour 转成可读的 JSON |
| [AssetStudio](https://github.com/Perfare/AssetStudio) | GUI | 快速浏览、批量导出贴图 |
| [UnityPy](https://github.com/K0lb3/UnityPy) | Python 库 | 要**写脚本批量处理**时用它（下面有例子）|

用 AssetRipper 的话基本是「拖进游戏目录 → Export → 得到 `ExportedProject/`」，
里面 `Assets/` 是图片和文本，`Assets/Scripts/` 是反编译出来的 C# —— **剧本常常在这里**。

**找剧本的三个地方**，按可能性排序：

1. `StreamingAssets/` 里的明文文件
2. AssetRipper 导出的 TextAsset（`.txt` / `.json` / `.bytes`）
3. **MonoBehaviour**（对话系统的自定义组件）—— 用 AssetRipper 导出成 JSON 看字段名，
   里面通常是「说话人 / 正文 / 下一条」这样的结构

**用 UnityPy 自己抓 MonoBehaviour**（当 AssetRipper 的导出不够用时）：

```python
import UnityPy

env = UnityPy.load("GameName_Data")          # 传整个 _Data 目录

for obj in env.objects:
    if obj.type.name == "MonoBehaviour":
        tree = obj.read_typetree()           # 转成 dict
        # 按字段猜是不是剧本：有 text / content / dialogue 之类就打印看看
        if any(k in tree for k in ("text", "content", "dialogue", "lines")):
            print(tree)
```

拿到台词之后再套前面那张对照表，转成 Yurite 的节点就行。

**贴图**：Unity 的图在 `Texture2D` 里，而且**常被 Sprite Atlas 打成图集**
（一张大图 + 每张小图的坐标）。导出时要：

- 普通贴图：直接导成 PNG
- **图集**：先导出大图，再按 sprite 的 `rect` 裁成一张张小图（AssetStudio 勾
  "Export → Sprite" 会自动裁；UnityPy 里读 `Sprite` 对象的 `m_Rect` 自己裁）

导出后统一转成引擎要的尺寸（见第 3 步的公式）。

> ⚠️ **权利提醒**：上面这些工具是正当的技术手段，但**解包出来的是别人的作品**。
> 移植前先确认你有权这么做 —— 自己的作品、已获授权、或者原作许可允许的范围。
> 本引擎只提供技术，不附带任何素材。


---

### 第 2 步：把剧本转成节点

**目标格式**：`src/common/story/chunk-NNN.txt`，每个文件是一个 **JSON 数组**，一个元素一个节点。

#### 逐条对照表

| 你的原作 | 转成 |
|---|---|
| 旁白 `"这是一句旁白。"` | `{"t":"s","n":"","x":"这是一句旁白。"}` |
| 台词 `角色 "你来啦"` | `{"t":"s","n":"角色","x":"你来啦"}` |
| `scene bg_classroom` | 在那一步上加 `"bg": <背景号>`，**并清空 `cs`** |
| `show lx at center` | 加 `"cs":[{"k":"charA","i":<图号>,"s":"c"}]` |
| 一次显示两个 | `"cs":[{"k":"charA","i":1,"s":"left"},{"k":"jwq","i":2,"s":"right"}]` |
| `hide lx` | 把 `cs` 里对应项去掉；全没了就写 `"cs":[]` |
| `menu:` 选项 | `{"t":"o","x":"提示","o":[{"t":"选项A","j":<节点号>},{"t":"选项B","j":<节点号>}]}` |
| `jump label` | `{"t":"j","j":<节点号>}` |
| `if flag >= 3: jump x` | `{"t":"cj","v":"flag","op":">=","n":3,"j":<节点号>}` |
| `$ flag += 1` | `{"t":"f","v":"flag","n":1}` |
| `$ flag = 1` | `{"t":"sf","v":"flag","n":1}` |
| 结局 | `{"t":"e","x":"结局文本"}` |

#### 一个完整的例子

原作：

```renpy
label start:
    scene bg_room
    "房间里很安静。"
    show lx at center
    角色 "你在想什么？"
    menu:
        "说实话":
            jump honest
        "岔开话题":
            jump dodge

label honest:
    $ trust += 1
    角色 "……这样啊。"
    return
```

转成（`chunk-000.txt`）：

```json
[
  {"t":"s","n":"","x":"房间里很安静。","bg":0,"cs":[]},
  {"t":"s","n":"角色","x":"你在想什么？","cs":[{"k":"charA","i":1,"s":"c"}]},
  {"t":"o","x":"","o":[{"t":"说实话","j":3},{"t":"岔开话题","j":6}]},
  {"t":"f","v":"trust","n":1},
  {"t":"s","n":"角色","x":"……这样啊。"},
  {"t":"e","x":"示例结局"}
]
```

注意三件事：

1. **`bg` 那一步必须带 `cs: []`** —— 换景要清立绘，这是原作 `scene` 的语义。
   漏了就会出现「本该没人的界面站着上一位」。
2. **`j`（跳转）不要清 `cs`** —— 原作 `jump` 本来就不换景。
3. **节点号是全局连续的**（跨分块累加），不是分块内序号。
   `chapters[].start` 和 `nodes[].j` 用的都是全局号。

#### 切片与索引

节点总数几百到几千都没问题，切成每块 128 个：

```python
CH = 128
for i in range(0, len(nodes), CH):
    open('src/common/story/chunk-%03d.txt' % (i // CH), 'w', encoding='utf-8').write(
        json.dumps(nodes[i:i+CH], ensure_ascii=False))
```

然后写索引 `src/common/story/index.txt`：

```json
{
  "ver": 1,
  "title": "你的标题",
  "nodeCount": 1234,
  "chunkSize": 128,
  "entry": 0,
  "chapters": [{"id": "c1", "title": "第一章", "start": 0}],
  "chunks":   [{"file": "/common/story/chunk-000.txt", "start": 0, "count": 128}]
}
```

> `entry` 是「开始阅读」的起点。`chapters` 决定章节跳转页显示什么。
> 想留一个通关后才出现的章节，把它放在最后，并且在 `reader.js` 的
> 通关逻辑里控制（见 `markCleared` 的用法）。

---

### 第 3 步：把图片切出来

设 `k = 屏宽 / 336`（`pro` 档案是 1.0，`std` 是 0.631，`watch` 是 1.286）：

| 放哪 | 尺寸 | 说明 |
|---|---|---|
| `src/common/img/b/` | `(2×屏宽) × 屏高` | 背景。宽一倍是给全景平移留余量，会自动缓慢左右推 |
| `src/common/img/c/` | `ceil(屏高 × 16 / 9) × 屏高` | CG。**是 ceil 不是 round** |
| `src/common/img/s/` | `round(143k) × round(380k)` | 立绘 |
| `src/common/img/t/` | `round(96k) × round(54k)` | CG 缩略图 |
| `src/common/home.png` | `屏宽 × 屏高` | 主页画 |
| `src/common/icon.png` | **固定 192×192** | 启动器图标，**不要跟着屏幕缩放** |

用 Pillow 批量处理：

```python
from PIL import Image
IMG_W, IMG_H = 336, 480          # pro 档案
K = IMG_W / 336.0

def bg(src, dst):    # 背景：裁成 2:1 再缩
    im = Image.open(src).convert('RGB')
    im = im.resize((IMG_W * 2, IMG_H), Image.LANCZOS)
    im.save(dst, 'PNG', optimize=True)

def cg(src, dst):    # CG：按 16:9 裁
    w = -(-IMG_H * 16 // 9)
    Image.open(src).convert('RGB').resize((w, IMG_H), Image.LANCZOS).save(dst, 'PNG', optimize=True)

def sp(src, dst):    # 立绘：等比缩到高 380k
    h = round(380 * K)
    im = Image.open(src).convert('RGBA')
    im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
    im.save(dst, 'PNG', optimize=True)
```

> **立绘必须留透明通道**（`RGBA` + PNG）—— 底色是背景，不是白。
> 背景和 CG 用 `RGB` 就行，能小不少。

**体积预算**：真机实测图片总量**别超过 9 MB**，否则安装可能失败。
超了就把背景/CG 的调色板量化一下（Pillow 的 `quantize(colors=64)`）。

---

### 第 4 步：写索引表

图片要靠**下标**引用，所以要有两张表。

`src/common/assets.js`：

```js
// 下标就是剧本节点里的资源号
export const IMG = [
  "/common/img/b/room.png",     // 0
  "/common/img/s/charA_c.png",     // 1
  "/common/img/c/cg01.png",     // 2
]
export const BG = { "room": 0 }                     // 背景名 -> 下标
export const SP = { "charA|c": 1, "charA|left": 1 }        // "立绘名|槽位" -> 下标
```

`src/common/cglist.js`：

```js
export const CGG = [
  { n: "第一组", th: "/common/img/t/g0.png", u: 2, im: [2] }   // u=解锁条件图号, im=该组图片
]
```

（`tools/gen_demo.py` 会生成这两份的占位版，照它的格式改就行。）

---

### 第 5 步：改品牌

- `src/manifest.json` → `package`（改成你自己的，如 `com.yourname.game`）、`name`、`versionName`、`versionCode`
- `profiles.json` → 三个档案里的 `package` / `versionName` / `versionCode` **要跟 manifest 一致**
- `src/pages/about/about.ux` → `APP_VER` **必须等于 `versionName`**，否则构建会拒绝
- `src/pages/about/about.ux` 的 `ABOUT` 数组 → 换成你自己作品的介绍

---

### 第 6 步：构建

```bash
python tools/gen_demo.py . --profile pro   # 只在你还没放自己的图时需要
node tools/build.js --profile pro debug
```

产物在 `dist/`：

```
com.yourname.game.pro.debug.1.0.rpk
```

三个档案对应三类设备：

| 档案 | 设备 |
|---|---|
| `pro` | 手环 9 Pro / 10 Pro（336×480） |
| `std` | 手环 9 / 10 标准版（192×490 / 212×520） |
| `watch` | REDMI Watch 5 / 6（432×514） |

> **`img/` 一次只放得下一个档案的图。** 构建前会核对「现在这套图是不是这个档案的」，
> 对不上直接拒绝 —— 免得打出「包名是 std、图是 pro」的包。
> 要连图一起出，加 `--assets`。

---

### 第 7 步：装到手表

1. 用 **AstroBox** 连接手表（小米账号 / Authkey 都行）
2. 把 `dist/` 里的 `.rpk` 拖进去安装
3. 装完在手表应用列表里找你的应用名

> 支持列表见 AstroBox 文档。小米手环 9 及以后、REDMI Watch 5 及以后都支持。
> 手环 8 / REDMI Watch 4 及更早不支持快应用。

### 第 8 步：出问题了怎么查

**先看日志。** 应用启动时会打这些：

```
[Yurite] onInit，参数 at= load= auto=
[Yurite] 屏幕 336×480  型号字符串="M2311B1"  → 小米手环 9 Pro（fontBoost 1，设计高 480）
[Yurite] 读取剧本索引…
[Yurite] 索引 OK：节点 1234，分块 10
[Yurite] 从序章开始
[Yurite] 分块 OK /common/story/chunk-000.txt (128 节点)
```

**看不到这几行** → 页面没起来。检查 `manifest.json` 的路由、以及 `src/app.ux` 的入口。
**能看到但画面黑** → 大概率是某个元素的尺寸/定位把画面盖住了，
用 `tools/dump_layout.mjs` 导出各设备版面，对一下数值。

本地能跑的自检：

```bash
node tools/test_layout.mjs      # 几何引擎：多设备 + 型号识别 + 与参考版式逐像素比对
python tools/check_dup.py       # 对象字面量重名（编译期查不出来，会静默覆盖）
node tools/dump_layout.mjs layout.json   # 把各型号版面导成 JSON
```

> `check_dup.py` 不是可选项。Vela 的页面脚本是一个大对象字面量，
> **重名的方法不报错、后者静默覆盖前者** —— 我们因此让「离开阅读页关常亮」
> 整段变成过死代码，编译和日志都看不出来。

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

**0BSD**（BSD Zero Clause License），见 [LICENSE](LICENSE)。

随便用、改、再发布，**不需要保留署名**。
