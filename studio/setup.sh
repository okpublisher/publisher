#!/usr/bin/env bash
# Στήσιμο των εργαλείων σε καθαρή συνεδρία (μία φορά ανά συνεδρία, ~1–2′). Χρειάζεται και το okpublisher/publisher-work (OKP_WORK).
set -euo pipefail
cd "$(dirname "$0")"

pip install -q --break-system-packages playwright imagehash pillow-heif reportlab opencv-python-headless 2>/dev/null \
  || pip install -q --break-system-packages playwright imagehash pillow-heif reportlab
python3 -c "import cv2; assert hasattr(cv2, 'FaceDetectorYN')" || pip install -q --break-system-packages -U opencv-python-headless
python3 -m playwright install chromium >/dev/null 2>&1 || echo "playwright chromium: θα χρησιμοποιηθεί το google-chrome"
(cd fonts && npm install --silent)

# Μοντέλα ανίχνευσης (όχι στο repo): YuNet (πρόσωπα, MIT), YOLOX-S (άνθρωποι, Apache-2.0), ελληνικά για το OCR.
mkdir -p models/tessdata
get() { [ -s "$2" ] || curl -sSfL -o "$2" "$1"; }
get https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx models/face_detection_yunet_2023mar.onnx
get https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/object_detection_yolox/object_detection_yolox_2022nov.onnx models/object_detection_yolox_2022nov.onnx
get https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/ell.traineddata models/tessdata/ell.traineddata
SYS=$(dirname "$(find /usr/share -name eng.traineddata 2>/dev/null | head -1)")
cp -n "$SYS/eng.traineddata" models/tessdata/ 2>/dev/null || true
cp -rn "$SYS/configs" "$SYS/tessconfigs" models/tessdata/ 2>/dev/null || true
# Λογότυπα πελατών: μένουν στο ιδιωτικό okpublisher/publisher-work (groups/<ομάδα>/logos, clients/<K>/logos).
mkdir -p assets
for f in "${OKP_WORK:-/home/claude/publisher-work}"/groups/*/logos/*.png "${OKP_WORK:-/home/claude/publisher-work}"/clients/*/logos/*.png; do
  [ -e "$f" ] && cp --update=none "$f" assets/ 2>/dev/null || true
done

python3 - <<'EOF'
import os, sys
need = ['models/face_detection_yunet_2023mar.onnx', 'models/object_detection_yolox_2022nov.onnx',
        'models/tessdata/ell.traineddata', 'models/tessdata/eng.traineddata', 'models/tessdata/configs/tsv']
miss = [p for p in need if not os.path.exists(p) or (p.endswith(('.onnx', '.traineddata')) and os.path.getsize(p) < 10000)]
print('ΛΕΙΠΟΥΝ: ' + ', '.join(miss) if miss else 'Εργαλεία έτοιμα.')
sys.exit(1 if miss else 0)
EOF
