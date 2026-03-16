#!/usr/bin/env python3
"""AI Historian — Detailed Architecture Diagram (v3 — light, detailed, clean)"""

from PIL import Image, ImageDraw, ImageFont
import math
import os

# ── Canvas ────────────────────────────────────────────────────────────────────
W, H = 2200, 2400
BG = "#FAFAFA"

# ── Colors ────────────────────────────────────────────────────────────────────
WHITE = "#FFFFFF"
BORDER = "#D4D4D4"
TEXT_DARK = "#1A1A1A"
TEXT_MED = "#444444"
TEXT_LIGHT = "#888888"
TEXT_PHASE = "#666666"
ARROW_PRIMARY = "#444444"
ARROW_SECONDARY = "#B0B0B0"
ARROW_VOICE = "#1D7D8A"

BAND_FRONTEND = "#EBF4FF"
BAND_BACKEND = "#EBF9EF"
BAND_PIPELINE = "#FFF8EB"
BAND_AI = "#F3EDFF"
BAND_INFRA = "#F5F2EE"
BAND_VOICE = "#E8F6F8"

ACCENT_BLUE = "#2563EB"
ACCENT_GREEN = "#16A34A"
ACCENT_AMBER = "#D97706"
ACCENT_PURPLE = "#7C3AED"
ACCENT_WARM = "#92735A"
ACCENT_TEAL = "#0D9488"

PHASE_BG = "#FFFDF7"
PHASE_BORDER = "#E8DCC8"

# ── Fonts ─────────────────────────────────────────────────────────────────────
def load_font(size, bold=False):
    paths = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
    ]
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (IOError, OSError):
            continue
    return ImageFont.load_default()

FONT_TITLE = load_font(38, bold=True)
FONT_SUBTITLE = load_font(16)
FONT_BOX_TITLE = load_font(18, bold=True)
FONT_BOX_DESC = load_font(13)
FONT_ARROW = load_font(12)
FONT_LAYER = load_font(14, bold=True)
FONT_PHASE_NUM = load_font(22, bold=True)
FONT_PHASE_TITLE = load_font(14, bold=True)
FONT_PHASE_DESC = load_font(12)
FONT_SECTION = load_font(16, bold=True)

# ── Drawing primitives ────────────────────────────────────────────────────────
img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

def rounded_rect(x1, y1, x2, y2, r, fill, outline=None, width=1):
    draw.rounded_rectangle([x1, y1, x2, y2], radius=r, fill=fill, outline=outline, width=width)

def draw_box(cx, cy, w, h, title, desc, accent=None):
    x1, y1 = cx - w // 2, cy - h // 2
    x2, y2 = cx + w // 2, cy + h // 2
    rounded_rect(x1 + 2, y1 + 2, x2 + 2, y2 + 2, 8, "#E8E8E8")
    rounded_rect(x1, y1, x2, y2, 8, WHITE, BORDER, 1)
    if accent:
        draw.rounded_rectangle([x1, y1, x2, y1 + 4], radius=2, fill=accent)
    tw = draw.textlength(title, font=FONT_BOX_TITLE)
    draw.text((cx - tw / 2, cy - 16), title, fill=TEXT_DARK, font=FONT_BOX_TITLE)
    if desc:
        dw = draw.textlength(desc, font=FONT_BOX_DESC)
        draw.text((cx - dw / 2, cy + 6), desc, fill=TEXT_LIGHT, font=FONT_BOX_DESC)
    return x1, y1, x2, y2

