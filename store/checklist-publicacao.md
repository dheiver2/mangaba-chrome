# Checklist para publicar na Chrome Web Store

## Antes de enviar
- [ ] Conta de desenvolvedor criada (taxa única de US$ 5), no nome de quem responde pela extensão.
- [ ] Zip de produção gerado (`bash build.sh prod`) e testado com o `dist/` carregado no Chrome.
- [ ] Versão no `manifest.json` maior que a publicada anteriormente.
- [ ] Ícones 16, 48 e 128 px no pacote (já existem em `icons/`).
- [ ] Pelo menos 1 captura de tela de 1280×800 (ou 640×400) mostrando o painel em uso.
- [ ] Imagem promocional pequena (440×280) e, se quiser, a grande (920×680).
- [ ] Texto da loja: `store/descricao.md`.
- [ ] Justificativas de permissão: `store/justificativas-permissoes.md`.

## Política de privacidade
- [ ] Preencher a data, o e-mail de contato e o canal de pedidos em `store/politica-de-privacidade.md`.
- [ ] Publicar o texto em uma URL pública. O repositório é privado, então precisa de outra hospedagem (ex.: uma página no site da Mangaba).
- [ ] Informar essa URL no campo "Privacy policy" da loja.

## Pendências técnicas que a revisão pode cobrar
- [ ] **Exclusão de conta:** a API ainda não tem `DELETE` para a conta. A política promete o botão no painel, então a rota e o botão precisam existir antes de publicar.
- [ ] **Texto de LEGAL.md:** diz "sem coleta de dados pessoal sem consentimento" e não cita conta nem sincronização. Atualizar para bater com a política.
- [ ] **Licença:** o LEGAL.md é proprietário. A Chrome Web Store aceita, mas a loja mostra o texto de licença ao instalar; confirme que é isso que você quer.
- [ ] **Limite de dados enviados:** confirmar que o painel avisa, antes da primeira tarefa, que o conteúdo da página vai ao servidor do agente.

## Depois de enviar
- [ ] A revisão costuma levar de alguns dias a algumas semanas, por causa das permissões amplas.
- [ ] Se for rejeitada, o motivo vem por e-mail. Responda com a justificativa do arquivo correspondente.
