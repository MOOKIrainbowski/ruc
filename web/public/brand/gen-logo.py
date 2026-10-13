# 러크 서버 로고 — 정면 픽셀 글자 + 뒤로 뽑은 입체(블록) + 떠 있는 불씨 결정. SVG 생성기.
# 사용: python gen.py <출력 폴더>
import sys, os

# 굵은 픽셀 글리프 (획 2칸). 행 = 위→아래
BIG = {
    "R": ["XXXXX.", "XX..XX", "XX..XX", "XXXXX.", "XX.XX.", "XX..XX", "XX..XX"],
    "U": ["XX..XX", "XX..XX", "XX..XX", "XX..XX", "XX..XX", "XXXXXX", ".XXXX."],
    "C": [".XXXXX", "XXXXXX", "XX....", "XX....", "XX....", "XXXXXX", ".XXXXX"],
}
SMALL = {
    "S": ["XXX", "X..", "XXX", "..X", "XXX"],
    "E": ["XXX", "X..", "XXX", "X..", "XXX"],
    "R": ["XX.", "X.X", "XX.", "X.X", "X.X"],
    "V": ["X.X", "X.X", "X.X", "X.X", ".X."],
    "러": None,  # (예약 — 한글은 쓰지 않음)
}

EX, EY = 0.62, -0.62  # 뒤로 뽑는 방향 (오른쪽 위), 한 칸 기준

def cells(rows, ox=0, oy=0):
    return {(ox + c, oy + r) for r, row in enumerate(rows) for c, ch in enumerate(row) if ch == "X"}

def pts(ps, s):
    return " ".join("%.2f,%.2f" % (x * s, y * s) for x, y in ps)

def extrude(cs, depth):
    """입체 면. 윗면(가로로 이어진 칸끼리 한 장) · 오른쪽 면(세로로 이어진 칸끼리 한 장). 뒤(오른쪽 위)부터."""
    dx, dy = EX * depth, EY * depth
    faces = []
    # 윗면: 같은 줄에서 위가 비어 있는 칸들을 가로로 묶음
    for y in sorted({p[1] for p in cs}):
        xs = sorted(x for x, yy in cs if yy == y and (x, y - 1) not in cs)
        for a, b in runs(xs):
            faces.append((a - y, "top", [(a, y), (b, y), (b + dx, y + dy), (a + dx, y + dy)]))
    # 옆면: 같은 열 경계에서 오른쪽이 비어 있는 칸들을 세로로 묶음
    for x in sorted({p[0] for p in cs}):
        ys = sorted(y for xx, y in cs if xx == x and (x + 1, y) not in cs)
        for a, b in runs(ys):
            faces.append((x + 1 - a, "side", [(x + 1, a), (x + 1, b), (x + 1 + dx, b + dy), (x + 1 + dx, a + dy)]))
    faces.sort(key=lambda f: f[0], reverse=True)
    return [(k, ps) for _, k, ps in faces]

def runs(vals):
    """[1,2,3,5,6] → [(1,4),(5,7)] (끝은 미포함 +1)"""
    out = []
    for v in vals:
        if out and out[-1][1] == v:
            out[-1][1] = v + 1
        else:
            out.append([v, v + 1])
    return [tuple(r) for r in out]

def outline_rects(cs):
    """정면 — 칸을 가로로 이어 붙인 직사각형들 (이음매 없이 한 덩어리로 보이게)."""
    rects = []
    for y in sorted({p[1] for p in cs}):
        xs = sorted(p[0] for p in cs if p[1] == y)
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            rects.append((start, y, prev + 1 - start, 1))
            if x is not None:
                start = prev = x
    return rects

def front_path(cs, s):
    # 각 줄 직사각형을 0.02칸 겹쳐 그려 안티에일리어싱 틈을 없앱니다
    d = []
    for x, y, w, h in outline_rects(cs):
        e = 0.02
        d.append("M%.2f,%.2fh%.2fv%.2fh%.2fz" % ((x - e) * s, (y - e) * s, (w + 2 * e) * s, (h + 2 * e) * s, -(w + 2 * e) * s))
    return " ".join(d)