def draw_arrow(x1, y1, x2, y2, color=ARROW_PRIMARY, dashed=False, label=None, lw=2):
    length = math.sqrt((x2 - x1)**2 + (y2 - y1)**2)
    if length < 1:
        return
    dx, dy = (x2 - x1) / length, (y2 - y1) / length
    if dashed:
        d = 0
        while d < length - 12:
            sx = x1 + dx * d
            sy = y1 + dy * d
            ed = min(d + 8, length - 12)
            draw.line([(sx, sy), (x1 + dx * ed, y1 + dy * ed)], fill=color, width=lw)
            d += 14
    else:
        draw.line([(x1, y1), (x2 - dx * 2, y2 - dy * 2)], fill=color, width=lw)
    # Arrowhead
    angle = math.atan2(y2 - y1, x2 - x1)
    sz = 10
    draw.polygon([
        (x2, y2),
        (x2 - sz * math.cos(angle - 0.4), y2 - sz * math.sin(angle - 0.4)),
        (x2 - sz * math.cos(angle + 0.4), y2 - sz * math.sin(angle + 0.4)),
    ], fill=color)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 - 10
        ltw = draw.textlength(label, font=FONT_ARROW)
        rounded_rect(mx - ltw / 2 - 5, my - 8, mx + ltw / 2 + 5, my + 9, 3, BG)
        draw.text((mx - ltw / 2, my - 6), label, fill=TEXT_MED, font=FONT_ARROW)


# ═══════════════════════════════════════════════════════════════════════════════
# LAYOUT — 6 sections
# ═══════════════════════════════════════════════════════════════════════════════

PAD = 50  # horizontal padding
CW = W - 2 * PAD  # content width

# Y positions
y_cursor = 60

# ── TITLE ─────────────────────────────────────────────────────────────────────
title = "AI HISTORIAN  —  System Architecture"
tw = draw.textlength(title, font=FONT_TITLE)
draw.text((W / 2 - tw / 2, y_cursor), title, fill=TEXT_DARK, font=FONT_TITLE)
y_cursor += 48
sub = "Gemini Live Agent Challenge  |  Google Cloud  |  11-Phase ADK Pipeline"
sw = draw.textlength(sub, font=FONT_SUBTITLE)
draw.text((W / 2 - sw / 2, y_cursor), sub, fill=TEXT_LIGHT, font=FONT_SUBTITLE)
y_cursor += 50

# ── SECTION 1: FRONTEND ──────────────────────────────────────────────────────
fe_y = y_cursor
fe_h = 130
rounded_rect(PAD, fe_y, W - PAD, fe_y + fe_h, 12, BAND_FRONTEND)
draw.text((PAD + 18, fe_y + 12), "FRONTEND", fill=ACCENT_BLUE, font=FONT_LAYER)
fe_cy = fe_y + 32 + 70 // 2
fe_box = draw_box(W // 2, fe_cy, 700, 70,
    "React 19 + TypeScript + Vite  (Vercel)",
    "PDF Viewer  ·  Documentary Player  ·  Ken Burns Stage  ·  Voice Button  ·  Research Panel  ·  Expedition Log",
    ACCENT_BLUE)
y_cursor = fe_y + fe_h + 20

# ── Connection zone 1 ────────────────────────────────────────────────────────
conn1_y = y_cursor
y_cursor += 70

# ── SECTION 2: BACKEND SERVICES ──────────────────────────────────────────────
be_y = y_cursor
be_h = 130
rounded_rect(PAD, be_y, W - PAD, be_y + be_h, 12, BAND_BACKEND)
draw.text((PAD + 18, be_y + 12), "BACKEND  ·  Google Cloud Run", fill=ACCENT_GREEN, font=FONT_LAYER)
be_cy = be_y + 32 + 70 // 2
be_bw = 280
be_gap = 40
be_total = 3 * be_bw + 2 * be_gap
be_start = PAD + (CW - be_total) // 2

be_data = [
    ("historian-api", "FastAPI  ·  REST + SSE  ·  Signed URLs"),
    ("agent-orchestrator", "Google ADK  ·  SequentialAgent  ·  SSE Stream"),
    ("live-relay", "Node.js  ·  WebSocket  ·  Gemini Live Proxy"),
]
be_boxes = []
for i, (t, d) in enumerate(be_data):
    cx = be_start + be_bw // 2 + i * (be_bw + be_gap)
    box = draw_box(cx, be_cy, be_bw, 70, t, d, ACCENT_GREEN)
    be_boxes.append((cx, box))
