# Extensão Chrome de acesso rápido ao screenshot-to-code

Data: 2026-09-09
Estado: aprovado, a aguardar plano de implementação

## Objectivo

Dar acesso fácil, a partir de qualquer separador do Chrome, à instância local
do screenshot-to-code (frontend em `localhost:5173`, backend em
`localhost:7001`), sem obrigar a fazer upload manual de ficheiros a cada vez.

Não objectivo: capturar fora do browser (ecrã inteiro, outras aplicações).
Isso fica reservado para uma eventual app de barra de menu do macOS, como
sub-projecto separado, a decidir depois de usar esta extensão durante uns
tempos.

## Arquitectura

A extensão não reimplementa a geração de código. O endpoint `/generate-code`
do backend é um WebSocket com um protocolo com doze tipos de mensagem
(streaming de variantes, chamadas de ferramentas, histórico). Replicar isso
na extensão seria frágil e duplicava lógica que já existe e funciona.

Em vez disso, a extensão **entrega a captura ao separador do
screenshot-to-code já existente**, que continua a fazer todo o trabalho
pesado. A extensão só:

1. Captura a imagem (quatro gatilhos, ver abaixo)
2. Abre ou foca o separador `localhost:5173` e entrega-lhe a imagem
3. Quando a geração termina, recebe o código final de volta e aplica as
   saídas activas (painel lateral, área de transferência, ficheiro)

O backend já tem CORS aberto (`allow_origins=["*"]`), pelo que chamadas
directas do service worker ou content scripts não têm bloqueios adicionais
a resolver.

### Componentes

- **Extensão Chrome (Manifest V3)**, pasta nova `extension/` no mesmo
  repositório, TypeScript, build com Vite (mesmo padrão do frontend já
  existente)
  - `background/` — service worker: gere captura, storage temporário,
    abertura/foco do separador, aplica saídas ao receber o resultado
  - `content/capture.ts` — injectado em qualquer página, trata da
    selecção de área (overlay + recorte por canvas) e do menu de contexto
  - `content/bridge.ts` — injectado apenas no separador do
    screenshot-to-code, escuta o `postMessage` de "código pronto" e
    reencaminha para o background; também injecta a imagem capturada
    quando o separador é aberto de propósito para isto
  - `sidepanel/` — painel lateral (Chrome Side Panel API) que mostra o
    código gerado quando activo
  - `options/` — página de definições
- **Alteração mínima no frontend existente**: um `postMessage` disparado
  quando uma variante de código fica completa (`variantComplete`), e
  leitura de uma imagem de arranque vinda da extensão via
  `chrome.storage.local` quando a página é aberta com esse propósito.
  Único ponto de contacto com o código da aplicação em si.
- **Sem alterações ao backend.**

## Fluxos de captura

Quatro gatilhos, todos a resultar na mesma entrega (imagem guardada em
`chrome.storage.local`, separador aberto ou focado, imagem entregue à
página):

| Gatilho | Comportamento |
| --- | --- |
| Ícone da barra de ferramentas (por omissão) | `chrome.tabs.captureVisibleTab` no separador activo, captura a página inteira visível |
| Selecção de área | Ao clicar, sobrepõe uma camada semi-transparente na página para desenhar um rectângulo; a extensão recorta a captura completa a essa área com canvas |
| Atalho de teclado | Configurável nas definições (tecla, e se dispara página inteira ou selecção de área); desactivado por omissão |
| Menu de contexto | Botão direito sobre uma imagem da página, "Gerar código a partir disto"; usa a imagem tal como está, sem novo screenshot |

## Resultado e definições

Página de opções da extensão:

- Endereços do frontend e do backend, editáveis, por omissão
  `http://localhost:5173` e `http://localhost:7001`
- Painel lateral, interruptor liga/desliga
- Cópia automática para a área de transferência, três estados: desligado,
  automático, perguntar sempre
- Guardar como ficheiro, interruptor liga/desliga (nome e extensão de
  acordo com a stack escolhida na geração)
- Abrir sempre o separador com o resultado completo não é opcional; é onde
  a geração acontece de facto, as restantes saídas são espelhos desse
  resultado

Quando o gancho de `postMessage` avisa que uma variante terminou, o
service worker aplica as saídas activas por esta ordem: painel lateral,
área de transferência, ficheiro.

## Erros

- Backend em baixo ao tentar entregar a imagem: aviso claro na extensão
  (badge de erro + mensagem), sem falha silenciosa
- Separador do screenshot-to-code fechado a meio do processo: a extensão
  reabre e tenta entregar a imagem outra vez
- Permissão de captura de ecrã recusada pelo Chrome: mensagem explicativa
  com instruções para autorizar

## Testes

Sem framework pesado, é uma extensão de browser pequena:

- Verificação de build: `tsc --noEmit` sem erros, `manifest.json` válido
  (carregar como extensão não empacotada no Chrome)
- Checklist manual de QA, um percurso por combinação relevante:
  - Cada um dos quatro gatilhos de captura, isoladamente
  - Cada saída (painel lateral, área de transferência, ficheiro) activada
    sozinha e todas juntas
  - Backend desligado no momento da entrega
  - Separador do screenshot-to-code fechado antes da geração terminar

## Fora de âmbito desta fase

- App de barra de menu do macOS (sub-projecto próprio, a decidir depois)
- Publicação na Chrome Web Store (uso pessoal, carregada como extensão
  não empacotada)
- Suporte a outros browsers (Firefox, Safari)
