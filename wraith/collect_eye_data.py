"""
Collect eye crops (open/closed) from your webcam using MediaPipe FaceMesh.

Usage:
  python wraith/collect_eye_data.py --out data/eyes --img_w 48 --img_h 24

Keys:
  o   Save current eye crops as OPEN  (both eyes; right eye is flipped)
  c   Save current eye crops as CLOSED (both eyes; right eye is flipped)
  q   Quit

Notes:
  - Ensure good lighting; look at camera. Blink and change head pose to vary samples.
  - Saved files:
      data/eyes/open/*.png   (grayscale 24x48)
      data/eyes/closed/*.png (grayscale 24x48)
"""
import argparse
import time
from pathlib import Path

try:
    import cv2  # type: ignore[reportMissingImports]
except Exception as e:
    raise SystemExit("OpenCV (cv2) is required. Install deps: python3 -m pip install -r requirements.txt\n" + str(e))
import numpy as np
try:
    import mediapipe as mp  # type: ignore[reportMissingImports]
except Exception as e:
    raise SystemExit("MediaPipe is required. Install deps: python3 -m pip install -r requirements.txt\n" + str(e))


LEFT_EYE = {
    "upper": [386, 385], "lower": [374, 380], "left": 263, "right": 362
}
RIGHT_EYE = {
    "upper": [159, 158], "lower": [145, 153], "left": 133, "right": 33
}
EYE_PAD = 1.6


def landmarks_eye_box(lm, eye):
    u = (
        (lm[eye["upper"][0]].x + lm[eye["upper"][1]].x) / 2.0,
        (lm[eye["upper"][0]].y + lm[eye["upper"][1]].y) / 2.0,
    )
    l = (
        (lm[eye["lower"][0]].x + lm[eye["lower"][1]].x) / 2.0,
        (lm[eye["lower"][0]].y + lm[eye["lower"][1]].y) / 2.0,
    )
    left = lm[eye["left"]]
    right = lm[eye["right"]]
    cx = (left.x + right.x) / 2.0
    cy = (u[1] + l[1]) / 2.0
    w = abs(right.x - left.x)
    h = abs(l[1] - u[1]) * 2.2
    return cx, cy, w * EYE_PAD, h * EYE_PAD


