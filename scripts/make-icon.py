"""Reproduce the original Splash geometric mark, with no external artwork."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'apps/editor/src-tauri/icons'
root.mkdir(parents=True, exist_ok=True)
im = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
# Match the editor's brand blue and white mark.
d.rounded_rectangle((32, 32, 992, 992), radius=232, fill='#0064e5')
d.polygon([(726, 264), (342, 264), (254, 352), (254, 505), (342, 585), (592, 585), (592, 638), (275, 638), (275, 770), (682, 770), (770, 682), (770, 508), (682, 428), (432, 428), (432, 396), (726, 396)], fill='#ffffff')
for size, name in [(32, '32x32.png'), (128, '128x128.png'), (256, '128x128@2x.png'), (512, 'icon.png')]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(root / name)
im.save(root / 'icon.ico', sizes=[(16,16), (32,32), (48,48), (64,64), (128,128), (256,256)])
im.save(root / 'icon.icns')