y_cursor = be_y + be_h + 20

# ── Connection zone 2 ────────────────────────────────────────────────────────
conn2_y = y_cursor
y_cursor += 50

# ── SECTION 3: ADK PIPELINE (the big one) ────────────────────────────────────
pipe_y = y_cursor
pipe_h = 500
rounded_rect(PAD, pipe_y, W - PAD, pipe_y + pipe_h, 12, BAND_PIPELINE)
draw.text((PAD + 18, pipe_y + 12), "ADK AGENT PIPELINE  ·  SequentialAgent  ·  11 Phases", fill=ACCENT_AMBER, font=FONT_LAYER)

# Pipeline phases — 3 rows
phase_box_w = 210
phase_box_h = 110
phase_gap_x = 16
phase_gap_y = 25
phase_start_x = PAD + 60

phases = [
    # Row 1: Document Processing
    [
        ("I", "Document\nAnalyzer", "Document AI OCR\nSemantic Chunking\nNarrative Curator", ACCENT_WARM),
        ("II", "Scene\nResearch", "ParallelAgent\ngoogle_search × N\nAggregator", ACCENT_GREEN),
        ("III", "Script\nGenerator", "Gemini 2.0 Pro\nSegment Scripts\nNarration + Visuals", ACCENT_PURPLE),
        ("IV", "Narrative\nDirector", "TEXT+IMAGE\nStoryboard\nCreative Direction", ACCENT_PURPLE),
    ],
    # Row 2: Creative Pipeline
    [
        ("V", "Beat\nIllustration", "TEXT+IMAGE\nBeat 0 Fast Path\nBeats 1-N Concurrent", ACCENT_PURPLE),
        ("VI", "Visual\nInterleave", "Assigns visual_type\nillustration / cinematic\n/ video per beat", ACCENT_AMBER),
        ("VII", "Fact\nValidator", "Hallucination\nFirewall\nCross-reference", "#DC2626"),
        ("VIII", "Geographic\nMapping", "Gemini + Maps\nGeocode Locations\nFirestore + SSE", ACCENT_TEAL),
    ],
    # Row 3: Visual Generation
    [
        ("IX", "Visual\nPlanner", "Gemini 2.0 Pro\nVisual Territory\nPer-Scene Planning", ACCENT_AMBER),
        ("X", "Visual\nResearch", "6-Stage Pipeline\n10 Sources Deep Path\nAccept/Reject Eval", ACCENT_WARM),
        ("XI", "Visual\nDirector", "Imagen 3 (4 frames)\nVeo 2 (async video)\nBeat-Aware Gen", ACCENT_PURPLE),
    ],
]

