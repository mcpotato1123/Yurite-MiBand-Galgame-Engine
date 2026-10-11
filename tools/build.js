#!/usr/bin/env node
/**
 * 构建包装脚本（设备档案版）
 *
 * aiot-toolkit 会先把工程复制到同级目录 `../.temp_<工程名>` 再编译，收尾时用 rimraf
 * 删这个临时工程；而临时工程里的 node_modules 是软链接（junction），Windows 上
 * rimraf 删它常常报 EPERM，导致构建虽然成功、退出码却是 1，还留下垃圾目录。
 *
 * 这里在构建前后各清理一次，并对产物做完整性校验。
 *
 * 一份代码、多个安装包：档案（package / versionName / versionCode）从工程根目录的
 * profiles.json 里读，**构建前**写进 src/manifest.json，构建完把 rpk 改名成
 * `<package>.<debug|release>.<versionName>.rpk`。
 *
 * 注意：src/common/img/ 一次只放**一个档案**的一套图（tools/gen_assets.py 按档案清空重建），
 * 所以构建前必须核对「现在这套图是不是这个档案的」—— 否则会打出「包名是 std、图是 pro」的包，
 * 尺寸和屏幕对不上，而且构建一路成功、不报错。核对见 preflight() 里的素材一致性检查。
 * 也可以直接让构建脚本先出图：`--assets`（素材目录默认自动找，也可显式给）。
 *
 * designWidth 固定 336，不随档案变 —— 引擎是自适应的，设计坐标系宽度统一 336，
 * 高度由运行时按屏幕比例算（见 src/common/device.js 与 src/common/layout.js）。
 *
 * aiot 每次构建都会清空 dist/，所以不同模式（debug / release）、不同档案（std / pro）的包
 * 在一次构建里根本留不住。办法是「挪包」：
 *   构建前先把 dist/ 里已经有的包挪到同级临时目录 `../.rpk_stage_<工程名>`，
 *   这次要构建的包全部构建完之后，再把暂存目录里的包一起挪回 dist/。
 * 这样连着跑 `--profile std` 和 `--profile pro`，dist/ 里最后两个档案的包都在；
 * 一次跑 `all` 也能同时留下 debug 和 release。
 *
 *   node tools/build.js --profile std                 # std 档案的 debug 包（package.json 的 build:std）
 *   node tools/build.js --profile pro release         # pro 档案的 release 包（package.json 的 release:pro）
 *   node tools/build.js --profile std all             # 两个包都出：靠挪包让 debug/release 共存
 *   node tools/build.js --profile std debug release   # 同上，也可以直接写两个模式词
 *   node tools/build.js --profile std --assets        # 先按档案出图（gen_assets.py）再构建
 *   node tools/build.js --profile std --clean         # 先删掉 dist/ 里的旧包再构建
 *   node tools/build.js --profile std --devtool source-map   # 其它参数原样透传给 aiot
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const proj = path.resolve(__dirname, '..');
const name = path.basename(proj);
const temp = path.resolve(proj, '..', '.temp_' + name);       // aiot 自己的临时工程
const stage = path.resolve(proj, '..', '.rpk_stage_' + name); // 挪包用的暂存目录
const dist = path.join(proj, 'dist');
const srcDir = path.join(proj, 'src');
const manifestPath = path.join(srcDir, 'manifest.json');
const profilesPath = path.join(proj, 'profiles.json');

function rmDir(dir) {
  if (!fs.existsSync(dir)) return;
  if (process.platform === 'win32') {
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' });
  } else {
    spawnSync('rm', ['-rf', dir], { stdio: 'ignore' });
  }
}

function rmTemp() {
  rmDir(temp);
}

function fail(msg) {
  console.error('\n✖ ' + msg);
  const left = restoreStaged();
  if (left.length) {
    console.error('（已把暂存目录里的 ' + left.length + ' 个包挪回 dist/：' +
      left.map((f) => path.basename(f)).join('、') + '）');
  }
  process.exit(1);
}

// ---------------------------------------------------------------- 参数解析
// 空字符串参数会把 aiot 弄坏（commander 拿到空值直接跑飞），所以一律丢掉。
function parseArgs(argv) {
  const MODE_WORDS = {
    debug: ['debug'],
    build: ['debug'],
    release: ['release'],
    all: ['debug', 'release'],
    both: ['debug', 'release'],
  };
  const out = { profile: null, modes: [], passthrough: [], cache: null, help: false,
    clean: false, assets: null, genAssets: false };

  // --flag value 和 --flag=value 都收；返回 { value, next }
  const takeValue = (flag, i) => {
    const a = argv[i];
    if (a === flag) return { value: argv[i + 1], next: i + 1 };
    return { value: a.slice(flag.length + 1), next: i };
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string' || a.trim() === '') continue;

    if (a === '-h' || a === '--help') { out.help = true; continue; }

    if (a === '--clean') { out.clean = true; continue; }

    if (a === '--profile' || a.startsWith('--profile=')) {
      const got = takeValue('--profile', i);
      i = got.next;
      const v = typeof got.value === 'string' ? got.value.trim() : '';
      if (!v) fail('--profile 后面要跟档案名，例如 --profile std');
      out.profile = v;
      continue;
    }

    if (a === '--cache' || a.startsWith('--cache=')) {
      const got = takeValue('--cache', i);
      i = got.next;
      out.cache = typeof got.value === 'string' && got.value.trim() ? got.value.trim() : null;
      continue;
    }

    // --assets            → 素材目录自动找
    // --assets <目录>      → 用给定的素材目录（Ren'Py 解包出来的 game 目录）
    if (a === '--assets' || a.startsWith('--assets=')) {
      out.genAssets = true;
      if (a === '--assets') {
        const next = argv[i + 1];
        if (typeof next === 'string' && next.trim() !== '' && !next.startsWith('-')) {
          out.assets = next.trim();
          i++;
        }
      } else {
        const v = a.slice('--assets='.length).trim();
        if (v) out.assets = v;
      }
      continue;
    }

    const word = a.toLowerCase();
    if (MODE_WORDS[word]) {
      for (const m of MODE_WORDS[word]) if (!out.modes.includes(m)) out.modes.push(m);
      continue;
    }

    out.passthrough.push(a);
  }

  if (!out.modes.length) out.modes = ['debug']; // 不给模式就只出 debug 包（和 build:std / build:pro 一致）
  return out;
}

const opts = parseArgs(process.argv.slice(2));

if (opts.help) {
  console.log([
    '用法: node tools/build.js [debug|release|all] [--profile <档案>] [aiot 参数…]',
    '',
    '  debug     只出调试包（aiot build），不给模式时的默认行为',
    '  release   只出发布包（aiot release，需要 sign/ 下的证书）',
    '  all       两个都出：aiot 每次构建会清空 dist/，所以内部先把包挪到临时目录，',
    '            两个都构建完再一起挪回 dist/',
    '  --profile profiles.json 里的档案名（std / pro），默认用第一个（std）',
    '  --clean   先把 dist/ 里的旧包全删掉再构建（默认是留着，多档案/多模式累积）',
    '  --assets [素材目录]  构建前先按档案跑 tools/gen_assets.py 出图',
    '            素材目录不给就自动找（GALGOD_RAW 环境变量 → ../_extract/raw …）',
  ].join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------- 档案
function loadProfiles() {
  if (!fs.existsSync(profilesPath)) fail('找不到 profiles.json（应该在工程根目录）');
  let data;
  try {
    data = JSON.parse(fs.readFileSync(profilesPath, 'utf8'));
  } catch (e) {
    fail('解析 profiles.json 失败：' + e.message);
  }
  const all = data && data.profiles;
  if (!all || typeof all !== 'object') fail('profiles.json 里没有 profiles 对象');
  const names = Object.keys(all);
  if (!names.length) fail('profiles.json 的 profiles 里一个档案都没有');
  return { all, names };
}

function pickProfile(all, names, want) {
  const key = want || names[0];
  if (!want) console.log('（没给 --profile，用 profiles.json 里的第一个档案：' + key + '）');
  const p = all[key];
  if (!p || typeof p !== 'object') {
    fail('profiles.json 里没有档案 "' + key + '"，可选：' + names.join(' / '));
  }
  for (const k of ['package', 'versionName', 'versionCode']) {
    if (p[k] === undefined || p[k] === null || p[k] === '') {
      fail('档案 "' + key + '" 缺字段 ' + k);
    }
  }
  return Object.assign({ key }, p);
}

// ---------------------------------------------------------------- 写 manifest
// 读-改-写 JSON：只动 package / versionName / versionCode，别的字段和缩进风格照旧。
// manifest.json 是 UTF-8，写回去的时候不带 BOM。
function writeManifest(prof) {
  if (!fs.existsSync(manifestPath)) fail('找不到 src/manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // 顺手兼容 BOM
  const ind = text.match(/^\{\r?\n([ \t]+)"/);
  const indent = ind ? ind[1] : '  ';
  const eol = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const tail = /\r?\n$/.test(text);

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    fail('解析 src/manifest.json 失败：' + e.message);
  }

  const next = {
    package: String(prof.package),
    versionName: String(prof.versionName),
    versionCode: Number(prof.versionCode),
  };
  const changes = [];
  for (const k of Object.keys(next)) {
    const before = obj[k];
    if (before !== next[k]) changes.push(k + ': ' + JSON.stringify(before) + ' → ' + JSON.stringify(next[k]));
    obj[k] = next[k];
  }

  let out = JSON.stringify(obj, null, indent);
  if (eol === '\r\n') out = out.split('\n').join('\r\n');
  if (tail) out += eol;
  fs.writeFileSync(manifestPath, out, 'utf8');

  console.log('▶ 档案 ' + prof.key + '（' + (prof.label || '') + '）→ src/manifest.json');
  console.log('  ' + (changes.length ? changes.join('\n  ') : '包名/版本本来就是这个值，没改动'));
  console.log('  designWidth = ' + ((obj.config && obj.config.designWidth) || '(没写)') +
    '（固定 336，不随档案变）\n');
}

/** 数一数目录下有多个文件匹配这个正则 */
function countFiles(dir, re) {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d)) {
      const p = path.join(d, e);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (re.test(e)) n++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return n;
}

