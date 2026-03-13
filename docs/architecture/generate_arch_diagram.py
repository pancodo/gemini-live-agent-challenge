#!/usr/bin/env python3
"""
AI Historian — Architecture Diagram Generator  (v2 — refined)
"""

from PIL import Image, ImageDraw, ImageFont
import math, os

FONT_DIR = os.path.expanduser("~/.claude/skills/canvas-design/canvas-fonts")

def load(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)

# ── Canvas ───────────────────────────────────────────────────────────────────
W, H = 3200, 2200
img = Image.new("RGB", (W, H), "#07050300")
d   = ImageDraw.Draw(img)

# ── Palette ──────────────────────────────────────────────────────────────────
BG_DEEP   = "#080604"
BG_CARD   = "#120f0b"
BG_PANEL  = "#1a1510"
GOLD      = "#c4956a"
GOLD_DIM  = "#8B6020"
GOLD_PALE = "#d4a574"
TEAL      = "#2a8080"
GREEN     = "#2E6E44"
BLUE      = "#2a4e8a"
PURPLE    = "#6a4a8a"
RUST      = "#8a4a28"
MUTED     = "#6a5a44"
TEXT      = "#e8dcc8"
TEXT_DIM  = "#9a8a72"
BORDER    = "#2e2418"
DIVIDER   = "#1c170f"

# ── Fonts ────────────────────────────────────────────────────────────────────
f_hero    = load("Gloock-Regular.ttf",          72)
f_sub     = load("InstrumentSans-Regular.ttf",  21)
f_label   = load("InstrumentSans-Bold.ttf",     23)
f_body    = load("InstrumentSans-Regular.ttf",  18)
f_small   = load("InstrumentSans-Regular.ttf",  16)
f_section = load("InstrumentSans-Bold.ttf",     17)
f_mono    = load("JetBrainsMono-Regular.ttf",   16)
f_mono_sm = load("JetBrainsMono-Regular.ttf",   13)
f_layer   = load("InstrumentSans-Bold.ttf",     15)

# ── Primitive helpers ─────────────────────────────────────────────────────────
def rr(draw, box, r=14, fill=None, outline=None, w=1):
    draw.rounded_rectangle(list(box), radius=r, fill=fill, outline=outline, width=w)