row_y = pipe_y + 45
for row_idx, row in enumerate(phases):
    row_y += phase_gap_y + 10
    cols = len(row)
    total_w = cols * phase_box_w + (cols - 1) * phase_gap_x
    start_x = PAD + (CW - total_w) // 2

    for col_idx, (num, title, desc, accent) in enumerate(row):
        bx = start_x + col_idx * (phase_box_w + phase_gap_x)
        by = row_y

        # Phase box
        rounded_rect(bx, by, bx + phase_box_w, by + phase_box_h, 8, PHASE_BG, PHASE_BORDER, 1)
        # Accent left stripe
        draw.rounded_rectangle([bx, by, bx + 5, by + phase_box_h], radius=3, fill=accent)

        # Phase number circle
        circle_cx = bx + 30
        circle_cy = by + 22
        draw.ellipse([circle_cx - 16, circle_cy - 16, circle_cx + 16, circle_cy + 16], fill=accent)
        ntw = draw.textlength(num, font=FONT_PHASE_NUM if len(num) <= 2 else FONT_PHASE_TITLE)
        nfont = FONT_PHASE_NUM if len(num) <= 2 else FONT_PHASE_TITLE
        draw.text((circle_cx - ntw / 2, circle_cy - (12 if len(num) <= 2 else 9)), num, fill=WHITE, font=nfont)

        # Phase title
        title_lines = title.split("\n")
        tx = bx + 55
        ty = by + 10
        for line in title_lines:
            draw.text((tx, ty), line, fill=TEXT_DARK, font=FONT_PHASE_TITLE)
            ty += 16

        # Phase description
        desc_lines = desc.split("\n")
        dy = by + 48
        for line in desc_lines:
            draw.text((bx + 16, dy), line, fill=TEXT_PHASE, font=FONT_PHASE_DESC)
            dy += 16

    # Draw arrows between phases in the same row
    for col_idx in range(cols - 1):
        ax1 = start_x + col_idx * (phase_box_w + phase_gap_x) + phase_box_w + 2
        ax2 = start_x + (col_idx + 1) * (phase_box_w + phase_gap_x) - 2
        ay = row_y + phase_box_h // 2
        draw_arrow(ax1, ay, ax2, ay, ACCENT_AMBER, lw=2)

    # Draw arrow from last phase of this row to first phase of next row
    if row_idx < len(phases) - 1:
        last_x = start_x + (cols - 1) * (phase_box_w + phase_gap_x) + phase_box_w // 2
        last_y = row_y + phase_box_h
        next_cols = len(phases[row_idx + 1])
        next_total_w = next_cols * phase_box_w + (next_cols - 1) * phase_gap_x
        next_start_x = PAD + (CW - next_total_w) // 2
        next_x = next_start_x + phase_box_w // 2
        next_y = row_y + phase_box_h + phase_gap_y + 10
        # Curved connector: down then across
        mid_y = (last_y + next_y) // 2 + 5
        draw.line([(last_x, last_y), (last_x, mid_y)], fill=ACCENT_AMBER, width=2)
        draw.line([(last_x, mid_y), (next_x, mid_y)], fill=ACCENT_AMBER, width=2)
        draw_arrow(next_x, mid_y, next_x, next_y, ACCENT_AMBER, lw=2)

    row_y += phase_box_h

y_cursor = pipe_y + pipe_h + 20

# ── Connection zone 3 ────────────────────────────────────────────────────────
conn3_y = y_cursor
y_cursor += 50

# ── SECTION 4: AI MODELS ─────────────────────────────────────────────────────
ai_y = y_cursor
ai_h = 130
rounded_rect(PAD, ai_y, W - PAD, ai_y + ai_h, 12, BAND_AI)
draw.text((PAD + 18, ai_y + 12), "AI MODELS  ·  Gemini & Vertex AI", fill=ACCENT_PURPLE, font=FONT_LAYER)
ai_cy = ai_y + 32 + 70 // 2
ai_bw = 220
ai_gap = 24
ai_total = 4 * ai_bw + 3 * ai_gap
ai_start = PAD + (CW - ai_total) // 2

ai_data = [
    ("Gemini 2.0 Flash/Pro", "Research · Scripts · Storyboard"),
    ("Imagen 3 Fast", "4 Frames/Segment · ~5s each"),
    ("Veo 2", "Async Video · 1-2 min clips"),
    ("Gemini 2.5 Flash", "Native Audio · Live API"),
]
ai_boxes = []
for i, (t, d) in enumerate(ai_data):
    cx = ai_start + ai_bw // 2 + i * (ai_bw + ai_gap)
    box = draw_box(cx, ai_cy, ai_bw, 70, t, d, ACCENT_PURPLE)
    ai_boxes.append((cx, box))
y_cursor = ai_y + ai_h + 20

# ── Connection zone 4 ────────────────────────────────────────────────────────
conn4_y = y_cursor
y_cursor += 40

