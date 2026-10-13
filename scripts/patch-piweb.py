# -*- coding: utf-8 -*-
"""
PiX pi-web 补丁（出厂行为）：推理级别菜单固定为 auto/low/medium/high。
幂等可重跑；pi-web 升级后（.next 产物被替换）重跑 install.mjs 即可。

v2（WP-F）：精确串匹配 → 正则匹配任意级别数组——上游把数组改成 6 项/7 项/任意
子集都能命中（旧版精确匹配 8 项串，pi-web 0.11.0 改 6 项后失效）；替换后自检；
明确提示"必须重启 pi-web + 浏览器强刷"（磁盘补了但老进程内存里还是旧 build——
第二轮跑批复盘 F8 的根因）。

用法: python patch-piweb.py
"""
import glob
import os
import re
import sys

NEW_LIST = '["auto","low","medium","high"]'
# 任意以 auto 开头、由 off/minimal/low/medium/high/xhigh/max 组成的数组字面量
PATTERN = re.compile(r'\["auto"(?:\s*,\s*"(?:off|minimal|low|medium|high|xhigh|max)")+\]')

# v3（2026-10-13 实锤漏网）：菜单数据源还有"全档序列"形态（不带 auto、以 off/minimal
# 开头的字符串化数组，如 page chunk 的 aZ='["off","minimal",...,"max"]'——后接每档配色
# 表与值选择器组件）。砍成 3 项（auto 由别处拼接 → 菜单合计 4 项）。
# 只匹配含 xhigh/max/minimal 的多档形态，避免误伤已是 3 项的目标形态。
NEW_LEVELS = '["low","medium","high"]'
PATTERN_LEVELS = re.compile(
    r'\["(?:off|minimal)"(?:\s*,\s*"(?:off|minimal|low|medium|high|xhigh|max)")+\]'
)


def npm_root():
    import subprocess
    out = subprocess.run(["npm", "root", "-g"], capture_output=True, text=True, shell=True)
    return out.stdout.strip()


def main():
    root = os.path.join(npm_root(), "@agegr", "pi-web", ".next")
    if not os.path.isdir(root):
        print("[!] 未找到 pi-web 安装目录:", root)
        sys.exit(1)

    patched = skipped = 0
    for pattern in ("static/chunks/**/*.js", "server/**/*.js"):
        for f in glob.glob(os.path.join(root, pattern), recursive=True):
            if os.sep + "cache" + os.sep in f:
                continue
            try:
                s = open(f, encoding="utf-8").read()
            except (UnicodeDecodeError, OSError):
                continue
            m = PATTERN.findall(s)
            m2 = PATTERN_LEVELS.findall(s)
            if not m and not m2:
                continue
            if all(x == NEW_LIST for x in m) and all(x == NEW_LEVELS for x in m2):
                skipped += 1
                continue
            s2 = PATTERN.sub(NEW_LIST, s)
            s2 = PATTERN_LEVELS.sub(NEW_LEVELS, s2)
            # 自检：替换后不得再有任何旧形态残留
            leftovers = [x for x in PATTERN.findall(s2) if x != NEW_LIST]
            leftovers += [x for x in PATTERN_LEVELS.findall(s2) if x != NEW_LEVELS]
            if leftovers:
                print("[!] 自检失败（仍有旧形态残留）:", os.path.relpath(f, root), leftovers[:2])
                sys.exit(2)
            open(f, "w", encoding="utf-8").write(s2)
            print("[+] patched:", os.path.relpath(f, root), "（auto 形态", len(m), "处 / 全档形态", len(m2), "处）")
            patched += 1

    if patched == 0 and skipped == 0:
        print("[!] 未匹配到目标代码——pi-web 版本可能变了，检查推理级别数组的字面量")
        sys.exit(2)
    print(f"完成: 新补丁 {patched} 处, 已是目标状态 {skipped} 处")
    strip_board_button(root)
    rebrand(root)
    print("⚠ 推理菜单生效前提：重启 pi-web 进程 + 浏览器强刷（Ctrl+Shift+R）——")
    print("  磁盘已补但运行中的 pi-web 内存里还是旧 build（F8 根因）。可执行 node scripts/install.mjs --restart-piweb")


# ---------------- 画板按钮剥除（2026-10-13 用户拍板移除画板可视化） ----------------
# 画板 UI 已整体下线（board-server/pix-board.mjs 删除）：这里只负责把历史上注入进
# pi-web chunk 的按钮脚本（v1/v2/v3 marker 块）清理干净，幂等可重跑。

def strip_board_button(root):
    """剥除 chunk 中所有 pix-board-button 注入块（v1/v2/v3 marker，幂等）。"""
    strip = re.compile(r"\n?/\* pix-board-button v[123] \*/.*?\}\)\(\);\n?", re.S)
    for f in glob.glob(os.path.join(root, "static", "chunks", "*.js")):
        try:
            s = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if "pix-board-button" not in s:
            continue
        s2 = strip.sub("\n", s)
        if s2 != s:
            open(f, "w", encoding="utf-8").write(s2)
            print("[-] 画板按钮注入已剥除:", os.path.relpath(f, root))


