#!/bin/bash

# Build script para Mangaba Chrome v1.19.0 — Minificação + Obfuscação
# Uso: ./build.sh [dev|prod]

MODE=${1:-prod}
DIST_DIR="dist"
BUILD_DIR="build"

echo "🔨 Building Mangaba Chrome ($MODE mode)..."

# Criar diretório de distribuição
mkdir -p "$DIST_DIR"
mkdir -p "$BUILD_DIR"

# Copiar arquivos estáticos
cp -r icons "$DIST_DIR/"
cp manifest.json "$DIST_DIR/"
cp *.html "$DIST_DIR/"
cp *.css "$DIST_DIR/" 2>/dev/null || true

echo "📦 Arquivo estáticos copiados"

# Minificar HTML
if command -v html-minifier &> /dev/null; then
  html-minifier --collapse-whitespace --remove-comments \
    "$DIST_DIR/sidepanel.html" -o "$DIST_DIR/sidepanel.html"
  echo "✓ HTML minificado"
else
  echo "⚠ html-minifier não instalado (opcional)"
fi

# Minificar CSS
if command -v cleancss &> /dev/null; then
  cleancss "$DIST_DIR/sidepanel.css" -o "$DIST_DIR/sidepanel.css"
  echo "✓ CSS minificado"
else
  echo "⚠ cleancss não instalado (opcional)"
fi

# Minificar + Ofuscar JavaScript
if command -v terser &> /dev/null; then
  echo "🔐 Ofuscando JavaScript..."

  for js_file in sidepanel.js background.js mcp.js db.js offline.js; do
    if [ -f "$js_file" ]; then
      terser "$js_file" \
        --compress passes=3,pure_funcs=console.log \
        --mangle \
        --output "$DIST_DIR/$js_file" \
        --source-map "url=inline"
      echo "✓ $js_file minificado/ofuscado"
    fi
  done
else
  # Fallback: npm install terser
  echo "⚠ Terser não instalado. Instalando..."
  npm install -g terser
  exec "$0" "$MODE"
fi

# Atualizar versão no manifest
VERSION=$(grep '"version"' manifest.json | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
echo "📌 Versão: $VERSION"

# Criar ZIP para Chrome Web Store
RELEASE_ZIP="mangaba-chrome-$VERSION.zip"
cd "$DIST_DIR"
zip -r "../$RELEASE_ZIP" . -q
cd ..

echo "📦 Release criado: $RELEASE_ZIP"

# Estatísticas
echo ""
echo "📊 Estatísticas:"
echo "  Tamanho original: $(du -sh . | cut -f1)"
echo "  Tamanho build: $(du -sh $DIST_DIR | cut -f1)"
echo "  ZIP size: $(ls -lh $RELEASE_ZIP | awk '{print $5}')"

echo ""
if [ "$MODE" = "prod" ]; then
  echo "✅ Build PRODUCTION pronto!"
  echo "   Arquivo: $RELEASE_ZIP"
  echo "   Upload em: https://chrome.google.com/webstore/devconsole"
else
  echo "✅ Build DESENVOLVIMENTO pronto!"
  echo "   Carregar em chrome://extensions/ > Load unpacked > $DIST_DIR"
fi