# ── SECTION 5: INFRASTRUCTURE ─────────────────────────────────────────────────
inf_y = y_cursor
inf_h = 130
rounded_rect(PAD, inf_y, W - PAD, inf_y + inf_h, 12, BAND_INFRA)
draw.text((PAD + 18, inf_y + 12), "INFRASTRUCTURE  ·  Google Cloud", fill=ACCENT_WARM, font=FONT_LAYER)
inf_cy = inf_y + 32 + 70 // 2
inf_bw = 155
inf_gap = 16
inf_total = 6 * inf_bw + 5 * inf_gap
inf_start = PAD + (CW - inf_total) // 2

inf_data = [
    ("Document AI", "Multilingual OCR"),
    ("Firestore", "Sessions · State · Logs"),
    ("Cloud Storage", "Documents · Images · Video"),
    ("Pub/Sub", "Async Events"),
    ("Secret Manager", "API Keys · Creds"),
    ("Terraform", "IaC · 42 Resources"),
]
inf_boxes = []
for i, (t, d) in enumerate(inf_data):
    cx = inf_start + inf_bw // 2 + i * (inf_bw + inf_gap)
    box = draw_box(cx, inf_cy, inf_bw, 70, t, d, ACCENT_WARM)
    inf_boxes.append((cx, box))


# ═══════════════════════════════════════════════════════════════════════════════
# ARROWS — connections between sections (routed to avoid overlaps)
# ═══════════════════════════════════════════════════════════════════════════════

def draw_rail(x, y1, y2, color, label=None):
    """Draw a dashed vertical rail line along the edge."""
    d = 0
    length = abs(y2 - y1)
    direction = 1 if y2 > y1 else -1
    while d < length:
        sy = y1 + direction * d
        ey = y1 + direction * min(d + 8, length)
        draw.line([(x, sy), (x, ey)], fill=color, width=2)
        d += 14
    if label:
        mid_y = (y1 + y2) // 2
        ltw = draw.textlength(label, font=FONT_ARROW)
        rounded_rect(x - ltw / 2 - 5, mid_y - 8, x + ltw / 2 + 5, mid_y + 9, 3, BG)
        draw.text((x - ltw / 2, mid_y - 6), label, fill=color, font=FONT_ARROW)

fe_bottom = fe_box[3]
be_api_cx, be_api_box = be_boxes[0]
be_orch_cx, be_orch_box = be_boxes[1]
be_relay_cx, be_relay_box = be_boxes[2]
pipe_bottom = pipe_y + pipe_h

# ── Direct vertical connections (no crossing) ─────────────────────────────────

