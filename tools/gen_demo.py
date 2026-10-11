# -*- coding: utf-8 -*-
"""生成 Yurite 的占位内容 —— 让引擎不依赖任何美术素材就能构建、能跑

产出：
  src/common/img/b/*.png   纯色背景（屏宽×2，给全景平移留余量）
  src/common/img/s/*.png   纯色立绘（按各型号的立绘尺寸出）
  src/common/img/c/*.png   纯色 CG
  src/common/img/t/*.png   CG 缩略图
  src/common/home.png      主页画（屏宽×屏高）
  src/common/icon.png      启动器图标（固定 192×192）
  src/common/story/*.txt   占位剧本（分块，JSON 数组）
  src/common/story/index.txt  剧本索引
  src/common/assets.js     IMG / BG / SP 三张索引表
  src/common/cglist.js     CGG 分组表

尺寸公式与 tools/build.js 的预检一致（不一致会被构建挡下来）。
"""
import io
import json
import os
import sys
import struct
import zlib

PROJ = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')

# ---------------------------------------------------------------- 0. 极小 PNG 写入
def png(path, w, h, rgb):
    """不依赖 Pillow，手写一张纯色 PNG（引擎不需要好看，只需要尺寸对）"""
    raw = b''
    row = bytes(rgb) * w
    for _ in range(h):
        raw += b'\x00' + row
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    out = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) +
           chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'wb').write(out)