def crop_eye(frame_bgr, cx, cy, w, h, out_w, out_h):
    h_img, w_img, _ = frame_bgr.shape
    x = int(max(0, min(w_img - 1, (cx - w / 2) * w_img)))
    y = int(max(0, min(h_img - 1, (cy - h / 2) * h_img)))
    ww = int(max(4, min(w_img, w * w_img)))
    hh = int(max(4, min(h_img, h * h_img)))
    crop = frame_bgr[y : y + hh, x : x + ww]
    if crop.size == 0:
        return None
    crop = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    crop = cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_AREA)
    return crop


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/eyes")
    ap.add_argument("--samples", type=int, default=1, help="Number of samples to save per keypress (burst)")
    ap.add_argument("--meta", type=str, default="metadata.csv", help="Metadata CSV filename (in out dir)")
    ap.add_argument("--cam", type=int, default=0)
    ap.add_argument("--img_w", type=int, default=48)
    ap.add_argument("--img_h", type=int, default=24)
    ap.add_argument("--no_preview", action="store_true", help="Disable preview window (headless mode)")
    args = ap.parse_args()

    out_root = Path(args.out)
    out_open = out_root / "open"
    out_closed = out_root / "closed"
    out_open.mkdir(parents=True, exist_ok=True)
    out_closed.mkdir(parents=True, exist_ok=True)

    meta_path = out_root / args.meta
    # create metadata CSV with header if missing
    if not meta_path.exists():
        meta_path.write_text("filename,label,eye,timestamp\n")

    cap = cv2.VideoCapture(args.cam)
    if not cap.isOpened():
        print("Failed to open webcam")
        return

    mp_face_mesh = mp.solutions.face_mesh  # type: ignore[attr-defined]
    with mp_face_mesh.FaceMesh(
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    ) as face_mesh:
        print("Press 'o' to save OPEN, 'c' to save CLOSED, [1]/[2] to pick active label, space to save current label, 'q' to quit.")
        print("Use --samples N to save N images per keypress (burst).")
        headless = bool(args.no_preview)
        active_label = 'open'
        counts = {'open': len(list(out_open.glob('*.png'))), 'closed': len(list(out_closed.glob('*.png')))}

        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            res = face_mesh.process(frame_rgb)

            h_img, w_img, _ = frame.shape
            label_text = f"[1] open({counts['open']})  [2] closed({counts['closed']})  active:{active_label}  [space]/[o]/[c] save  [q] quit"
            color = (0, 255, 0)

            if res.multi_face_landmarks:
                lm = res.multi_face_landmarks[0].landmark
                # draw simple eye lines
                for eye_def, col in ((LEFT_EYE, (0, 255, 0)), (RIGHT_EYE, (0, 255, 0))):
                    lx = int(lm[eye_def["left"]].x * w_img)
                    ly = int(lm[eye_def["left"]].y * h_img)
                    rx = int(lm[eye_def["right"]].x * w_img)
                    ry = int(lm[eye_def["right"]].y * h_img)
                    cv2.line(frame, (lx, ly), (rx, ry), col, 2)

                # prepare crops
                cxL, cyL, wL, hL = landmarks_eye_box(lm, LEFT_EYE)
                cxR, cyR, wR, hR = landmarks_eye_box(lm, RIGHT_EYE)
                left_eye = crop_eye(frame, cxL, cyL, wL, hL, args.img_w, args.img_h)
                right_eye = crop_eye(frame, cxR, cyR, wR, hR, args.img_w, args.img_h)
                if right_eye is not None:
                    right_eye = cv2.flip(right_eye, 1)  # flip horizontally

                # show small previews
                if left_eye is not None:
                    le_disp = cv2.cvtColor(left_eye, cv2.COLOR_GRAY2BGR)
                    frame[10 : 10 + args.img_h, 10 : 10 + args.img_w] = cv2.resize(
                        le_disp, (args.img_w, args.img_h)
                    )
                if right_eye is not None:
                    re_disp = cv2.cvtColor(right_eye, cv2.COLOR_GRAY2BGR)
                    frame[10 : 10 + args.img_h, 20 + args.img_w : 20 + 2 * args.img_w] = cv2.resize(
                        re_disp, (args.img_w, args.img_h)
                    )

                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                # choose active label
                elif key == ord("1"):
                    active_label = 'open'
                elif key == ord("2"):
                    active_label = 'closed'
                # space or o/c to save
                elif key in (ord(" "), ord("o"), ord("c")):
                    # determine target label
                    if key == ord("o"):
                        tgt_label = 'open'
                    elif key == ord("c"):
                        tgt_label = 'closed'
                    else:
                        tgt_label = active_label
                    ts_base = int(time.time() * 1000)
                    saved = 0
                    tgt_dir = out_open if tgt_label == 'open' else out_closed
                    for i in range(args.samples):
                        ts = f"{ts_base}_{i}"
                        if left_eye is not None:
                            fn = tgt_dir / f"eyeL_{ts}.png"
                            cv2.imwrite(str(fn), left_eye)
                            with open(meta_path, 'a', encoding='utf-8') as mf:
                                mf.write(f"{fn.name},{tgt_label},L,{int(time.time()*1000)}\n")
                            counts[tgt_label] += 1
                            saved += 1
                        if right_eye is not None:
                            fn = tgt_dir / f"eyeR_{ts}.png"
                            cv2.imwrite(str(fn), right_eye)
                            with open(meta_path, 'a', encoding='utf-8') as mf:
                                mf.write(f"{fn.name},{tgt_label},R,{int(time.time()*1000)}\n")
                            counts[tgt_label] += 1
                            saved += 1
                    print(f"Saved {saved} images to {tgt_label} ({tgt_dir})")
            else:
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break

            cv2.putText(
                frame,
                label_text,
                (10, frame.shape[0] - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                color,
                2,
                cv2.LINE_AA,
            )
            if not headless:
                try:
                    cv2.imshow("Collect Eye Data", frame)
                except Exception as e:
                    print("Preview unavailable, switching to headless mode:", e)
                    headless = True

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
