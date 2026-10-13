"""Generate three realistic sample supplier quotes (PDF, CSV, photo) for the demo.

Same six items, but each supplier names them differently, prices differently,
and hides different extra charges in the fine print.
"""
import csv
import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = pathlib.Path(__file__).resolve().parent.parent / "samples"
OUT.mkdir(exist_ok=True)

# ---------- Supplier A: digital PDF ----------
a_items = [
    ("Gypsum Board 12.5mm 8x4 ft", 120, "Nos", 465.00),
    ("GI Ceiling Channel 3m", 200, "Nos", 118.00),
    ("Mineral Fibre Ceiling Tile 2x2 ft", 300, "Nos", 92.00),
    ("LED Panel Light 2x2 36W", 40, "Nos", 1450.00),
    ("Wall Putty 40kg Bag", 25, "Bag", 780.00),
    ("Acrylic Emulsion Paint 20L", 12, "Bucket", 3950.00),
]
c = canvas.Canvas(str(OUT / "apex-building-supplies.pdf"), pagesize=A4)
W, H = A4
y = H - 60
c.setFont("Helvetica-Bold", 16); c.drawString(50, y, "Apex Building Supplies Pvt Ltd"); y -= 18
c.setFont("Helvetica", 9); c.drawString(50, y, "Plot 14, Industrial Area Phase 2, Pune 411019  |  GSTIN 27AABCA1234F1Z5"); y -= 30
c.setFont("Helvetica-Bold", 13); c.drawString(50, y, "QUOTATION"); y -= 16
c.setFont("Helvetica", 9); c.drawString(50, y, "Quote No: AQ-2026-1187     Date: 08-10-2026     To: Studio Nine Interiors"); y -= 28
cols = [50, 75, 330, 380, 430, 500]
c.setFont("Helvetica-Bold", 9)
for x, h in zip(cols, ["#", "Description", "Qty", "Unit", "Rate", "Amount"]):
    c.drawString(x, y, h)
y -= 6; c.line(50, y, 550, y); y -= 14
c.setFont("Helvetica", 9)
sub = 0
for i, (d, q, u, r) in enumerate(a_items, 1):
    amt = q * r; sub += amt
    for x, v in zip(cols, [str(i), d, str(q), u, f"{r:,.2f}", f"{amt:,.2f}"]):
        c.drawString(x, y, v)
    y -= 16
c.line(50, y + 6, 550, y + 6); y -= 8
gst = round(sub * 0.18, 2)
for label, val in [("Sub Total", sub), ("GST @ 18%", gst), ("Grand Total", sub + gst)]:
    c.setFont("Helvetica-Bold" if label == "Grand Total" else "Helvetica", 9)
    c.drawString(380, y, label); c.drawString(500, y, f"{val:,.2f}"); y -= 15
y -= 20
c.setFont("Helvetica-Bold", 9); c.drawString(50, y, "Terms & Conditions"); y -= 14
c.setFont("Helvetica", 8.5)
for t in ["1. Prices inclusive of delivery to site within Pune city limits.",
          "2. Payment: 30% advance, balance within 15 days of delivery.",
          "3. Delivery: 5-7 working days from order confirmation.",
          "4. Quote valid for 30 days."]:
    c.drawString(50, y, t); y -= 13
c.save()

# ---------- Supplier B: spreadsheet (CSV) ----------
b_items = [
    ("Gypsum board 12.5 mm (8'x4')", 120, "sheet", 438),
    ("Ceiling channel GI 3 mtr", 200, "pcs", 109),
    ("Ceiling tiles mineral fiber 600x600", 300, "pcs", 88),
    ("Wall putty bag 40 kg", 25, "bag", 745),
    ("Emulsion paint acrylic 20 ltr", 12, "bucket", 3720),
]
with open(OUT / "buildmart-traders.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["BuildMart Traders - Quotation BMT/Q/5521"])
    w.writerow([])
    w.writerow(["Item", "Qty", "Unit", "Unit Price", "Total"])
    for d, q, u, r in b_items:
        w.writerow([d, q, u, r, q * r])
    w.writerow([])
    w.writerow(["Transport charges", "", "", "", 6500])
    w.writerow(["Loading / unloading", "", "", "", 1200])
    w.writerow([])
    w.writerow(["Note: GST 18% extra as applicable. Rates ex-godown."])
    w.writerow(["Note: LED panel lights not in stock - can source in 3 weeks."])
    w.writerow(["Note: 100% payment before dispatch."])

# ---------- Supplier C: phone photo of a printed quote ----------
c_items = [
    ("Gypsum Board 12.5mm 8ft x 4ft", 120, 452),
    ("GI Channel for ceiling 3 mtr", 200, 104),
    ("Ceiling Tile Mineral Fibre 2'x2'", 300, 97),
    ("LED Panel 36W 2x2", 40, 1290),
    ("Wall Putty 40 Kg", 25, 760),
    ("Acrylic Emulsion 20 Ltr", 12, 3880),
]
img = Image.new("RGB", (1500, 1500), (250, 249, 246))
d = ImageDraw.Draw(img)
def font(sz, bold=False):
    return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf" % ("-Bold" if bold else ""), sz)
yy = 70
d.text((80, yy), "SHREE INTERIORS DEPOT", font=font(46, True), fill=(20, 20, 20)); yy += 64
d.text((80, yy), "Ceiling | Partition | Lighting  -  Mob 98220 41177", font=font(24), fill=(60, 60, 60)); yy += 60
d.text((80, yy), "Quotation for: Studio Nine Interiors      Date: 09/10/2026", font=font(26), fill=(30, 30, 30)); yy += 60
hx = [80, 860, 1020, 1220]
for x, h in zip(hx, ["Particulars", "Qty", "Rate", "Amount"]):
    d.text((x, yy), h, font=font(28, True), fill=(20, 20, 20))
yy += 44; d.line((80, yy, 1420, yy), fill=(40, 40, 40), width=3); yy += 18
tot = 0
for name, q, r in c_items:
    amt = q * r; tot += amt
    for x, v in zip(hx, [name, str(q), f"{r:,}", f"{amt:,}"]):
        d.text((x, yy), v, font=font(28), fill=(25, 25, 25))
    yy += 54
d.line((80, yy, 1420, yy), fill=(40, 40, 40), width=3); yy += 20
d.text((860, yy), "Total", font=font(30, True), fill=(20, 20, 20)); d.text((1220, yy), f"{tot:,}", font=font(30, True), fill=(20, 20, 20)); yy += 54
d.text((860, yy), "Transport", font=font(28), fill=(20, 20, 20)); d.text((1220, yy), "4,000", font=font(28), fill=(20, 20, 20)); yy += 80
for t in ["* GST 18% extra", "* Installation charges extra @ Rs 18 per sq ft", "* Payment 100% advance", "* Rates valid 7 days only"]:
    d.text((80, yy), t, font=font(26), fill=(30, 30, 30)); yy += 44
# make it look like a phone photo: slight rotation, warm cast, blur, noise
img = img.rotate(-1.2, resample=Image.BICUBIC, expand=True, fillcolor=(120, 112, 100))
noise = Image.effect_noise(img.size, 14).convert("RGB")
img = Image.blend(img, noise, 0.06).filter(ImageFilter.GaussianBlur(0.8))
img = img.crop((30, 30, img.width - 30, min(img.height - 30, yy + 120)))
img.save(OUT / "shree-interiors-photo.jpg", quality=82)
print("samples written to", OUT)