def gem(cx, cy, size, s):
    """불씨 결정 — 정면 정사각형 + 윗면 + 옆면 (같은 투영), 그리고 빛무리."""
    d = size * 0.9
    x, y = cx, cy
    top = [(x, y), (x + size, y), (x + size + EX * d, y + EY * d), (x + EX * d, y + EY * d)]
    side = [(x + size, y), (x + size, y + size), (x + size + EX * d, y + size + EY * d), (x + size + EX * d, y + EY * d)]
    front = [(x, y), (x + size, y), (x + size, y + size), (x, y + size)]
    mx, my = x + size * 0.5 + EX * d * 0.5, y + size * 0.5 + EY * d * 0.5
    return (
        f'<circle cx="{mx*s:.1f}" cy="{my*s:.1f}" r="{size*1.7*s:.1f}" fill="url(#glow)"/>'
        f'<polygon points="{pts(side, s)}" fill="#FF6A14"/>'
        f'<polygon points="{pts(top, s)}" fill="#FFF3C4"/>'
        f'<polygon points="{pts(front, s)}" fill="url(#gemFront)"/>'
        + "".join(f'<rect x="{(x+ex)*s:.1f}" y="{(y+ey)*s:.1f}" width="{w*s:.1f}" height="{w*s:.1f}" fill="{c}" opacity="{o}"/>'
                  for ex, ey, w, c, o in [(-0.95, 0.55, 0.32, "#FFB547", 0.9), (-0.55, -0.55, 0.22, "#FFD27A", 0.8),
                                          (size + 1.35, -0.35, 0.26, "#FF8A2B", 0.75), (0.35, -1.25, 0.18, "#FFE3A0", 0.7)])
        # 반짝임
        + f'<polygon points="{pts([(x+size*0.18,y+size*0.18),(x+size*0.42,y+size*0.18),(x+size*0.18,y+size*0.42)], s)}" fill="#FFFFFF" opacity="0.85"/>'
    )

def defs(y0, y1, s):
    return f"""<defs>
  <linearGradient id="front" gradientUnits="userSpaceOnUse" x1="0" y1="{y0*s}" x2="0" y2="{y1*s}">
    <stop offset="0" stop-color="#FF8F2E"/><stop offset="0.5" stop-color="#FF4A1F"/><stop offset="1" stop-color="#D81E1B"/>
  </linearGradient>
  <linearGradient id="top" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFC765"/><stop offset="1" stop-color="#FFA640"/></linearGradient>
  <linearGradient id="side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#A3161A"/><stop offset="1" stop-color="#5E0A10"/></linearGradient>
  <linearGradient id="gemFront" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset="1" stop-color="#FFA21F"/></linearGradient>
  <radialGradient id="glow"><stop offset="0" stop-color="#FFB13B" stop-opacity="0.55"/><stop offset="0.6" stop-color="#FF6A1F" stop-opacity="0.12"/><stop offset="1" stop-color="#FF5A1F" stop-opacity="0"/></radialGradient>
</defs>"""

def glyph_svg(cs, s, depth):
    out = []
    for kind, ps in extrude(cs, depth):
        out.append(f'<polygon points="{pts(ps, s)}" fill="url(#{kind})"/>')
    out.append(f'<path d="{front_path(cs, s)}" fill="url(#front)"/>')
    hl = []
    for y in sorted({p[1] for p in cs}):
        for a, b in runs(sorted(x for x, yy in cs if yy == y and (x, y - 1) not in cs)):
            hl.append(f'<rect x="{a*s:.2f}" y="{y*s:.2f}" width="{(b-a)*s:.2f}" height="{0.14*s:.2f}"/>')
    out.append('<g fill="#FFD27A" opacity="0.9">' + "".join(hl) + '</g>')
    return "".join(out)

