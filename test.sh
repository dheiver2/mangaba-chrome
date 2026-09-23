#!/bin/bash

# ============================================
# TESTE COMPLETO — Mangaba Chrome v2.0.1
# Executar: ./test.sh
# ============================================

set -e

echo "🧪 TESTE LOCAL COMPLETO — v2.0.1"
echo "=================================="
echo ""

# ============================================
# TESTE 1: Verificar arquivos existem
# ============================================
echo "📋 TESTE 1: Arquivos existem?"
files=(
  "manifest.json"
  "sidepanel.html"
  "sidepanel.js"
  "sidepanel.css"
  "background.js"
  "mcp.js"
  "db.js"
  "offline.js"
  "icons/icon16.png"
  "icons/icon48.png"
  "icons/icon128.png"
)

failed=0
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file — NÃO ENCONTRADO"
    ((failed++))
  fi
done

echo ""

# ============================================
# TESTE 2: Validar manifest.json
# ============================================
echo "📋 TESTE 2: manifest.json válido?"

if command -v jq &> /dev/null; then
  if jq empty manifest.json 2>/dev/null; then
    VERSION=$(jq -r '.version' manifest.json)
    NAME=$(jq -r '.name' manifest.json)
    echo "  ✅ JSON válido"
    echo "    Nome: $NAME"
    echo "    Versão: $VERSION"

    if [ "$VERSION" = "2.0.1" ]; then
      echo "  ✅ Versão correta: 2.0.1"
    else
      echo "  ❌ Versão incorreta: $VERSION (esperado 2.0.1)"
      ((failed++))
    fi
  else
    echo "  ❌ JSON inválido"
    ((failed++))
  fi
else
  echo "  ⚠️  jq não instalado, pulando validação JSON"
fi

echo ""

# ============================================
# TESTE 3: Verificar sintaxe JavaScript
# ============================================
echo "📋 TESTE 3: Sintaxe JavaScript?"

if command -v node &> /dev/null; then
  js_files=(
    "sidepanel.js"
    "background.js"
    "mcp.js"
    "db.js"
    "offline.js"
  )

  for jsfile in "${js_files[@]}"; do
    if node --check "$jsfile" 2>/dev/null; then
      echo "  ✅ $jsfile"
    else
      echo "  ❌ $jsfile — ERRO DE SINTAXE"
      ((failed++))
    fi
  done
else
  echo "  ⚠️  node não instalado, pulando validação JS"
fi

echo ""

# ============================================
# TESTE 4: Verificar funções críticas
# ============================================
echo "📋 TESTE 4: Funções críticas existem?"

functions=(
  "showLoginModal:sidepanel.js"
  "hideLoginModal:sidepanel.js"
  "updateMcpStatus:sidepanel.js"
  "detectDeadlock:sidepanel.js"
  "segmentaSnapshotFn:background.js"
)

for func_info in "${functions[@]}"; do
  func=$(echo $func_info | cut -d: -f1)
  file=$(echo $func_info | cut -d: -f2)

  if grep -q "function $func\|const $func\|let $func" "$file" 2>/dev/null; then
    echo "  ✅ $func (em $file)"
  else
    echo "  ⚠️  $func não encontrado em $file"
  fi
done

echo ""

# ============================================
# TESTE 5: Verificar strings importantes
# ============================================
echo "📋 TESTE 5: Strings importantes?"

strings=(
  "Login Necessário:sidepanel.html"
  "pauseLogin:sidepanel.html"
  "btnLoginOK:sidepanel.html"
  "Deadlock detectado:sidepanel.js"
  "snapshot_segmentado:background.js"
)

for str_info in "${strings[@]}"; do
  str=$(echo $str_info | cut -d: -f1)
  file=$(echo $str_info | cut -d: -f2)

  if grep -q "$str" "$file" 2>/dev/null; then
    echo "  ✅ '$str' encontrado"
  else
    echo "  ❌ '$str' NÃO encontrado"
    ((failed++))
  fi
done

echo ""

# ============================================
# TESTE 6: Verificar tamanho dos arquivos
# ============================================
echo "📋 TESTE 6: Tamanho dos arquivos?"

total_size=0
for file in sidepanel.js background.js mcp.js db.js offline.js; do
  if [ -f "$file" ]; then
    size=$(wc -l < "$file")
    total_size=$((total_size + size))
    echo "  ✅ $file — $size linhas"
  fi
done

echo "  📊 Total: $total_size linhas de código"
echo ""

# ============================================
# TESTE 7: Verificar regex de detecção
# ============================================
echo "📋 TESTE 7: Regex de detecção?"

if grep -q "SENSITIVE_FIELD.*password" sidepanel.js; then
  echo "  ✅ SENSITIVE_FIELD detecta 'password'"
else
  echo "  ❌ SENSITIVE_FIELD não encontrado"
  ((failed++))
fi

if grep -q "DETECT_2FA" sidepanel.js; then
  echo "  ✅ DETECT_2FA existe"
else
  echo "  ❌ DETECT_2FA não encontrado"
  ((failed++))
fi

echo ""

# ============================================
# TESTE 8: Verificar testes de teste
# ============================================
echo "📋 TESTE 8: Arquivos de teste?"

test_files=(
  "TEST_LOGIN.md"
  "TEST_MANUAL.md"
  "TESTE_COMPLETO.md"
  "TEST_LOCAL.js"
)

for tfile in "${test_files[@]}"; do
  if [ -f "$tfile" ]; then
    echo "  ✅ $tfile"
  else
    echo "  ⚠️  $tfile não encontrado"
  fi
done

echo ""

# ============================================
# TESTE 9: Verificar git
# ============================================
echo "📋 TESTE 9: Git status?"

if command -v git &> /dev/null; then
  commits=$(git log --oneline | head -1)
  branch=$(git branch --show-current)

  echo "  ✅ Branch: $branch"
  echo "  ✅ Último commit: ${commits:0:50}"

  status=$(git status --porcelain)
  if [ -z "$status" ]; then
    echo "  ✅ Working tree limpo"
  else
    echo "  ⚠️  Working tree sujo (arquivos não commitados)"
  fi
else
  echo "  ⚠️  git não disponível"
fi

echo ""

# ============================================
# RESUMO FINAL
# ============================================
echo "=================================="
echo "🎉 TESTE LOCAL COMPLETO"
echo "=================================="
echo ""

if [ $failed -eq 0 ]; then
  echo "✅ TODOS OS TESTES PASSARAM!"
  echo ""
  echo "🚀 Próximos passos:"
  echo "  1. npm install"
  echo "  2. npm run build:dev"
  echo "  3. chrome://extensions/ > Load unpacked"
  echo "  4. Testar em GitHub: https://github.com/login"
  exit 0
else
  echo "❌ $failed TESTE(S) FALHARAM"
  echo ""
  echo "⚠️  Verificar erros acima"
  exit 1
fi