# ---------------- 品牌定制（2026-10-13 用户定稿）：版本双行保留，只换品牌名 Pi Web→PiX ----------------
# ① 底栏品牌名 children:"Pi Web" → "PiX"（主界面 + 登录页 h1）
# ② rsc 预渲染 title / PWA manifest 里的 "Pi Web" → "PiX"（标签页标题、安装名）
# ③ 动态标题兜底：title 文本中的 "Pi Web"/"piweb" → "PiX"（标题由后端运行时组装，
#    chunk 里搜不到模板——客户端 MutationObserver 兜底最稳）
# 版本号双行块（web v/pi v）保留不动（用户拍板：版本号可以保留）。
# 若此前跑过旧版 rebrand（版本块被替成 "PiX"），这里自动还原为真实版本双行。

BADGE_NEW = '{className:"new-session-versions",children:"PiX"}'


def _real_versions(root):
    """从安装包读真实版本号，用于还原版本双行块"""
    import json as _json
    web_ver = "0.11.0"
    pi_ver = "1.1.0"
    try:
        pkg = os.path.join(os.path.dirname(root), "package.json")
        web_ver = _json.load(open(pkg, encoding="utf-8"))["version"]
    except Exception:
        pass
    try:
        pkg = os.path.join(
            os.path.dirname(root), "node_modules", "@earendil-works", "pi-coding-agent", "package.json"
        )
        pi_ver = _json.load(open(pkg, encoding="utf-8"))["version"]
    except Exception:
        pass
    return web_ver, pi_ver


def _restore_badges(s, root):
    """旧版 rebrand 曾把版本块替成 BADGE_NEW —— 还原为真实版本双行结构"""
    if BADGE_NEW not in s:
        return s, False
    web_ver, pi_ver = _real_versions(root)
    # 从文件里现取 jsxs 的实际变量名（minified 产物）
    m = re.search(r"\(0,([\w$]+)\.jsxs\)\(\"div\"", s)
    v = m.group(1) if m else "r"
    original = (
        "{className:\"new-session-versions\",children:["
        f"(0,{v}.jsxs)(\"span\",{{children:[\"web \","
        f"(0,{v}.jsxs)(\"span\",{{className:\"new-session-version\",children:[\"v\",\"{web_ver}\"]}})]}}),"
        f"(0,{v}.jsxs)(\"span\",{{children:[\"pi \","
        f"(0,{v}.jsxs)(\"span\",{{className:\"new-session-version\",children:[\"v\",\"{pi_ver}\"]}})]}}"
        ")]}"
    )
    return s.replace(BADGE_NEW, original), True


def rebrand(root):
    brand_files = 0
    for f in glob.glob(os.path.join(root, "static", "chunks", "**", "*.js"), recursive=True):
        try:
            s = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        s2, restored = _restore_badges(s, root)
        n_brand = s2.count('children:"Pi Web"')
        s2 = s2.replace('children:"Pi Web"', 'children:"PiX"')
        if s2 != s:
            open(f, "w", encoding="utf-8").write(s2)
            print(
                "[+] 品牌:", os.path.relpath(f, root),
                f"（PiX×{n_brand}" + ("，版本块已还原" if restored else "") + "）",
            )
            brand_files += 1
    # server 全树（app 产物 / chunks SSR 代码 / middleware / pages）+ PWA manifest；
    # route-cache 是运行时渲染缓存——删掉让新进程按新代码重渲染（2026-10-13 实锤：
    # 只换 app/*.html 不清 route-cache 时，新起的 next server 仍吐缓存旧页）
    targets = []
    for ext in ("*.rsc", "*.html", "*.js"):
        targets += glob.glob(os.path.join(root, "server", "**", ext), recursive=True)
    for f in targets:
        if "node_modules" in f:
            continue
        try:
            s = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if "Pi Web" in s:
            open(f, "w", encoding="utf-8").write(s.replace('"Pi Web"', '"PiX"').replace("Pi Web", "PiX"))
            print("[+] 品牌(server):", os.path.relpath(f, root))
            brand_files += 1
    import shutil as _shutil
    rc = os.path.join(root, "server", "route-cache")
    if os.path.isdir(rc):
        _shutil.rmtree(rc, ignore_errors=True)
        print("[-] route-cache 已清（运行时缓存，按新代码重渲染）")
    if brand_files == 0:
        print("[=] 品牌已是目标状态")
    inject_title_fix(root)


# 动态标题兜底：title 里 "Pi Web"/"piweb" → "PiX"（后端运行时组装标题，客户端改最稳）
TITLE_FIX_MARKER = "/* pix-title-fix v1 */"
TITLE_FIX_SCRIPT = """/* pix-title-fix v1 */
(function(){
  var fix=function(){
    var t=document.title;
    var n=t.replace(/Pi ?Web/gi,'PiX');
    if(n!==t)document.title=n;
  };
  new MutationObserver(fix).observe(document.querySelector('title')||document.head,{subtree:true,childList:true,characterData:true});
  fix();
})();
"""


def inject_title_fix(root):
    """向含「新建会话」的 locale chunk 追加标题兜底脚本（marker 幂等）"""
    if not glob.glob(os.path.join(root, "static", "chunks")):
        return
    for f in glob.glob(os.path.join(root, "static", "chunks", "*.js")):
        try:
            s = open(f, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if TITLE_FIX_MARKER in s:
            return
        if "新建会话" in s or "New chat" in s:
            if not s.endswith("\n"):
                s += "\n"
            open(f, "w", encoding="utf-8").write(s + "\n" + TITLE_FIX_SCRIPT)
            print("[+] 标题兜底已注入:", os.path.relpath(f, root))
            return


if __name__ == "__main__":
    main()
