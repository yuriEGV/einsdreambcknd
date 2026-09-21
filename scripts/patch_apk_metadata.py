#!/usr/bin/env python3
"""
patch_apk_metadata.py
Safely patches AndroidManifest.xml and assets/app.config in einsdream-mobile.apk:
1. Replaces UTF-16LE '2.1.0' / '1.0.0' with '2.2.0' in AndroidManifest.xml so Android OS Settings displays 'versión 2.2.0'
2. Replaces '2.1.0' / '1.1.4' / '1.0.0' with '2.2.0' in assets/app.config
3. Preserves all other entries, compression levels, and service loader targets
"""

import sys
import zipfile
import os

apk_path = sys.argv[1] if len(sys.argv) > 1 else 'einsdream-mobile.apk'
if not os.path.exists(apk_path):
    print(f"Error: {apk_path} not found!")
    sys.exit(1)

print(f"Patching metadata in {apk_path} to v2.7.0...")

entries = {}
with zipfile.ZipFile(apk_path, 'r') as z_in:
    for info in z_in.infolist():
        entries[info] = z_in.read(info.filename)

manifest_info = next((i for i in entries if i.filename == 'AndroidManifest.xml'), None)
if manifest_info is None:
    print("Error: AndroidManifest.xml not found in APK!")
    sys.exit(1)

manifest = entries[manifest_info]
u100 = '1.0.0'.encode('utf-16le')
u210 = '2.1.0'.encode('utf-16le')
u220 = '2.2.0'.encode('utf-16le')
u230 = '2.3.0'.encode('utf-16le')
u231 = '2.3.1'.encode('utf-16le')
u232 = '2.3.2'.encode('utf-16le')
u240 = '2.4.0'.encode('utf-16le')
u250 = '2.5.0'.encode('utf-16le')
u260 = '2.6.0'.encode('utf-16le')
u270 = '2.7.0'.encode('utf-16le')
u280 = '2.8.0'.encode('utf-16le')
u290 = '2.9.0'.encode('utf-16le')
u291 = '2.9.1'.encode('utf-16le')
u292 = '2.9.2'.encode('utf-16le')
u293 = '2.9.3'.encode('utf-16le')

for old_u in [u292, u291, u290, u280, u270, u260, u250, u240, u232, u231, u230, u220, u210, u100]:
    if old_u in manifest:
        new_manifest = manifest.replace(old_u, u293)
        assert len(new_manifest) == len(manifest), "Manifest length changed!"
        entries[manifest_info] = new_manifest
        print(f"Successfully replaced UTF-16LE version with '2.9.3' in AndroidManifest.xml")
        break
else:
    if u293 in manifest:
        print("Notice: '2.9.3' already in AndroidManifest.xml")
    else:
        print("Notice: no matching UTF-16LE version found in manifest")

app_config_info = next((i for i in entries if i.filename == 'assets/app.config'), None)
if app_config_info:
    cfg = entries[app_config_info]
    new_cfg = cfg
    for v in [b'"2.9.2"', b'"2.9.1"', b'"2.9.0"', b'"2.8.0"', b'"2.7.0"', b'"2.6.0"', b'"2.5.0"', b'"2.4.0"', b'"2.3.2"', b'"2.3.1"', b'"2.3.0"', b'"2.2.0"', b'"2.1.0"', b'"1.1.4"', b'"1.0.0"']:
        new_cfg = new_cfg.replace(v, b'"2.9.3"')
    entries[app_config_info] = new_cfg
    print("Successfully updated version to '2.9.3' in assets/app.config")

# Write back preserving compression
with zipfile.ZipFile(apk_path, 'w', allowZip64=True) as z_out:
    for info, data in entries.items():
        z_out.writestr(info, data)

# Verify
with zipfile.ZipFile(apk_path, 'r') as z_check:
    m = z_check.read('AndroidManifest.xml')
    assert u293 in m, "Verification failed: 2.9.3 not found in AndroidManifest.xml!"
    assert 'META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory' in z_check.namelist(), "MainDispatcherFactory missing!"

print(f"Metadata patch complete and verified for {apk_path}")
