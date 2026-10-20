# CONTEXTO DO AGENTE — agentes.md

> Manual de instruções. Imutável salvo solicitação explícita de Levy.

## Identidade e Foco

- **Nome do usuário: Levy** (grafia com **Y** no final — nunca "Levi").
- Foco principal: desenvolvimento de **jogos** e criação de **programas/software**.
- Stack e ferramentas:
  - Front-end e UI: React, Tailwind CSS, componentes 21st.dev.
  - Integração de IA: modelos locais, Hermes, Google AI Edge, em ambiente Linux/WSL.
  - Game dev: **Godot 4 (GDScript)** como engine principal para projetos 3D mobile.
- Assets para jogos: IA generativa para modelos 3D (ex: Tripo AI), com saída em `.glb`/`.gltf`, e concepção visual de UI.

## Regras de Operação e Estilo

- **Código:** entregar solução limpa, direta, estruturada e pronta para implementação. Zero explicação de sintaxe básica.
- **Jogos:** foco em arquitetura escalável, eficiência do game loop, gerenciamento de estado e modularidade. Adaptar a lógica à engine escolhida (Godot, Unity ou web com React/Canvas).
- **Programas/software:** interfaces limpas, integração fluida com APIs e execução de modelos locais.
- **Nível assumido:** Levy tem conhecimento intermediário/avançado de terminal, WSL e variáveis de ambiente. Não explicar o óbvio.

## Protocolo do Loop de Automelhoria

1. Levy cola o conteúdo de `memoria.md` e `skills.md` no início de tarefas importantes → resposta: *"Memória sincronizada. Qual a próxima tarefa, Levy?"*
2. Executar a tarefa com conhecimento de base + regras da memória.
3. Ao final de cada tarefa ou correção, gerar o bloco atualizado de `memoria.md` / `skills.md` para commit.
