"""Extract the five held shots from each final film for visual review."""
import io
import subprocess
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'frontend/public/design-media/c22/features'
REVIEW = ROOT / '.impeccable/review/c22-features'

for story in ('movement', 'month', 'spend', 'split', 'penny', 'aside'):
    if sys.argv[1:] and story not in sys.argv[1:]:
        continue
    if not all((OUT / f'{story}-{theme}.mp4').exists() for theme in ('light', 'dark')):
        continue
    sheet = Image.new('RGB', (1500, 1080), '#d8dbe3')
    draw = ImageDraw.Draw(sheet)
    for row, theme in enumerate(('light', 'dark')):
        for column, seconds in enumerate((.8, 3.8, 6.5, 9.5, 13)):
            raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(seconds), '-i', str(OUT / f'{story}-{theme}.mp4'), '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-threads', '1', '-'])
            image = Image.open(io.BytesIO(raw))
            image.thumbnail((290, 510))
            x, y = column * 300, row * 540
            sheet.paste(image, (x, y + 25))
            draw.text((x + 5, y + 5), f'{story} {theme} {seconds}s', fill='black')
    sheet.save(REVIEW / f'film-{story}-contact.jpg')
    print('Reviewed frames prepared:', story, flush=True)