def svg(view, body):
    x, y, w, h = view
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.1f} {y:.1f} {w:.1f} {h:.1f}">{body}</svg>'

S = 20

def mark(tile=False):
    cs = cells(BIG["R"])
    depth = 1.6
    body = defs(0, 7, S) + gem(6.55, -1.9, 1.35, S) + glyph_svg(cs, S, depth)
    # 보이는 범위: 글자 0..6 x 0..7, 입체 + 결정
    x0, y0, x1, y1 = -0.6, -4.4, 10.6, 7.6
    if tile:
        # 정사각형 앱 아이콘 (디스코드 서버 아이콘 · 파비콘). 내용을 가운데에
        side = max(x1 - x0, y1 - y0) + 1.8
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 0.2
        tx, ty = cx - side / 2, cy - side / 2
        bg = (f'<rect x="{tx*S:.1f}" y="{ty*S:.1f}" width="{side*S:.1f}" height="{side*S:.1f}" rx="{side*0.22*S:.1f}" fill="url(#tileBg)"/>'
              f'<defs><radialGradient id="tileBg" cx="0.5" cy="0.35" r="0.75"><stop offset="0" stop-color="#2A0F0A"/><stop offset="1" stop-color="#120605"/></radialGradient></defs>')
        return svg((tx * S, ty * S, side * S, side * S), bg + body)
    return svg((x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S), body)

def wordmark(with_mark=True, light=False):
    depth = 1.6
    gap = 1.6
    x = 0
    big = set()
    for ch in "RUC":
        big |= cells(BIG[ch], ox=x)
        x += 6 + gap
    width = x - gap
    # SERVER — 작은 글자, 납작(입체 없음), RUC 아래 가운데 정렬
    sm, sx = set(), 0
    word = "SERVER"
    k = 0.5  # 작은 글자 한 칸 = 큰 칸의 절반
    total = (len(word) * 3 + (len(word) - 1) * 1.6)
    start = (width / k - total) / 2
    for ch in word:
        sm |= cells(SMALL[ch], ox=start + sx, oy=0)
        sx += 3 + 1.6
    sub_y = 7 + 1.6
    small_rects = "".join(
        f'<rect x="{(x0*k)*S-0.3:.2f}" y="{(sub_y + y0*k)*S-0.3:.2f}" width="{w*k*S+0.6:.2f}" height="{k*S+0.6:.2f}"/>'
        for x0, y0, w, _ in outline_rects(sm)
    )
    sub_color = "#3A1410" if light else "#FFD9B8"
    line_y = (sub_y + 2 * k) * S
    l0 = (start - 1.6 - 6) * k * S
    r0 = (start + total + 1.6) * k * S
    small_rects += (f'<rect x="{max(0, l0):.1f}" y="{line_y:.1f}" width="{(start - 1.6) * k * S - max(0, l0):.1f}" height="{k*S:.1f}" opacity="0.55"/>'
                    f'<rect x="{r0:.1f}" y="{line_y:.1f}" width="{min(width*S, r0 + 6*k*S) - r0:.1f}" height="{k*S:.1f}" opacity="0.55"/>')
    body = defs(0, 7, S) + gem(width + 0.5, -1.9, 1.35, S) + glyph_svg(big, S, depth)
    body += f'<g fill="{sub_color}">{small_rects}</g>'
    x0, y0, x1, y1 = -0.6, -4.4, width + 4.6, sub_y + 5 * k + 0.6
    return svg((x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S), body)

if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "ruc-mark.svg"), "w", encoding="utf-8").write(mark())
    open(os.path.join(out, "ruc-mark-tile.svg"), "w", encoding="utf-8").write(mark(tile=True))
    open(os.path.join(out, "ruc-logo.svg"), "w", encoding="utf-8").write(wordmark())
    open(os.path.join(out, "ruc-logo-light.svg"), "w", encoding="utf-8").write(wordmark(light=True))