/** 扫出 src 下真正 import/require 的 @system.* 模块（只看 import/require 语句，注释不算） */
function scanSystemFeatures(dir) {
  const found = new Set();
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(ux|js)$/.test(n)) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/import\s+[^'"]*from\s*['"]@system\.([\w.]+)['"]/g)) {
        found.add('system.' + m[1]);
      }
      for (const m of src.matchAll(/require\(\s*['"]@system\.([\w.]+)['"]/g)) {
        found.add('system.' + m[1]);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return found;
}

// ---------------------------------------------------------------- 素材与档案一致性
// src/common/img/ 一次只放一个档案的一套图：tools/gen_assets.py 会先清空 img/ 再按档案重建。
// 所以「现在这套图是哪个档案的」必须核对 —— 不然会打出「包名是 std、图是 pro」的包：
// 336×480 的图和 212×520 的屏幕对不上，装到真机上就是错的，而且构建不会报任何错。
//
// 尺寸公式与 tools/gen_assets.py 的 Geometry 保持一致（那边是唯一真源，改公式要两处一起改）。
const BASE_W = 336;                             // 设计基准宽，pro 的 k = 1
const BASE_SPRITE = { w: 143, h: 380 };         // 立绘
const BASE_THUMB = { w: 96, h: 54 };            // CG 鉴赏缩略图
const BASE_ICON = 192;                          // 应用图标边长
const BASE_BG_MULT = 2;                         // 全景背景宽 = 2 屏宽

/** Python 3 的 round()：恰好 .5 时取偶（不是 Math.round 的一律进一） */
function pyRound(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** 只读 PNG 头的 IHDR 拿宽高（第 16..24 字节，大端 uint32），不解像素 */
function pngSize(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(24);
    if (fs.readSync(fd, b, 0, 24, 0) < 24) return null;
    if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
    if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** 一个档案 asset 对应的整套出图尺寸 */
function expectedAssetDims(asset) {
  const k = asset.w / BASE_W;
  return [
    { rel: 'img/b', what: '全景背景（2 × 屏宽）', w: BASE_BG_MULT * asset.w, h: asset.h },
    { rel: 'img/c', what: 'CG（ceil(高 × 16/9) 的宽图）', w: Math.ceil(asset.h * 16 / 9), h: asset.h },
    { rel: 'img/s', what: '立绘（143k × 380k）', w: pyRound(BASE_SPRITE.w * k), h: pyRound(BASE_SPRITE.h * k) },
    { rel: 'img/t', what: '鉴赏缩略图（96k × 54k）', w: pyRound(BASE_THUMB.w * k), h: pyRound(BASE_THUMB.h * k) },
    { rel: '.', only: 'home.png', what: '主页画（屏宽 × 屏高）', w: asset.w, h: asset.h },
    // 图标**不随档案缩放**，固定 192 —— 它是启动器图标、规格固定。
    // 跟着 k 放大会做出 247x247 这种超规格图标，安装时启动器崩掉、真机上表现为重启。
    { rel: '.', only: 'icon.png', what: '应用图标（固定 192 方形，不随档案变）', w: BASE_ICON, h: BASE_ICON },
  ];
}

/**
 * 核对 src/common/img（以及 home.png / icon.png）是不是这个档案的图。
 * 全部逐张只读 PNG 头：136 张也就几十毫秒，比抽查靠得住 ——
 * 出图中途被打断（比如构建和 gen_assets.py 同时在跑）会留下一半对一半错的目录。
 */
function checkAssets(prof, allProfiles, problems) {
  const asset = prof.asset;
  if (!asset || !asset.w || !asset.h) {
    console.log('⚠ 档案 ' + prof.key + ' 没有 asset.w / asset.h，跳过素材尺寸核对');
    return null;
  }
  const common = path.join(srcDir, 'common');
  const bad = [];
  const summary = [];

  for (const exp of expectedAssetDims(asset)) {
    const dir = path.join(common, exp.rel);
    const want = exp.w + '×' + exp.h;
    let files = [];
    if (fs.existsSync(dir)) {
      files = fs.readdirSync(dir)
        .filter((f) => /\.png$/i.test(f))
        .filter((f) => !exp.only || f === exp.only)
        .sort();
    }
    if (!files.length) {
      bad.push({
        file: exp.only ? (exp.rel === '.' ? exp.only : exp.rel + '/' + exp.only) : exp.rel + '/',
        what: exp.what, want, got: '没有 PNG',
      });
      continue;
    }
    let ok = 0;
    for (const f of files) {
      const p = path.join(dir, f);
      const dm = pngSize(p);
      if (dm && dm.w === exp.w && dm.h === exp.h) { ok++; continue; }
      bad.push({
        file: path.relative(proj, p).replace(/\\/g, '/'),
        what: exp.what,
        want,
        got: dm ? dm.w + '×' + dm.h : '不是 PNG 或读不出头',
      });
    }
    summary.push((exp.only || exp.rel) + ' ' + want + (files.length > 1 ? ' ×' + ok + '/' + files.length : ''));
  }

  if (!bad.length) {
    console.log('✔ 素材与档案一致：' + summary.join('  '));
    return asset;
  }

  // 顺手认一下现在这套图是谁的，报错信息里直接说清
  const bDir = path.join(common, 'img', 'b');
  const bFirst = fs.existsSync(bDir)
    ? fs.readdirSync(bDir).filter((f) => /\.png$/i.test(f)).sort()[0]
    : null;
  const sample = bFirst ? pngSize(path.join(bDir, bFirst)) : null;
  let owner = '';
  if (sample) {
    for (const key of Object.keys(allProfiles)) {
      const a = allProfiles[key].asset;
      if (a && a.w && sample.w === BASE_BG_MULT * a.w && sample.h === a.h) {
        owner = '（这套图的 img/b 是 ' + sample.w + '×' + sample.h + '，看着是档案 ' + key + ' 的图）';
        break;
      }
    }
  }

  const shown = bad.slice(0, 6).map((b) =>
    '    ' + b.file + '  期望 ' + b.want + '（' + b.what + '），实际 ' + b.got);
  problems.push('素材和档案对不上：src/common 下现在放的不是档案 ' + prof.key + ' 的图' +
    '（档案 asset = ' + asset.w + '×' + asset.h + '）' + owner + '\n' +
    shown.join('\n') +
    (bad.length > shown.length ? '\n    …还有 ' + (bad.length - shown.length) + ' 张对不上' : '') + '\n' +
    '     → 请先按档案重新出图再构建：\n' +
    '       ' + genAssetsHint(prof.key));
  return null;
}

/** 「怎么出图」的提示，素材目录存在的话直接给一条能粘贴的命令 */
function genAssetsHint(profileKey) {
  const raw = findRawDir();
  const p = 'python tools/gen_assets.py ';
  return raw
    ? p + raw + ' . --profile ' + profileKey
    : p + '<Ren\'Py 解包出来的 game 目录> . --profile ' + profileKey;
}

/** 自动找素材目录：GALGOD_RAW → 工程隔壁的 _extract/raw */
function findRawDir() {
  const cands = [
    process.env.GALGOD_RAW,
    path.resolve(proj, '..', '_extract', 'raw'),
    path.resolve(proj, '..', '..', '_extract', 'raw'),
    path.resolve(proj, '..', '..', 'game'),
  ];
  for (const c of cands) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------- 构建前静态检查
// 这里挡的是「编译器不报错、真机运行时才抛错」的两个 Vela 陷阱：
//   1. data 与 public/protected/private 同时存在 → 运行时直接抛错，页面 VM 创建失败，
//      表现是「点按钮完全没反应」
//   2. export default 顶层的字面量属性（story/chunkCache 之类）不保证会挂到页面实例上，
//      若在赋值前就被读取，会 undefined[...] 抛错
function preflight(prof, allProfiles) {
  const pagesDir = path.join(proj, 'src', 'pages');
  const problems = [];
  const warns = [];
  if (!fs.existsSync(pagesDir)) return;

  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) { walk(p); continue; }
      if (!name.endsWith('.ux')) continue;

      const src = fs.readFileSync(p, 'utf8');
      const m = src.match(/<script>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const script = m[1];
      const rel = path.relative(proj, p);

      // 取 export default 对象的第一层键（本工程格式固定为 2 空格缩进）
      const vmDecl = [];
      const literals = [];
      for (const line of script.split(/\r?\n/)) {
        const km = line.match(/^ {2}([A-Za-z_$][\w$]*)\s*:\s*(.*)$/);
        if (!km) continue;
        const key = km[1];
        const rest = km[2].trim();
        if (['data', 'public', 'protected', 'private'].includes(key)) {
          vmDecl.push(key);
        } else if (/^(\{|\[|null\b|\d|'|"|true\b|false\b)/.test(rest)) {
          literals.push(key);
        }
      }

      if (vmDecl.includes('data') && vmDecl.some((k) => k !== 'data')) {
        problems.push(rel + ' 同时声明了 ' + vmDecl.join(' / ') +
          '\n     → 运行时抛「属性data不可与public,protected,private同时存在」，' +
          '页面 VM 建不起来，表现为点按钮毫无反应。请统一只用 protected。');
      }
      if (literals.length) {
        warns.push(rel + ' 顶层字面量属性: ' + literals.join(', ') +
          '\n     → 这些键不保证会挂到页面实例上；请在 onInit() 里显式赋值，且读取前兜底');
      }
    }
  };
  walk(pagesDir);

  // 关于页会在副标题里显示版本号，那个字符串是写死的常量，
  // 很容易改了 manifest 忘了改它（页面上就会显示旧版本）。这里强制核对。
  // 注意：manifest 里的 versionName 是刚才按档案写进去的，所以核对的是「这份档案的版本」。
  const aboutPath = path.join(pagesDir, 'about', 'about.ux');
  if (fs.existsSync(manifestPath) && fs.existsSync(aboutPath)) {
    const man = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const ver = man.versionName;
    const a = fs.readFileSync(aboutPath, 'utf8').match(/const APP_VER\s*=\s*'([^']+)'/);
    if (!a) {
      warns.push('about.ux 里找不到 APP_VER 常量，无法核对版本号');
    } else if (a[1] !== ver) {
      problems.push('about.ux 的 APP_VER = ' + a[1] +
        '，但 manifest.json 的 versionName = ' + ver +
        '\n     → 关于页会显示错误的版本号，请把两者改成一致');
    }

    // designWidth 是自适应引擎的基准坐标系宽度，档案只管包名和版本，不许改这个。
    const dw = man.config && man.config.designWidth;
    if (dw !== 336) {
      problems.push('manifest.json 的 config.designWidth = ' + dw + '，必须固定 336' +
        '\n     → 引擎是自适应的：设计坐标系宽度统一 336，高度由运行时按屏幕比例算，' +
        '所有 CSS 数值都是按 336 宽的坐标系写的，改了就全乱。');
    }

    // 代码里 import 了 @system.xxx 就必须在 manifest.features 里声明，
    // 否则 aiot 编译到一半报 `missing feature: [{ "name": "system.device" }]` 然后不出包。
    const used = scanSystemFeatures(path.join(proj, 'src'));
    const declared = new Set((man.features || []).map((f) => f && f.name).filter(Boolean));
    const missing = Array.from(used).filter((f) => !declared.has(f));
    if (missing.length) {
      problems.push('代码里用了但 manifest.json 的 features 里没声明: ' + missing.join(', ') +
        '\n     → aiot 会在「Copy resource files」阶段报 missing feature 并中止，出不了 rpk。' +
        '\n       在 src/manifest.json 的 features 里补上 { "name": "' + missing[0] + '" }，' +
        '或者给构建命令加 aiot 的 --complete-feature 自动补全。');
    }
  }

  // 素材（img/ 那一套图）是不是这个档案的 —— 这是最容易出「包能构建、装上去是错的」的一环
  checkAssets(prof, allProfiles, problems);

  for (const w of warns) console.log('⚠ ' + w);
  if (problems.length) {
    fail('构建前检查未通过：\n  ' + problems.join('\n  '));
  }
  console.log('✔ 构建前检查通过（页面 VM 声明无冲突、版本号一致、designWidth = 336）\n');
}

// ---------------------------------------------------------------- 出图（可选）
// 按档案跑一遍 tools/gen_assets.py，把 src/common/img/ 换成这个档案的图。
// 素材目录自动找（GALGOD_RAW → ../_extract/raw），也可以显式给。
function pythonBin() {
  const cands = [];
  if (process.env.GALGOD_PYTHON) cands.push([process.env.GALGOD_PYTHON]);
  if (process.env.PYTHON) cands.push([process.env.PYTHON]);
  cands.push(['python'], ['py', '-3']);
  for (const c of cands) {
    const probe = spawnSync(c[0], c.slice(1).concat(['-c', 'import PIL']), { stdio: 'ignore' });
    if (probe.status === 0) return c;
  }
  fail('找不到带 Pillow 的 python（试过 GALGOD_PYTHON / PYTHON / python / py -3）。\n' +
    '  用 GALGOD_PYTHON=<python.exe 路径> 指定一个，或者手动跑 gen_assets.py。');
}

function generateAssets(prof) {
  const script = path.join(proj, 'tools', 'gen_assets.py');
  if (!fs.existsSync(script)) fail('找不到 tools/gen_assets.py');

  const raw = opts.assets || findRawDir();
  if (!raw) {
    fail('--assets 没给素材目录，也自动找不到（试过 GALGOD_RAW → ../_extract/raw）。\n' +
      '  用法：node tools/build.js --profile ' + prof.key + ' --assets <Ren\'Py 解包出来的 game 目录>');
  }
  if (!fs.existsSync(raw)) fail('素材目录不存在：' + raw);

  const py = pythonBin();
  const args = [script, raw, '.', '--profile', prof.key];
  console.log('▶ 先按档案 ' + prof.key + ' 出图：' + py.join(' ') + ' ' + args.join(' ') + '\n');
  const res = spawnSync(py[0], py.slice(1).concat(args), { cwd: proj, stdio: 'inherit' });
  if (res.status !== 0) {
    fail('gen_assets.py 出图失败（退出码 ' + res.status + '），素材还是旧的，已停止构建');
  }
  console.log('');
}

// ---------------------------------------------------------------- 签名证书
// debug 包用工具链自带的默认证书（sign/ 不存在也能出包）；
// release 包必须要有 sign/release/ 或 sign/ 下的私钥 + 证书，否则 aiot 直接报
// 「there is a problem with the certification path」。
function releaseCert() {
  const pairs = [
    path.join(proj, 'sign', 'release'),
    path.join(proj, 'sign'),
  ];
  for (const dir of pairs) {
    const key = path.join(dir, 'private.pem');
    const cert = path.join(dir, 'certificate.pem');
    if (fs.existsSync(key) && fs.existsSync(cert)) return dir;
  }
  return null;
}

// ---------------------------------------------------------------- 跑 aiot
function runAiot(aiotMode, extraArgs) {
  const cli = path.join(proj, 'node_modules', 'aiot-toolkit', 'lib', 'bin.js');
  if (!fs.existsSync(cli)) fail('没有安装依赖，先跑 npm install');

  rmTemp();

  // 空参数会让 aiot 跑飞，再兜一层
  const args = [cli, aiotMode].concat(extraArgs.filter((a) => typeof a === 'string' && a.trim() !== ''));

  const env = Object.assign({}, process.env);
  if (opts.cache) env.npm_config_cache = opts.cache;

  console.log('▶ aiot ' + aiotMode + ' …\n');
  const res = spawnSync(process.execPath, args, { cwd: proj, stdio: 'inherit', env });

  rmTemp();

  if (res.status !== 0) {
    // rimraf 删软链接失败会让退出码变 1，但只要产物在就当作成功
    console.log('\n（aiot 退出码 ' + res.status + '，通常是临时目录清理失败，忽略）');
  }
}

// ---------------------------------------------------------------- 产物
// 直接解析 zip 中央目录，不依赖外部 tar
function zipCentral(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    entries.push({
      name: buf.toString('utf8', p + 46, p + 46 + nlen),
      method: buf.readUInt16LE(p + 10),
      csize: buf.readUInt32LE(p + 20),
      lho: buf.readUInt32LE(p + 42),
    });
    p += 46 + nlen + elen + clen;
  }
  return { buf, entries };
}

function zipList(file) {
  const z = zipCentral(file);
  return z ? z.entries.map((e) => e.name) : null;
}

/** 从已经解析好的中央目录里解一个文件出来 */
function zipReadFrom(z, want) {
  const e = z.entries.find((x) => x.name === want);
  if (!e) return null;
  const buf = z.buf;
  const q = e.lho;
  if (q + 30 > buf.length || buf.readUInt32LE(q) !== 0x04034b50) return null;
  const nlen = buf.readUInt16LE(q + 26);
  const elen = buf.readUInt16LE(q + 28);
  const start = q + 30 + nlen + elen;
  const raw = buf.subarray(start, start + e.csize);
  try {
    if (e.method === 0) return raw;
    if (e.method === 8) return zlib.inflateRawSync(raw);
  } catch (err) {
    return null;
  }
  return null;
}

/** 把 rpk 里的某个文件解出来（用于核对包名/版本号、图片尺寸） */
function zipRead(file, want) {
  const z = zipCentral(file);
  return z ? zipReadFrom(z, want) : null;
}

/** dist/ 里刚产出的 rpk（aiot 每次都会先清空 dist/，所以正常只有一个） */
function pickFreshRpk() {
  if (!fs.existsSync(dist)) return null;
  const rpks = fs.readdirSync(dist)
    .filter((f) => f.endsWith('.rpk') && !f.startsWith('.'))
    .map((f) => path.join(dist, f))
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
  return rpks.length ? rpks[rpks.length - 1] : null;
}

/** 改成 `<package>.<档案>.<debug|release>.<versionName>.rpk`
 *
 * 文件名里**必须带档案名**：三个档案如果共用同一个包名，
 * 不带档案名的话 std / pro / watch 会生成同一个文件名，互相覆盖。
 * （共用包名是常见做法 —— 应用商店上算同一个资源，按机型分发。） */
function renameRpk(file, prof, label, profileId) {
  const want = prof.package + '.' + (profileId || 'pkg') + '.' + label +
    '.' + prof.versionName + '.rpk';
  const target = path.join(dist, want);
  if (path.basename(file) === want) return target;
  if (fs.existsSync(target)) fs.unlinkSync(target);
  fs.renameSync(file, target);
  return target;
}

function moveToStage(file) {
  fs.mkdirSync(stage, { recursive: true });
  const dest = path.join(stage, path.basename(file));
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.renameSync(file, dest);
  return dest;
}

/** dist/ 里已有的包先挪进暂存目录（aiot 构建前会清空 dist/，不清走就丢了） */
function moveDistRpksToStage() {
  if (!fs.existsSync(dist)) return [];
  const moved = [];
  for (const f of fs.readdirSync(dist)) {
    if (!f.endsWith('.rpk') || f.startsWith('.')) continue; // .diff.rpk 是热更新的差分包，不算成品
    moveToStage(path.join(dist, f));
    moved.push(f);
  }
  return moved;
}

/** 暂存目录里的包全部挪回 dist/ */
function restoreStaged() {
  if (!fs.existsSync(stage)) return [];
  fs.mkdirSync(dist, { recursive: true });
  const out = [];
  for (const f of fs.readdirSync(stage)) {
    if (!f.endsWith('.rpk') || f.startsWith('.')) continue;
    const from = path.join(stage, f);
    const to = path.join(dist, f);
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.renameSync(from, to);
    out.push(to);
  }
  rmDir(stage);
  return out;
}

/**
 * 抽查**包里面**的图，确认装进去的是这个档案的尺寸。
 * 构建前的 checkAssets 核对的是 src/，这一步核对的是打包后的字节 ——
 * 万一打包期间 src/common/img/ 被 gen_assets.py 换了（两边同时在跑），这里才能拦住。
 */
function verifyPackedAssets(z, list, prof, rel) {
  const asset = prof.asset;
  if (!asset || !asset.w || !asset.h) return;
  const picks = [];
  for (const exp of expectedAssetDims(asset)) {
    const prefix = exp.rel === '.' ? 'common/' : 'common/' + exp.rel + '/';
    if (exp.only) {
      const name = prefix + exp.only;
      if (list.includes(name)) picks.push({ name, exp });
      continue;
    }
    const first = list.filter((n) => n.startsWith(prefix) && /\.png$/i.test(n)).sort()[0];
    if (first) picks.push({ name: first, exp });
  }

  const bad = [];
  const okNames = [];
  for (const p of picks) {
    const buf = zipReadFrom(z, p.name);
    if (!buf || buf.length < 24) continue; // 解不出来就跳过，不误报
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w === p.exp.w && h === p.exp.h) okNames.push(p.name.replace('common/', '') + ' ' + w + '×' + h);
    else bad.push(p.name + ' 期望 ' + p.exp.w + '×' + p.exp.h + '，实际 ' + w + '×' + h);
  }
  if (bad.length) {
    fail(rel + ' 里的图不是档案 ' + prof.key + ' 的（asset ' + asset.w + '×' + asset.h + '）：\n    ' +
      bad.join('\n    ') +
      '\n     → 打包时 src/common/img/ 里放的不是这个档案的图（多半构建期间在跑 gen_assets.py），请重跑。');
  }
  if (okNames.length) {
    console.log('  包内图抽查: ' + okNames.join('  '));
  }
}

/** 校验一个 rpk：体积、内容、里面 manifest 的包名与版本、以及图是不是这个档案的 */
function verifyRpk(file, prof, label) {
  const size = fs.statSync(file).size;
  const rel = path.relative(proj, file);
  console.log('\n▶ 产物: ' + rel + '  [' + label + ']');
  console.log('  体积: ' + (size / 1048576).toFixed(2) + ' MB');
  if (size > 10 * 1048576) console.log('  ⚠ 超过 10MB 参考上限');

  const z = zipCentral(file);
  if (!z) {
    console.log('  （无法解析 rpk 目录，跳过内容校验）');
    return { file, rel, label, size };
  }
  const list = z.entries.map((e) => e.name);

  const jpg = list.filter((f) => /\.jpe?g$/i.test(f));
  const png = list.filter((f) => /\.png$/i.test(f));
  const chunks = list.filter((f) => /story\/chunk-\d+\.txt$/.test(f));
  const hasIndex = list.some((f) => /story\/index\.txt$/.test(f));
  console.log('  条目: ' + list.length + '  PNG: ' + png.length + '  剧本块: ' + chunks.length);
  if (jpg.length) console.log('  ⚠ 含 JPEG（真机解码不可靠）: ' + jpg.length + ' 个');

  // 资源是「源码里有什么就打包什么」，数量对不上说明构建期间 src 正在被改
  // （比如同时在跑 gen_assets.py），包会缺图但构建照样成功。
  const srcPng = countFiles(srcDir, /\.png$/i);
  if (png.length !== srcPng) {
    console.log('  ⚠ rpk 里 ' + png.length + ' 个 PNG，src 下有 ' + srcPng + ' 个（差 ' +
      (srcPng - png.length) + ' 个）' +
      '\n     → 多半是构建期间 src/common/img 正在被重新生成（gen_assets.py），等它跑完再构建一次');
  }
  if (!hasIndex) fail(rel + ' 里没有 common/story/index.txt');
  if (!chunks.length) fail(rel + ' 里没有剧本分块');

  // 直接读 rpk 里的 manifest.json：这是「包名版本号对不对」的唯一可靠证据
  const raw = zipReadFrom(z, 'manifest.json');
  if (!raw) {
    console.log('  ⚠ 读不出 rpk 里的 manifest.json，跳过包名核对');
    return { file, rel, label, size };
  }
  let man;
  try {
    man = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    fail(rel + ' 里的 manifest.json 不是合法 JSON：' + e.message);
  }
  console.log('  包内: package=' + man.package + '  versionName=' + man.versionName +
    '  versionCode=' + man.versionCode + '  designWidth=' + (man.config && man.config.designWidth));

  if (man.package !== prof.package) {
    fail(rel + ' 里的包名是 ' + man.package + '，档案要求 ' + prof.package);
  }
  if (man.versionName !== prof.versionName) {
    fail(rel + ' 里的 versionName 是 ' + man.versionName + '，档案要求 ' + prof.versionName);
  }
  if (Number(man.versionCode) !== Number(prof.versionCode)) {
    fail(rel + ' 里的 versionCode 是 ' + man.versionCode + '，档案要求 ' + prof.versionCode);
  }
  if ((man.config && man.config.designWidth) !== 336) {
    fail(rel + ' 里的 designWidth 不是 336');
  }
  const signEntry = list.some((f) => f === 'META-INF/CERT');
  console.log('  签名: ' + (signEntry ? '有签名块（META-INF/CERT）' : '⚠ 没找到签名块'));

  verifyPackedAssets(z, list, prof, rel);

  return { file, rel, label, size };
}

// ---------------------------------------------------------------- 主流程
const { all, names } = loadProfiles();
const prof = pickProfile(all, names, opts.profile);

if (opts.cache) {
  // aiot-toolkit 2.0.5 没有 --cache 这个参数（`aiot build --help` 里没有），
  // 直接透传会被 commander 判成 unknown option 当场退出、构建失败。
  // 这里收下来当 npm 缓存目录用（npm_config_cache），不转发给 aiot。
  console.log('（--cache ' + opts.cache + '：作为 npm 缓存目录传给子进程；' +
    'aiot-toolkit 2.0.5 不认这个参数，透传会让构建直接失败，所以不转发）\n');
}
if (opts.passthrough.length) {
  console.log('（透传给 aiot 的参数: ' + opts.passthrough.join(' ') + '）\n');
}

console.log('▶ 目标: 档案 ' + prof.key + '  ' + (prof.label || '') +
  '  [' + opts.modes.join(' + ') + ']');

// 0. 可选：先按档案把 src/common/img/ 出成这个档案的一套图
if (opts.genAssets) generateAssets(prof);

// 1. 先把档案写进 manifest，再跑 preflight（版本号核对的是这份档案，素材也在这个阶段核对）
writeManifest(prof);
preflight(prof, all);

// 2. dist/ 里已有的包先挪进暂存目录（aiot 每次构建都会清空 dist/，不清走就丢了），
//    然后逐个模式构建；每个构建完立刻改名 + 也挪进暂存目录。
rmTemp();
if (opts.clean) {
  const dropped = [];
  for (const dir of [dist, stage]) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.rpk') || f.startsWith('.')) continue;
      fs.unlinkSync(path.join(dir, f));
      dropped.push(f);
    }
  }
  rmDir(stage);
  console.log('▶ --clean：删掉 ' + dropped.length + ' 个旧包' +
    (dropped.length ? '（' + dropped.join('、') + '）' : ''));
}
const kept = moveDistRpksToStage();
if (kept.length) {
  console.log('▶ dist/ 里已有的 ' + kept.length + ' 个包先挪到暂存目录：' + kept.join('、'));
}

const built = [];
for (const mode of opts.modes) {
  if (mode === 'release' && !releaseCert()) {
    if (opts.modes.length > 1) {
      console.log('\n⚠ 没有签名证书（sign/private.pem + sign/certificate.pem），跳过 release 包。' +
        '\n  要出发布包就先建证书：\n' +
        '  openssl req -newkey rsa:2048 -nodes -keyout sign/private.pem -x509 -days 3650 -out sign/certificate.pem\n');
      continue;
    }
    fail('要出 release 包，但 sign/ 下没有 private.pem + certificate.pem。\n' +
      '  生成证书：openssl req -newkey rsa:2048 -nodes -keyout sign/private.pem -x509 -days 3650 -out sign/certificate.pem');
  }

  const label = mode === 'release' ? 'release' : 'debug';
  const aiotMode = mode === 'release' ? 'release' : 'build';

  runAiot(aiotMode, opts.passthrough);

  const fresh = pickFreshRpk();
  if (!fresh) fail('aiot ' + aiotMode + ' 跑完了，但 dist/ 里没有 .rpk');

  const renamed = renameRpk(fresh, prof, label, prof.key);
  const staged = moveToStage(renamed);
  console.log('  → 暂存 ' + path.basename(staged));
  built.push({ label, name: path.basename(staged) });
}

// 3. 这次要构建的都构建完了，把暂存目录里的包一起挪回 dist/（本次的 + 之前留下的）
const labels = new Map(built.map((b) => [b.name, b.label]));
console.log('\n▶ 把暂存的包挪回 dist/ …');
const finals = restoreStaged();
if (!finals.length) fail('dist/ 里没有 .rpk');

const mine = finals.filter((f) => labels.has(path.basename(f)));
const others = finals.filter((f) => !labels.has(path.basename(f)));
const report = mine
  .map((f) => verifyRpk(f, prof, labels.get(path.basename(f))))
  .sort((a, b) => (a.label < b.label ? -1 : 1));

if (others.length) {
  console.log('\n▶ dist/ 里保留的其它包（不是这次构建的，原样留着）:');
  const srcPngNow = countFiles(srcDir, /\.png$/i);
  for (const f of others.sort()) {
    const size = fs.statSync(f).size / 1048576;
    const man = zipRead(f, 'manifest.json');
    let info = '';
    try {
      const m = JSON.parse(man.toString('utf8'));
      info = '  ← ' + m.package + ' ' + m.versionName + ' (' + m.versionCode + ')';
    } catch (e) { /* 读不出来就不显示包名 */ }
    console.log('  ' + path.relative(proj, f) + '   ' + size.toFixed(2) + ' MB' + info);
    const list = zipList(f);
    const pngN = list ? list.filter((n) => /\.png$/i.test(n)).length : -1;
    if (pngN >= 0 && pngN !== srcPngNow) {
      console.log('     ⚠ rpk 里 ' + pngN + ' 个 PNG，当前 src 下有 ' + srcPngNow +
        ' 个 —— 旧包，或者构建时资源正在被重新生成，要重出就用 --clean');
    }
  }
}

console.log('\n────────────────────────────────────────');
console.log('✔ 档案 ' + prof.key + '（' + (prof.label || '') + '）构建完成');
for (const r of report) {
  console.log('  ' + r.rel + '   ' + (r.size / 1048576).toFixed(2) + ' MB   [' + r.label + ']');
}
console.log('  包名 ' + prof.package + '   版本 ' + prof.versionName + ' (' + prof.versionCode + ')');
console.log('  素材 ' + (prof.asset
  ? prof.asset.w + '×' + prof.asset.h + '（k = ' + (prof.asset.w / BASE_W).toFixed(4) + '）'
  : '(档案没写 asset)') + '   designWidth 336');
console.log('  dist/ 里现在一共 ' + finals.length + ' 个包');
console.log('\n✔ 完成');
