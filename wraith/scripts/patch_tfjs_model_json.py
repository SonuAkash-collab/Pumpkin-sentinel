#!/usr/bin/env python3
"""
Patch TF.js converted model.json files to normalize InputLayer shape keys.

Usage:
  python scripts/patch_tfjs_model_json.py [--dirs model/eye_state_model model/mouth_classifier_model]

This scans the specified model directories for model.json, and ensures the
InputLayer config uses either `batchInputShape` or `inputShape` (not both),
which prevents runtime InputLayer errors in browser TF.js loaders.
"""
import argparse
import json
from pathlib import Path
import sys


def patch_model_json(path: Path) -> bool:
    try:
        doc = json.loads(path.read_text())
    except Exception as e:
        print(f"[ERROR] Could not read {path}: {e}")
        return False
    layers = doc.get('modelTopology', {}).get('model_config', {}).get('config', {}).get('layers', None)
    if not isinstance(layers, list) or not layers:
        print(f"[WARN] No layers found in {path}; skipping")
        return False
    inp = next((l for l in layers if l.get('class_name') == 'InputLayer'), layers[0])
    cfg = inp.get('config', {})
    # Prefer existing batch-like shapes if present
    b = cfg.pop('batch_shape', None) or cfg.pop('batch_input_shape', None) or cfg.pop('batchInputShape', None)
    if b is not None:
        cfg['batchInputShape'] = b
        cfg.pop('inputShape', None)
        cfg.pop('input_shape', None)
    else:
        inp_s = cfg.pop('input_shape', None)
        if inp_s is not None and 'inputShape' not in cfg:
            cfg['inputShape'] = inp_s
    inp['config'] = cfg
    # Convert Keras v3 style inbound_nodes (objects with args/kwargs)
    # into legacy nested-array format expected by TF.js loaders.
    try:
        for layer in doc.get('modelTopology', {}).get('model_config', {}).get('config', {}).get('layers', []):
            inb = layer.get('inbound_nodes')
            if isinstance(inb, list) and inb:
                first = inb[0]
                if isinstance(first, dict) and ('args' in first or 'kwargs' in first):
                    new_nodes = []
                    for node_obj in inb:
                        args = node_obj.get('args') or []
                        kwargs = node_obj.get('kwargs') or {}
                        lane = []
                        for a in args:
                            # Expect an object with a 'config' that contains 'keras_history'
                            cfg_a = a.get('config') if isinstance(a, dict) else None
                            history = cfg_a.get('keras_history') if isinstance(cfg_a, dict) else None
                            if isinstance(history, list) and len(history) >= 3:
                                lane.append([history[0], history[1], history[2], kwargs])
                            else:
                                # fallback: try to interpret a as a simple layer name
                                if isinstance(a, str):
                                    lane.append([a, 0, 0, kwargs])
                        if lane:
                            new_nodes.append(lane)
                    if new_nodes:
                        layer['inbound_nodes'] = new_nodes
    except Exception:
        # Non-fatal; continue with writing whatever we have
        pass
    # Normalize layer dtype entries which may be Keras DTypePolicy objects
    try:
        for layer in doc.get('modelTopology', {}).get('model_config', {}).get('config', {}).get('layers', []):
            cfg = layer.get('config')
            if isinstance(cfg, dict):
                dt = cfg.get('dtype')
                if isinstance(dt, dict):
                    # try to extract a simple dtype name from nested config
                    dname = None
                    nested = dt.get('config') if isinstance(dt.get('config'), dict) else None
                    if isinstance(nested, dict) and 'name' in nested:
                        dname = nested['name']
                    # fallback: look for a top-level 'name' field
                    if dname is None and isinstance(dt.get('name'), str):
                        dname = dt.get('name')
                    if isinstance(dname, str):
                        cfg['dtype'] = dname
    except Exception:
        pass
    # write back compact JSON to reduce diffs/noise
    try:
        path.write_text(json.dumps(doc, separators=(',', ':'), ensure_ascii=False))
        print(f"[OK] Patched {path}")
        return True
    except Exception as e:
        print(f"[ERROR] Failed to write {path}: {e}")
        return False


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--dirs', nargs='+', default=['model/eye_state_model', 'model/mouth_classifier_model', 'model/yawn_model'])
    args = p.parse_args()
    any_failed = False
    for d in args.dirs:
        md = Path(d)
        mj = md / 'model.json'
        if not mj.exists():
            print(f"[SKIP] {mj} not found")
            continue
        ok = patch_model_json(mj)
        if not ok:
            any_failed = True
    if any_failed:
        sys.exit(2)


if __name__ == '__main__':
    main()
