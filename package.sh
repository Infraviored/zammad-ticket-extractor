#!/bin/bash
# Package Firefox extension for production

EXTENSION_NAME="ticket-extractor"
VERSION=$(grep '"version"' manifest.json | cut -d'"' -f4)
OUTPUT_DIR="dist"
ZIP_FILE="${OUTPUT_DIR}/${EXTENSION_NAME}-v${VERSION}.zip"

echo "Packaging Firefox extension v${VERSION}..."

# Create output directory
mkdir -p "${OUTPUT_DIR}"

# Files to include
FILES=(
  "manifest.json"
  "background.js"
  "popup.html"
  "popup.js"
  "icon.svg"
)

# Create zip file
echo "Creating ${ZIP_FILE}..."
cd extension
zip -r "../${ZIP_FILE}" "${FILES[@]}" -x "*.DS_Store" "*.git*"
cd ..

echo "✓ Extension packaged: ${ZIP_FILE}"
echo ""
echo "To install in Firefox:"
echo "1. Open Firefox"
echo "2. Go to about:debugging"
echo "3. Click 'This Firefox'"
echo "4. Click 'Load Temporary Add-on'"
echo "5. Select the manifest.json file"
echo ""
echo "Or use web-ext:"
echo "  web-ext run"
echo ""
echo "To build for AMO submission:"
echo "  web-ext build --source-dir=extension --artifacts-dir=${OUTPUT_DIR}"