# Frontend → historian-api (REST + SSE)
draw_arrow(W // 2 - 200, fe_bottom, be_api_cx, be_api_box[1], label="REST + SSE")

# Frontend → live-relay (WebSocket)
draw_arrow(W // 2 + 200, fe_bottom, be_relay_cx, be_relay_box[1], label="WebSocket")

# historian-api → agent-orchestrator (horizontal)
draw_arrow(be_api_box[2] + 4, be_cy, be_orch_box[0] - 4, be_cy, label="pipeline trigger")

# agent-orchestrator → Pipeline (straight down)
draw_arrow(be_orch_cx, be_orch_box[3], be_orch_cx, pipe_y + 2, ACCENT_AMBER, label="ADK Pipeline")

# Pipeline → AI Models (straight down from pipeline to models below)
# ai_boxes: [0]=Gemini 2.0, [1]=Imagen 3, [2]=Veo 2, [3]=Gemini 2.5 Flash
draw_arrow(ai_boxes[0][0], pipe_bottom, ai_boxes[0][0], ai_boxes[0][1][1],
           ACCENT_PURPLE, label="research + scripts")
draw_arrow(ai_boxes[1][0], pipe_bottom, ai_boxes[1][0], ai_boxes[1][1][1],
           ACCENT_PURPLE, label="image gen")
draw_arrow(ai_boxes[2][0], pipe_bottom, ai_boxes[2][0], ai_boxes[2][1][1],
           ACCENT_PURPLE, label="video gen")

# All services → Firestore + Cloud Storage (dashed, straight down)
# inf_boxes: [0]=Document AI, [1]=Firestore, [2]=Cloud Storage, [3]=Pub/Sub, [4]=Secret Mgr, [5]=Terraform
ai_bottom_y = ai_boxes[0][1][3]
draw_arrow(inf_boxes[1][0], ai_bottom_y + 20, inf_boxes[1][0], inf_boxes[1][1][1],
           ARROW_SECONDARY, dashed=True, label="state")
draw_arrow(inf_boxes[2][0], ai_bottom_y + 20, inf_boxes[2][0], inf_boxes[2][1][1],
           ARROW_SECONDARY, dashed=True, label="media")

# ── RIGHT RAIL: live-relay → Gemini 2.5 Flash (rightmost AI box) ─────────────
# Gemini 2.5 Flash is now ai_boxes[3] (rightmost) — rail comes straight down
right_rail_x = W - PAD + 20

# Horizontal from live-relay to right rail
draw.line([(be_relay_box[2], be_cy), (right_rail_x, be_cy)], fill=ACCENT_TEAL, width=2)
# Vertical rail down to AI models layer
draw_rail(right_rail_x, be_cy, ai_cy, ACCENT_TEAL, label="audio bidirectional")
# Horizontal from right rail into Gemini 2.5 Flash (rightmost box)
draw_arrow(right_rail_x, ai_cy, ai_boxes[3][1][2], ai_cy, ACCENT_TEAL, lw=2)

# ── LEFT RAIL: Pipeline Phase I → Document AI (leftmost infra box) ───────────
# Document AI is now inf_boxes[0] (leftmost) — rail comes straight down
left_rail_x = PAD - 20

# Horizontal from pipeline to left rail
draw.line([(PAD, pipe_y + 100), (left_rail_x, pipe_y + 100)], fill=ACCENT_WARM, width=2)
# Vertical rail down to infrastructure
draw_rail(left_rail_x, pipe_y + 100, inf_cy, ACCENT_WARM, label="OCR")
# Horizontal from left rail into Document AI (leftmost box)
draw_arrow(left_rail_x, inf_cy, inf_boxes[0][1][0], inf_cy, ACCENT_WARM, lw=2)

# ── Pub/Sub + Secret Manager (dashed) ────────────────────────────────────────
draw_arrow(inf_boxes[3][0], ai_bottom_y + 20, inf_boxes[3][0], inf_boxes[3][1][1],
           ARROW_SECONDARY, dashed=True)
draw_arrow(inf_boxes[4][0], ai_bottom_y + 20, inf_boxes[4][0], inf_boxes[4][1][1],
           ARROW_SECONDARY, dashed=True)


# ═══════════════════════════════════════════════════════════════════════════════
# VOICE FLOW annotation (right side, above the rail)
# ═══════════════════════════════════════════════════════════════════════════════

voice_x = W - PAD - 240
voice_y = fe_y + fe_h + 5
voice_w = 230
voice_h = 76
rounded_rect(voice_x, voice_y, voice_x + voice_w, voice_y + voice_h, 8, BAND_VOICE, ACCENT_TEAL, 1)
draw.text((voice_x + 14, voice_y + 8), "LIVE VOICE PATH", fill=ACCENT_TEAL, font=FONT_LAYER)
lines = [
    "Browser → live-relay → Gemini 2.5 Flash",
    "< 300ms interruption latency",
    "Always-on historian persona",
]
for i, line in enumerate(lines):
    draw.text((voice_x + 14, voice_y + 30 + i * 16), line, fill=TEXT_PHASE, font=FONT_PHASE_DESC)


# ── Save ──────────────────────────────────────────────────────────────────────
output = "/Users/efecelik/gemini-live-hackathon-idea/docs/architecture/architecture-diagram.png"
img.save(output, "PNG", optimize=True)
print(f"Saved: {output}")
print(f"Dimensions: {img.size}")
print(f"File size: {os.path.getsize(output):,} bytes")
