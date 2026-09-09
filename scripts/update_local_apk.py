#!/usr/bin/env python3
"""
update_local_apk.py
Updates assets/index.android.bundle inside einsdream-mobile.apk:
- Stored UNCOMPRESSED (ZIP_STORED) for Hermes mmap
- Patches AndroidManifest.xml and assets/app.config to version 2.2.0
- Copies to einsdream-mobile-v2.2.0.apk
"""

import os
import sys
import zipfile

script_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.abspath(os.path.join(script_dir, '..'))
public_dir = os.path.join(root_dir, 'public')
bundle_path = os.path.join(public_dir, 'assets', 'index.android.bundle')
base_apk = os.path.join(public_dir, 'einsdream-mobile.apk')
v220_apk = os.path.join(public_dir, 'einsdream-mobile-v2.2.0.apk')

if not os.path.exists(bundle_path):
    print(f"Error: {bundle_path} not found!")
    sys.exit(1)

if not os.path.exists(base_apk):
    print(f"Error: {base_apk} not found!")
    sys.exit(1)

print(f"Reading generated Hermes bundle ({os.path.getsize(bundle_path)} bytes)...")
with open(bundle_path, 'rb') as f:
    bundle_data = f.read()

# Assert Hermes magic
assert bundle_data[:8].hex() == 'c61fbc03c103191f', f"Invalid Hermes magic header: {bundle_data[:8].hex()}"

print(f"Reading existing APK {base_apk}...")
entries = {}
compress_types = {}

with zipfile.ZipFile(base_apk, 'r') as z_in:
    for info in z_in.infolist():
        entries[info.filename] = z_in.read(info.filename)
        compress_types[info.filename] = info.compress_type

print(f"Total entries in APK: {len(entries)}")

# 1. Update Hermes bundle uncompressed
entries['assets/index.android.bundle'] = bundle_data
compress_types['assets/index.android.bundle'] = zipfile.ZIP_STORED
print("Updated assets/index.android.bundle (ZIP_STORED for Hermes mmap)")

# 2. Patch AndroidManifest.xml to 2.2.0
if 'AndroidManifest.xml' in entries:
    manifest = entries['AndroidManifest.xml']
    u210 = '2.1.0'.encode('utf-16le')
    u100 = '1.0.0'.encode('utf-16le')
    u220 = '2.2.0'.encode('utf-16le')
    if u210 in manifest:
        entries['AndroidManifest.xml'] = manifest.replace(u210, u220)
        print("Updated AndroidManifest.xml from 2.1.0 to 2.2.0")
    elif u100 in manifest:
        entries['AndroidManifest.xml'] = manifest.replace(u100, u220)
        print("Updated AndroidManifest.xml from 1.0.0 to 2.2.0")
    elif u220 in manifest:
        print("AndroidManifest.xml already has 2.2.0")

# 3. Patch app.config to 2.2.0
if 'assets/app.config' in entries:
    cfg = entries['assets/app.config']
    entries['assets/app.config'] = cfg.replace(b'"2.1.0"', b'"2.2.0"').replace(b'"1.1.4"', b'"2.2.0"').replace(b'"1.0.0"', b'"2.2.0"')
    print("Updated assets/app.config to 2.2.0")

# 4. Write back APK
temp_apk = base_apk + '.tmp'
with zipfile.ZipFile(temp_apk, 'w', allowZip64=True) as z_out:
    for filename, data in entries.items():
        ctype = compress_types.get(filename, zipfile.ZIP_DEFLATED)
        zinfo = zipfile.ZipInfo(filename)
        zinfo.compress_type = ctype
        # Preserve executable permissions if needed
        zinfo.external_attr = 0o644 << 16
        z_out.writestr(zinfo, data)

# 5. Verify uncompressed bundle
with zipfile.ZipFile(temp_apk, 'r') as z_check:
    e = z_check.getinfo('assets/index.android.bundle')
    print(f"Bundle verification: compress_size={e.compress_size}, file_size={e.file_size}")
    assert e.compress_size == e.file_size, "Bundle must be uncompressed!"
    m = z_check.read('AndroidManifest.xml')
    assert u220 in m, "2.2.0 missing in manifest!"
    assert 'META-INF/services/kotlinx.coroutines.internal.MainDispatcherFactory' in z_check.namelist(), "Coroutine factory missing!"

# Replace original and create versioned copy
if os.path.exists(base_apk):
    os.remove(base_apk)
os.rename(temp_apk, base_apk)

import shutil
shutil.copy2(base_apk, v220_apk)

print(f"Successfully updated {base_apk} and {v220_apk} to v2.2.0!")
