#!/usr/bin/env python3
"""
patch_apk_metadata.py
Safely patches AndroidManifest.xml and assets/app.config in einsdream-mobile.apk:
1. Replaces UTF-16LE '1.0.0' with '2.1.0' in AndroidManifest.xml so Android OS Settings displays 'versión 2.1.0'
2. Replaces '1.1.4' / '1.0.0' with '2.1.0' in assets/app.config
3. Preserves all other entries, compression levels, and service loader targets
"""

import sys
import zipfile
import os

apk_path = sys.argv[1] if len(sys.argv) > 1 else 'einsdream-mobile.apk'
if not os.path.exists(apk_path):
    print(f"Error: {apk_path} not found!")
    sys.exit(1)

print(f"Patching metadata in {apk_path}...")

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

if u100 in manifest:
    new_manifest = manifest.replace(u100, u210)
    assert len(new_manifest) == len(manifest), "Manifest length changed!"
    entries[manifest_info] = new_manifest
    print("Successfully replaced UTF-16LE '1.0.0' with '2.1.0' in AndroidManifest.xml")
else:
    print("Notice: '1.0.0' UTF-16LE not found in manifest (already 2.1.0 or different version)")

app_config_info = next((i for i in entries if i.filename == 'assets/app.config'), None)
if app_config_info:
    cfg = entries[app_config_info]
    new_cfg = cfg.replace(b'"1.1.4"', b'"2.1.0"').replace(b'"1.0.0"', b'"2.1.0"')
    entries[app_config_info] = new_cfg
    print("Successfully updated version to '2.1.0' in assets/app.config")

# Write back preserving compression
with zipfile.ZipFile(apk_path, 'w', allowZip64=True) as z_out:
    for info, data in entries.items():
        z_out.writestr(info, data)

# Verify
with zipfile.ZipFile(apk_path, 'r') as z_check:
    m = z_check.read('AndroidManifest.xml')
    assert u210 in m, "Verification failed: 2.1.0 not found in AndroidManifest.xml!"
    assert 'META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory' in z_check.namelist(), "MainDispatcherFactory missing!"

print(f"Metadata patch complete and verified for {apk_path}")