# ---------------------------------------------------------------- 1. 读设备档案
prof = json.load(io.open(os.path.join(PROJ, 'profiles.json'), encoding='utf-8'))
key = 'pro'
pf = prof['profiles'][key]
W, H = pf['asset']['w'], pf['asset']['h']
k = W / 336.0
BG_W, CG_W = W * 2, -(-H * 16 // 9)          # ceil(H*16/9)
SP_W, SP_H = round(143 * k), round(380 * k)
TH_W, TH_H = round(96 * k), round(54 * k)
print('  设备档案 %s：%dx%d  k=%.4f' % (key, W, H, k))
print('  尺寸：BG %dx%d  CG %dx%d  立绘 %dx%d  缩略 %dx%d' % (BG_W, H, CG_W, H, SP_W, SP_H, TH_W, TH_H))

COLORS = {
    'b': [(28, 32, 48), (48, 36, 44), (32, 44, 40), (44, 40, 56), (36, 30, 52)],
    's': [(210, 170, 180), (170, 190, 215), (200, 200, 170)],
    'c': [(60, 40, 70), (40, 60, 70), (70, 50, 40), (50, 50, 60)],
}

# ---------------------------------------------------------------- 2. 出图
BASE = os.path.join(PROJ, 'src', 'common')
bgs, sps, cgs = [], [], []
for i, c in enumerate(COLORS['b']):
    p = '/common/img/b/b%d.png' % i
    png(os.path.join(BASE, 'img', 'b', 'b%d.png' % i), BG_W, H, c)
    bgs.append(p)
for i, c in enumerate(COLORS['s']):
    p = '/common/img/s/s%d.png' % i
    png(os.path.join(BASE, 'img', 's', 's%d.png' % i), SP_W, SP_H, c)
    sps.append(p)
for i, c in enumerate(COLORS['c']):
    p = '/common/img/c/c%d.png' % i
    png(os.path.join(BASE, 'img', 'c', 'c%d.png' % i), CG_W, H, c)
    cgs.append(p)
for i in range(2):
    png(os.path.join(BASE, 'img', 't', 'g%d.png' % i), TH_W, TH_H, COLORS['c'][i])
png(os.path.join(BASE, 'home.png'), W, H, (24, 20, 30))
png(os.path.join(BASE, 'icon.png'), 192, 192, (185, 80, 121))
print('  图：背景 %d 张、立绘 %d 张、CG %d 张、缩略 2 张、主页 + 图标' %
      (len(bgs), len(sps), len(cgs)))

# ---------------------------------------------------------------- 3. 图片索引表
img = []
def add(path):
    img.append(path)
    return len(img) - 1

bg_map = {('b%d' % i): add(p) for i, p in enumerate(bgs)}
cg_idx = [add(p) for p in cgs]
sp_idx = [add(p) for p in sps]
sp_map = {}
for i, p in enumerate(sps):
    for slot in ('left', 'c', 'right'):
        sp_map['s%d|%s' % (i, slot)] = sp_idx[i]

io.open(os.path.join(BASE, 'assets.js'), 'w', encoding='utf-8', newline='\n').write(
    '// 由 tools/gen_demo.py 生成（占位内容），换成自己的素材时重新生成即可\n'
    'export const IMG = %s\n\n' % json.dumps(img, ensure_ascii=False, indent=2) +
    'export const BG = %s\n\n' % json.dumps(bg_map, ensure_ascii=False, indent=2) +
    'export const SP = %s\n' % json.dumps(sp_map, ensure_ascii=False, indent=2))

io.open(os.path.join(BASE, 'cglist.js'), 'w', encoding='utf-8', newline='\n').write(
    '// 由 tools/gen_demo.py 生成（占位内容）\n'
    'export const CGG = %s\n' % json.dumps([
        {"n": "占位 CG 组 A", "th": "/common/img/t/g0.png", "u": cg_idx[0], "im": cg_idx[:2]},
        {"n": "占位 CG 组 B", "th": "/common/img/t/g1.png", "u": cg_idx[2], "im": cg_idx[2:]},
    ], ensure_ascii=False))
print('  assets.js / cglist.js 已生成')

# ---------------------------------------------------------------- 4. 占位剧本
CH_SIZE = 40
CHAPS = [("demo_1", "第一章 · 占位"), ("demo_2", "第二章 · 还是占位")]
nodes = []
for ci, (cid, title) in enumerate(CHAPS):
    for i in range(CH_SIZE):
        if i == 0:
            nodes.append({"t": "s", "n": "", "x": "【%s】这里放你的剧本。" % title,
                          "bg": bg_map['b%d' % (ci % len(bgs))], "cs": []})
        elif i == 3:
            nodes.append({"t": "s", "n": "示例角色", "x": "这是一句占位台词。",
                          "cs": [{"k": "s0", "i": sp_idx[0], "s": "c"}]})
        elif i == 6:
            nodes.append({"t": "s", "n": "示例角色", "x": "引擎负责版面，你只管写台词。",
                          "cs": [{"k": "s0", "i": sp_idx[0], "s": "left"}]})
        elif i == 9:
            nodes.append({"t": "s", "n": "", "x": "换景会把立绘一起清掉（原作的 scene 语义）。",
                          "bg": bg_map['b%d' % ((ci + 1) % len(bgs))], "cs": []})
        elif i == 12:
            nodes.append({"t": "s", "n": "", "x": "这里放一张占位 CG。", "cg": cg_idx[0]})
        elif i == 15:
            nodes.append({"t": "s", "n": "", "x": "CG 收起。", "cg": -1})
        elif i == 18:
            nodes.append({"t": "o", "n": "", "x": "要往下走吗？",
                          "o": [{"t": "是", "j": len(nodes) + 2}, {"t": "否", "j": len(nodes) + 1}]})
        elif i == 19:
            nodes.append({"t": "j", "j": len(nodes) + 2})
        else:
            nodes.append({"t": "s", "n": "", "x": "第 %d 句占位。" % i})
nodes.append({"t": "e", "n": "", "x": "Demo 结束。把你的剧本接进来吧。"})

story = os.path.join(BASE, 'story')
os.makedirs(story, exist_ok=True)
chunks, chapters = [], []
for ci, (cid, title) in enumerate(CHAPS):
    part = nodes[ci * CH_SIZE:(ci + 1) * CH_SIZE]
    chunks.append({"file": "/common/story/chunk-%03d.txt" % ci, "start": ci * CH_SIZE, "count": len(part)})
    chapters.append({"id": cid, "title": title, "start": ci * CH_SIZE})
    io.open(os.path.join(story, 'chunk-%03d.txt' % ci), 'w', encoding='utf-8', newline='\n').write(
        json.dumps(part, ensure_ascii=False))

idx = {"ver": 1, "title": "Yurite Demo", "nodeCount": len(nodes), "chunkSize": CH_SIZE,
       "entry": 0, "chapters": chapters, "chunks": chunks}
io.open(os.path.join(story, 'index.txt'), 'w', encoding='utf-8', newline='\n').write(
    json.dumps(idx, ensure_ascii=False))
print('  剧本：%d 节点 / %d 章 / %d 分块' % (len(nodes), len(chapters), len(chunks)))
print('  完成')
