#!/bin/bash
# Aplica a rota conta.mangaba.ia.br -> backend de contas (porta 8792) no túnel mangaba-prod.
# Rodar na VPS projeto-ia, uma vez. Faz backup, insere a regra antes do catch-all,
# valida, reinicia o cloudflared e testa o endereço. Idempotente.
set -euo pipefail
CFG=/etc/cloudflared/config.yml
SERVICO=cloudflared-mangaba
HOST=conta.mangaba.ia.br
PORTA=8792

sudo cp "$CFG" "$CFG.bak-conta-$(date +%Y%m%d%H%M)"

if sudo grep -q "hostname: $HOST" "$CFG"; then
  echo "regra já existe"
else
  sudo python3 - "$CFG" "$HOST" "$PORTA" <<'PY'
import re, sys
cfg, host, porta = sys.argv[1], sys.argv[2], sys.argv[3]
texto = open(cfg, encoding="utf-8").read()
regra = f"  - hostname: {host}\n    service: http://localhost:{porta}\n"
novo, n = re.subn(r"(?m)^(\s*- service: http_status:404)", regra + r"\1", texto, count=1)
if n != 1:
    sys.exit("catch-all http_status:404 não encontrado; nada alterado")
open(cfg, "w", encoding="utf-8").write(novo)
print("regra inserida")
PY
fi

sudo cloudflared tunnel --config "$CFG" ingress validate
sudo systemctl restart "$SERVICO"
sleep 8
echo "teste: $(curl -s -m 20 https://$HOST/health)"