def cx_text(draw, text, cx, cy, font, fill=TEXT):
    bb = draw.textbbox((0, 0), text, font=font)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    draw.text((cx - tw//2, cy - th//2), text, font=font, fill=fill)

def arrow(draw, x0, y0, x1, y1, color, width=2, head=9):
    draw.line([(x0, y0), (x1, y1)], fill=color, width=width)
    ang = math.atan2(y1-y0, x1-x0)
    for da in (0.42, -0.42):
        ax = x1 - head * math.cos(ang - da)
        ay = y1 - head * math.sin(ang - da)
        draw.line([(x1, y1), (ax, ay)], fill=color, width=width)

def bidir(draw, x0, y0, x1, y1, color, width=2, head=8):
    draw.line([(x0, y0), (x1, y1)], fill=color, width=width)
    ang = math.atan2(y1-y0, x1-x0)
    for da in (0.42, -0.42):
        ax = x0 + head * math.cos(ang - da)
        ay = y0 + head * math.sin(ang - da)
        draw.line([(x0, y0), (ax, ay)], fill=color, width=width)
        bx = x1 - head * math.cos(ang - da)
        by = y1 - head * math.sin(ang - da)
        draw.line([(x1, y1), (bx, by)], fill=color, width=width)

def pill_label(draw, text, cx, cy, font=f_mono_sm, fill=TEXT_DIM, bg="#0d0a07"):
    bb = draw.textbbox((0, 0), text, font=font)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    pad = 8
    draw.rounded_rectangle(
        [cx-tw//2-pad, cy-th//2-3, cx+tw//2+pad, cy+th//2+3],
        radius=5, fill=bg, outline=BORDER, width=1)
    cx_text(draw, text, cx, cy, font, fill)

def service_card(draw, box, title, tech, items, col, badge=None):
    x0, y0, x1, y1 = box
    rr(draw, box, r=14, fill=col+"18", outline=col+"55", w=1)
    draw.rounded_rectangle([x0+1, y0+1, x1-1, y0+5], radius=2, fill=col+"cc")
    draw.text((x0+20, y0+18), title, font=f_label, fill=col)
    if badge:
        bb = draw.textbbox((0,0), badge, font=f_mono_sm)
        bw = bb[2]-bb[0]+16
        bx = x1 - bw - 14
        draw.rounded_rectangle([bx, y0+16, bx+bw, y0+36], radius=4,
                                fill=col+"30", outline=col+"66", width=1)
        draw.text((bx+8, y0+18), badge, font=f_mono_sm, fill=col)
    draw.text((x0+20, y0+46), tech, font=f_mono_sm, fill=MUTED)
    draw.line([(x0+20, y0+66), (x1-20, y0+66)], fill=col+"33", width=1)
    for i, item in enumerate(items):
        draw.text((x0+26, y0+78+i*27), "·  "+item, font=f_body, fill=TEXT_DIM)

# ── Background ────────────────────────────────────────────────────────────────
d.rectangle([0, 0, W, H], fill=BG_DEEP)

# Subtle grid
for y in range(0, H, 52): d.line([(0,y),(W,y)], fill="#0c0a08", width=1)
for x in range(0, W, 52): d.line([(x,0),(x,H)], fill="#0c0a08", width=1)

# ── Header ────────────────────────────────────────────────────────────────────
d.rectangle([0, 0, W, 118], fill="#0c0a07")
d.line([(0,118),(W,118)], fill=GOLD_DIM+"66", width=1)

cx_text(d, "AI HISTORIAN", W//2, 46, f_hero, GOLD_PALE)
cx_text(d, "SYSTEM ARCHITECTURE  ·  GEMINI LIVE AGENT CHALLENGE  ·  CREATIVE STORYTELLERS", W//2, 91, f_sub, TEXT_DIM)

# decorative side marks
for dx in (-W//2+100, W//2-100):
    d.line([(W//2+dx-30, 46),(W//2+dx-8, 46)], fill=GOLD_DIM+"66", width=1)
    d.line([(W//2+dx+8, 46),(W//2+dx+30, 46)], fill=GOLD_DIM+"66", width=1)
    d.ellipse([W//2+dx-5, 41, W//2+dx+5, 51], fill=GOLD_DIM+"88")

# ── Layer band labels (left sidebar) ─────────────────────────────────────────
SIDEBAR_W  = 150
layer_bands = [
    (145, "BROWSER"),
    (508, "CLOUD RUN"),
    (798, "ADK PIPELINE"),
    (1205, "GEMINI  &  VERTEX AI"),
    (1595, "STORAGE  &  DATA"),
    (1875, "INFRA"),
]
for ly, lb in layer_bands:
    bb = d.textbbox((0,0), lb, font=f_layer)
    tw = bb[2]-bb[0]
    d.text((40, ly), lb, font=f_layer, fill=GOLD_DIM+"88")
    d.line([(40, ly+22),(40+tw, ly+22)], fill=GOLD_DIM+"33", width=1)

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS for all panels
# ─────────────────────────────────────────────────────────────────────────────
MARGIN = 200   # left / right margin for full-width panels

# ═══════════════════════════════════════════════════════════════════════════════
# L1 — BROWSER  (y 168 → 448)
# ═══════════════════════════════════════════════════════════════════════════════
BRW_Y0, BRW_Y1 = 168, 452
rr(d, [MARGIN, BRW_Y0, W-MARGIN, BRW_Y1], r=18, fill="#121008", outline=GOLD_DIM+"44", w=1)
d.text((MARGIN+32, BRW_Y0+18), "BROWSER", font=f_label, fill=GOLD_PALE)
d.text((MARGIN+32, BRW_Y0+46), "React 19  ·  TypeScript  ·  Vite 6  ·  Tailwind v4  ·  Zustand 5  ·  TanStack Query v5  ·  Motion 12", font=f_mono_sm, fill=MUTED)

brw_panels = [
    ("PDF VIEWER",         "pdfjs-dist\nEntity highlighting\nScrollable",     BLUE),
    ("RESEARCH PANEL",     "Living agent cards\nSSE stream events\nAnimatePresence", TEAL),
    ("DOCUMENTARY PLAYER", "Ken Burns · Captions\nAudio-reactive visuals\nView Transitions", GREEN),
    ("VOICE BUTTON",       "Web Audio API\n16kHz PCM capture\nWaveform canvas", RUST),
]
PW = (W - MARGIN*2 - 80 - 48) // 4
for i, (t, sub, col) in enumerate(brw_panels):
    px = MARGIN + 40 + i*(PW+16)
    py = BRW_Y0 + 76
    ph = 240
    rr(d, [px, py, px+PW, py+ph], r=10, fill=col+"1a", outline=col+"55", w=1)
    d.rounded_rectangle([px+1, py+1, px+PW-1, py+5], radius=2, fill=col+"bb")
    d.text((px+16, py+16), t, font=f_section, fill=col)
    d.line([(px+16, py+40),(px+PW-16, py+40)], fill=col+"33", width=1)
    y = py+52
    for line in sub.split("\n"):
        d.text((px+16, y), line, font=f_mono_sm, fill=TEXT_DIM); y+=22

# Zustand pill strip
stores_z = ["sessionStore","researchStore","voiceStore","playerStore"]
zx = MARGIN+40; zy = BRW_Y1-40
for s in stores_z:
    bb = d.textbbox((0,0), s, font=f_mono_sm); sw=bb[2]-bb[0]+20
    d.rounded_rectangle([zx, zy, zx+sw, zy+24], radius=5, fill=GOLD_DIM+"22", outline=GOLD_DIM+"55", width=1)
    d.text((zx+10, zy+4), s, font=f_mono_sm, fill=GOLD_DIM); zx+=sw+10

# ═══════════════════════════════════════════════════════════════════════════════
# L2 — CLOUD RUN SERVICES  (y 526 → 764)
# ═══════════════════════════════════════════════════════════════════════════════
CRS_Y0, CRS_Y1 = 526, 768
CRS_GAP = 36
CRS_W   = (W - MARGIN*2 - CRS_GAP*2) // 3

svc_data = [
    ("historian-api",       "FastAPI  ·  Python 3.12  ·  2 vCPU / 2 Gi",
     ["Session management","Signed GCS upload URLs","REST API gateway","SSE event proxy"], TEAL, "Cloud Run"),
    ("agent-orchestrator",  "ADK  ·  Python 3.12  ·  4 vCPU / 4 Gi",
     ["Full 5-phase ADK pipeline","SSE streaming to browser","Firestore writes","Pub/Sub integration"], GOLD_DIM, "Cloud Run"),
    ("live-relay",          "Node.js 20  ·  1 vCPU / 1 Gi",
     ["Gemini Live WebSocket proxy","PCM audio relay (16kHz→24kHz)","Interruption handling","Session resumption token"], RUST, "Cloud Run"),
]

# Service cards: use only left 2/3 of available width, leaving room for legend
SVC_TOTAL_W = W - MARGIN*2
LEG_W = 340
SVC_AREA_W  = SVC_TOTAL_W - LEG_W - 40   # cards live in left portion
CRS_W_ADJ   = (SVC_AREA_W - CRS_GAP*2) // 3

svc_cx = []
for i,(name,tech,items,col,badge) in enumerate(svc_data):
    sx = MARGIN + i*(CRS_W_ADJ+CRS_GAP)
    service_card(d, (sx, CRS_Y0, sx+CRS_W_ADJ, CRS_Y1), name, tech, items, col, badge)
    svc_cx.append(sx + CRS_W_ADJ//2)
# Patch CRS_W used later by connection arrows
CRS_W = CRS_W_ADJ

# Connection type legend — flush to right edge, vertically centred in Cloud Run band
LEG_X = W - MARGIN - LEG_W
LEG_Y = CRS_Y0
LEG_H = CRS_Y1 - CRS_Y0
rr(d, [LEG_X, LEG_Y, LEG_X+LEG_W, LEG_Y+LEG_H], r=12, fill="#0f0d0a", outline=BORDER, w=1)
d.text((LEG_X+18, LEG_Y+14), "CONNECTION TYPES", font=f_section, fill=GOLD_DIM)
d.line([(LEG_X+18, LEG_Y+36),(LEG_X+LEG_W-18, LEG_Y+36)], fill=GOLD_DIM+"33", width=1)
leg_items = [
    ("◀──▶", "REST + SSE  (historian-api)",   TEAL),
    ("◀──▶", "WebSocket  (live-relay)",         RUST),
    ("──▶",  "pipeline trigger",               GOLD_DIM),
    ("──▶",  "ADK run_async  (Gemini)",        TEAL),
    ("──▶",  "Imagen 3 · Veo 2  (Vertex AI)", RUST),
    ("──▶",  "Firestore state writes",         GREEN),
    ("──▶",  "OCR  (Document AI)",             BLUE),
]
for k,(sym,lbl,col) in enumerate(leg_items):
    ky = LEG_Y+46+k*26
    d.text((LEG_X+18, ky), sym, font=f_mono_sm, fill=col)
    d.text((LEG_X+82, ky), lbl, font=f_small, fill=TEXT_DIM)

# ═══════════════════════════════════════════════════════════════════════════════
# L3 — ADK PIPELINE  (y 820 → 1130)
# ═══════════════════════════════════════════════════════════════════════════════
PIPE_Y0, PIPE_Y1 = 820, 1148
rr(d, [MARGIN, PIPE_Y0, W-MARGIN, PIPE_Y1], r=16, fill="#100e0a", outline=GOLD_DIM+"2a", w=1)
d.text((MARGIN+32, PIPE_Y0+18), "ADK PIPELINE  ·  SequentialAgent", font=f_label, fill=GOLD_DIM)
d.text((MARGIN+32, PIPE_Y0+46), "google-adk  ·  agent-orchestrator  ·  BaseAgent subclass per phase", font=f_mono_sm, fill=MUTED)

phases = [
    ("I",  "DOCUMENT\nANALYZER",  "OCR → Chunks\nNarrative Curator\nvisual_bible output",   BLUE),
    ("II", "SCENE\nRESEARCH",     "ParallelAgent\nN × google_search\nper scene brief",        TEAL),
    ("III","SCRIPT\nAGENT",       "gemini-2.0-pro\nSegmentScript array\nFirestore writes",    GREEN),
    ("IV", "VISUAL\nRESEARCH",    "Source evaluation\nhttpx · Wikipedia\nDoc AI inline",      "#7a6a28"),
    ("V",  "VISUAL\nDIRECTOR",    "Imagen 3 frames\nVeo 2 LRO poll\nGCS output_gcs_uri",     RUST),
]
PH_W   = (W - MARGIN*2 - 80 - 20*4) // 5
PH_H   = 236
PH_Y0  = PIPE_Y0 + 80
ph_cx  = []

for i,(num,name,desc,col) in enumerate(phases):
    px = MARGIN + 40 + i*(PH_W+20)
    rr(d, [px, PH_Y0, px+PH_W, PH_Y0+PH_H], r=10, fill=col+"1e", outline=col+"66", w=1)
    # phase badge
    d.ellipse([px+14, PH_Y0+12, px+42, PH_Y0+40], fill=col+"99")
    cx_text(d, num, px+28, PH_Y0+26, f_section, TEXT)
    y = PH_Y0+50
    for line in name.split("\n"):
        d.text((px+14, y), line, font=f_label, fill=col); y+=28
    y+=6
    d.line([(px+14, y),(px+PH_W-14, y)], fill=col+"33", width=1); y+=10
    for line in desc.split("\n"):
        d.text((px+14, y), line, font=f_mono_sm, fill=TEXT_DIM); y+=22
    cx = px + PH_W//2
    ph_cx.append(cx)
    if i < len(phases)-1:
        ax0 = px+PH_W+2; ax1 = ax0+16; ay = PH_Y0+PH_H//2
        arrow(d, ax0, ay, ax1, ay, GOLD_DIM+"77", width=2, head=7)

# ═══════════════════════════════════════════════════════════════════════════════
# L4 — GOOGLE AI MODELS  (y 1222 → 1518)
# ═══════════════════════════════════════════════════════════════════════════════
AI_Y0, AI_Y1 = 1222, 1532
AI_W  = (W - MARGIN*2 - 60) // 3

ai_data = [
    ("GEMINI LIVE API",
     "gemini-2.5-flash-native-audio-preview-12-2025",
     ["Historian persona  ·  always-on",
      "Real-time voice conversation",
      "Interruption: serverContent.interrupted",
      "Session resumption token (2h TTL)",
      "Context window compression"],
     "#4a72aa",
     "wss://generativelanguage.googleapis.com/ws/..."),

    ("GEMINI  (via ADK)",
     "gemini-2.0-flash  ·  gemini-2.0-pro",
     ["Scan / research agents (flash)",
      "N parallel google_search subagents",
      "Script agent (pro)  ·  Aggregator (flash)",
      "Google Search grounding",
      "output_key → session.state[key]"],
     TEAL,
     "google-adk  ·  google-genai SDK  ·  Agent / ParallelAgent"),

    ("VERTEX AI",
     "Imagen 3  ·  Veo 2",
     ["imagen-3.0-fast-generate-001",
      "~5s / frame  ·  4 frames per scene",
      "veo-2.0-generate-001  (async LRO)",
      "output_gcs_uri required on Vertex",
      "client.operations.get  (sync via executor)"],
     "#9a5030",
     "genai.Client(vertexai=True, project=..., location='us-central1')"),
]

ai_boxes = []
for i,(title,sub,items,col,note) in enumerate(ai_data):
    ax = MARGIN + i*(AI_W+30)
    rr(d, [ax, AI_Y0, ax+AI_W, AI_Y1], r=14, fill=col+"1c", outline=col+"66", w=1)
    d.rounded_rectangle([ax+1, AI_Y0+1, ax+AI_W-1, AI_Y0+5], radius=2, fill=col+"cc")
    d.text((ax+20, AI_Y0+18), title, font=f_label, fill=col)
    d.text((ax+20, AI_Y0+46), sub,   font=f_mono_sm, fill=MUTED)
    d.line([(ax+20, AI_Y0+68),(ax+AI_W-20, AI_Y0+68)], fill=col+"33", width=1)
    for j,item in enumerate(items):
        d.text((ax+26, AI_Y0+80+j*27), "·  "+item, font=f_body, fill=TEXT_DIM)
    d.text((ax+20, AI_Y1-36), note, font=f_mono_sm, fill=col+"88")
    ai_boxes.append((ax, AI_Y0, ax+AI_W, AI_Y1))

ai_cx = [(b[0]+b[2])//2 for b in ai_boxes]

# ═══════════════════════════════════════════════════════════════════════════════
# L5 — STORAGE & DATA  (y 1612 → 1840)
# ═══════════════════════════════════════════════════════════════════════════════
ST_Y0, ST_Y1 = 1612, 1848
stores_data = [
    ("FIRESTORE",       "#4a7a6a", ["Session & agent state","Segment metadata","Visual manifests","liveSession tokens"]),
    ("CLOUD STORAGE",   TEAL,      ["Uploaded documents","OCR text (GCS path)","Imagen 3 PNG frames","Veo 2 MP4 clips"]),
    ("DOCUMENT AI",     BLUE,      ["Multilingual OCR","OCR_PROCESSOR","Async process_document","PDF + image input"]),
    ("PUB/SUB",         "#7a6a28", ["Async pipeline events","Agent progress fanout","Cross-service messaging"]),
    ("SECRET MANAGER",  PURPLE,    ["API keys","Service credentials","Injected as env vars"]),
]
ST_W  = (W - MARGIN*2 - 40*(len(stores_data)-1)) // len(stores_data)
st_cx = []
for i,(name,col,items) in enumerate(stores_data):
    sx = MARGIN + i*(ST_W+40)
    rr(d, [sx, ST_Y0, sx+ST_W, ST_Y1], r=12, fill=col+"18", outline=col+"55", w=1)
    d.text((sx+16, ST_Y0+14), name, font=f_section, fill=col)
    d.line([(sx+16, ST_Y0+38),(sx+ST_W-16, ST_Y0+38)], fill=col+"33", width=1)
    for j,item in enumerate(items):
        d.text((sx+16, ST_Y0+50+j*27), "·  "+item, font=f_body, fill=TEXT_DIM)
    st_cx.append(sx + ST_W//2)

# ═══════════════════════════════════════════════════════════════════════════════
# L6 — INFRASTRUCTURE  (y 1900 → 2098)
# ═══════════════════════════════════════════════════════════════════════════════
INF_Y0, INF_Y1 = 1900, 2098
rr(d, [MARGIN, INF_Y0, W-MARGIN, INF_Y1], r=14, fill="#0f0d0a", outline=GOLD_DIM+"22", w=1)
infra_items = [
    ("CLOUD RUN",         "3 services  ·  Python 3.12 + Node.js 20\nauto-scaling  ·  us-central1"),
    ("TERRAFORM",         "IaC  ·  terraform apply provisions all infra\nSecret Manager · Cloud Run · Firestore · GCS"),
    ("ADK DEPLOY",        "adk deploy cloud_run\n--project --region us-central1 --service_name"),
    ("GOOGLE GENAI SDK",  "google-adk  ·  google-genai  ·  google-cloud-documentai\ngoogle-cloud-firestore  ·  google-cloud-storage"),
]
IW = (W - MARGIN*2 - 60*(len(infra_items)-1)) // len(infra_items)
for i,(k,v) in enumerate(infra_items):
    ix = MARGIN+20 + i*(IW+20)
    d.text((ix, INF_Y0+20), k, font=f_section, fill=GOLD_DIM)
    y=INF_Y0+46
    for line in v.split("\n"):
        d.text((ix, y), line, font=f_mono_sm, fill=TEXT_DIM); y+=22
    if i < len(infra_items)-1:
        d.line([(ix+IW+10, INF_Y0+16),(ix+IW+10, INF_Y1-16)], fill=BORDER, width=1)

# ═══════════════════════════════════════════════════════════════════════════════
# CONNECTION ARROWS  — carefully routed to avoid overlap
# ═══════════════════════════════════════════════════════════════════════════════

# 1. Browser ↔ historian-api  (REST + SSE)
hx = svc_cx[0]
bidir(d, hx, BRW_Y1+4, hx, CRS_Y0-4, TEAL+"bb", width=2)
pill_label(d, "REST + SSE", hx-2, (BRW_Y1+CRS_Y0)//2)

# 2. Browser ↔ live-relay  (WebSocket) — right side
lx = svc_cx[2]
bidir(d, lx, BRW_Y1+4, lx, CRS_Y0-4, RUST+"bb", width=2)
pill_label(d, "WebSocket", lx+2, (BRW_Y1+CRS_Y0)//2)

# 3. historian-api ──▶ agent-orchestrator  (trigger)
# route: right edge of historian → left edge of orchestrator, same y mid
hist_right  = MARGIN + CRS_W - 2
orch_left   = MARGIN + CRS_W + CRS_GAP + 2
mid_y       = (CRS_Y0 + CRS_Y1) // 2
arrow(d, hist_right, mid_y, orch_left, mid_y, GOLD_DIM+"bb", width=2)
pill_label(d, "trigger pipeline", (hist_right+orch_left)//2, mid_y-18)

# 4. agent-orchestrator ──▶ ADK Pipeline
orch_cx = svc_cx[1]
arrow(d, orch_cx, CRS_Y1+4, orch_cx, PIPE_Y0-4, GOLD_DIM+"88", width=2)

# 5. ADK Pipeline phase II → Gemini ADK  (main research calls)
# straight down from Phase II center
arrow(d, ph_cx[1], PIPE_Y1+4, ai_cx[1], AI_Y0-4, TEAL+"88", width=2)
pill_label(d, "ADK run_async", (ph_cx[1]+ai_cx[1])//2, PIPE_Y1+28)

# 6. ADK Pipeline phase III → Gemini ADK  (script agent)
# angled: ph[2] bottom → ai[1] top, offset to avoid overlap
x_mid_35 = (ph_cx[2]*2+ai_cx[1])//3
arrow(d, ph_cx[2], PIPE_Y1+4, ai_cx[1]+40, AI_Y0-4, TEAL+"55", width=2)

# 7. ADK Pipeline phase V → Vertex AI  (Imagen + Veo)
arrow(d, ph_cx[4], PIPE_Y1+4, ai_cx[2], AI_Y0-4, RUST+"88", width=2)
pill_label(d, "Imagen 3 · Veo 2", (ph_cx[4]+ai_cx[2])//2-10, PIPE_Y1+28)

# 8. live-relay ↔ Gemini Live
# route: from relay bottom, angled left-down to Gemini Live box top
relay_bottom_x = svc_cx[2]
live_top_x     = ai_cx[0]
# draw elbow: down to bridge y, then left to target x, then down
bridge_y = CRS_Y1 + 80
d.line([(relay_bottom_x, CRS_Y1+4),(relay_bottom_x, bridge_y)], fill=RUST+"99", width=2)
d.line([(relay_bottom_x, bridge_y),(live_top_x, bridge_y)], fill=RUST+"99", width=2)
arrow(d, live_top_x, bridge_y, live_top_x, AI_Y0-4, RUST+"99", width=2)
pill_label(d, "wss://  WebSocket", (relay_bottom_x+live_top_x)//2, bridge_y-16)

# 9. Phase I → Document AI  (OCR)
docai_cx = st_cx[2]
ph1_x = ph_cx[0]
# elbow from ph1 bottom → storage row
bridge2_y = AI_Y0 - 40
d.line([(ph1_x, PIPE_Y1+4),(ph1_x, bridge2_y)], fill=BLUE+"66", width=2)
d.line([(ph1_x, bridge2_y),(docai_cx, bridge2_y)], fill=BLUE+"66", width=2)
arrow(d, docai_cx, bridge2_y, docai_cx, ST_Y0-4, BLUE+"88", width=2)
pill_label(d, "OCR", (ph1_x+docai_cx)//2, bridge2_y-16)

# 10. agent-orchestrator → Firestore
fire_cx = st_cx[0]
# elbow: down past AI layer, then curve to firestore
bridge3_y = AI_Y1 + 40
d.line([(orch_cx, AI_Y0+4),(orch_cx, bridge3_y)], fill=GREEN+"66", width=2)
d.line([(orch_cx, bridge3_y),(fire_cx, bridge3_y)], fill=GREEN+"66", width=2)
arrow(d, fire_cx, bridge3_y, fire_cx, ST_Y0-4, GREEN+"88", width=2)
pill_label(d, "session state", (orch_cx+fire_cx)//2, bridge3_y-16)

# 11. Vertex AI → GCS
gcs_cx = st_cx[1]
arrow(d, ai_cx[2], AI_Y1+4, gcs_cx, ST_Y0-4, RUST+"88", width=2)
pill_label(d, "output_gcs_uri", (ai_cx[2]+gcs_cx)//2, (AI_Y1+ST_Y0)//2)

# ═══════════════════════════════════════════════════════════════════════════════
# OUTER FRAME
# ═══════════════════════════════════════════════════════════════════════════════
d.rounded_rectangle([5, 5, W-5, H-5], radius=24, outline=GOLD_DIM+"44", width=1)
d.rounded_rectangle([13, 13, W-13, H-13], radius=20, outline=GOLD_DIM+"1a", width=1)

# BOTTOM CREDIT
bottom = "github.com/pancodo/gemini-live-agent-challenge  ·  Cloud Run · Vertex AI · Firestore · Document AI · Pub/Sub · Secret Manager"
cx_text(d, bottom, W//2, H-22, f_mono_sm, MUTED+"88")

# ═══════════════════════════════════════════════════════════════════════════════
# SAVE
# ═══════════════════════════════════════════════════════════════════════════════
OUT = "/Users/efecelik/gemini-live-hackathon-idea/docs/architecture/architecture-diagram.png"
img.save(OUT, "PNG", dpi=(144, 144))
print(f"Saved → {OUT}  ({W}×{H})")
