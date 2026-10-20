# Orienta??es deste projeto

- Altera??es solicitadas nesta etapa s?o exclusivamente de UI. Preserve funcionalidades, autentica??o, APIs, dados e regras de neg?cio.
- Preserve a paleta original: tema escuro e rosa principal `#ed3b91`. Esta instru??o prevalece sobre sugest?es de fundos claros no padr?o abaixo.
- Aplique as bibliotecas de apresenta??o conforme a necessidade real; n?o adicione gr?ficos, anima??es ou conte?do apenas para usar uma depend?ncia.

# PADRÃO GLOBAL DE UI DO PROJETO

Quero que toda a interface deste projeto siga rigorosamente este padrão visual.

## Stack obrigatória

Utilize:

* Next.js
* React
* TypeScript
* Tailwind CSS
* shadcn/ui
* Lucide React para todos os ícones
* Motion para animações e microinterações
* Recharts para gráficos
* `clsx`
* `tailwind-merge`
* `class-variance-authority`

Quando necessário, utilize também:

* `date-fns` para datas
* `sonner` para notificações/toasts

Não introduza outra biblioteca de UI sem necessidade.

---

# Dependências

Caso ainda não estejam instaladas:

```bash
npm install lucide-react motion recharts clsx tailwind-merge class-variance-authority date-fns sonner
```

Inicialize o shadcn:

```bash
npx shadcn@latest init
```

Adicione os componentes necessários:

```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add card
npx shadcn@latest add badge
npx shadcn@latest add table
npx shadcn@latest add dropdown-menu
npx shadcn@latest add select
npx shadcn@latest add avatar
npx shadcn@latest add tooltip
npx shadcn@latest add separator
npx shadcn@latest add sheet
npx shadcn@latest add skeleton
npx shadcn@latest add sidebar
npx shadcn@latest add sonner
```

---

# Objetivo visual

A interface deve parecer um produto SaaS premium moderno.

Referências visuais:

* Linear
* Vercel
* Stripe Dashboard
* dashboards modernos construídos com shadcn/ui

O resultado precisa transmitir:

* limpeza
* organização
* alta legibilidade
* bastante espaço de respiro
* hierarquia visual clara
* aparência profissional
* sensação de software moderno
* interface leve e rápida

Evite aparência de template genérico.

---

# REGRA MAIS IMPORTANTE: NÃO USAR BLOCOS DENTRO DE BLOCOS

Evite completamente criar vários cards dentro de outro card.

NÃO fazer:

```txt
Card principal
 ├── Card
 ├── Card
 └── Card
```

Também evitar:

```txt
Container com fundo
 └── outro container
      └── outro card
```

Prefiro:

```txt
Página
 ├── Card
 ├── Card
 ├── Card
 ├── Gráfico
 ├── Tabela
 └── Card
```

Cada grupo de informação deve possuir **um único bloco visual principal**.

Cards devem ficar diretamente sobre o background da página.

Não criar containers intermediários apenas para agrupar outros cards.

Use `grid`, `flex`, `gap` e espaçamento para estruturar a página.

---

# Background

Background geral:

```css
bg-background
```

ou equivalente visual próximo de:

```css
#fafafa
#fbfbfc
#f8f9fa
```

Nunca utilizar grandes blocos cinza envolvendo toda a área de conteúdo.

O background deve ser neutro e muito claro.

Os cards ficam sobre esse background.

---

# Cards

Cards são um dos principais elementos visuais.

Utilizar aproximadamente:

```tsx
className="
  rounded-xl
  border
  border-border/60
  bg-card
  shadow-sm
"
```

Características:

* branco ou quase branco
* border extremamente sutil
* sombra suave
* sem sombra pesada
* cantos arredondados entre 10px e 14px
* sem efeito glass exagerado
* sem bordas grossas
* sem gradients desnecessários

Padding padrão:

```txt
20px a 24px
```

Gap entre cards:

```txt
16px a 24px
```

---

# Sombras

Usar sombras discretas.

Exemplo:

```css
shadow-sm
```

ou:

```css
shadow-[0_1px_3px_rgba(0,0,0,0.04)]
```

No hover, quando fizer sentido:

```css
hover:shadow-md
```

A sombra nunca deve chamar mais atenção que o conteúdo.

---

# Border radius

Padronizar aproximadamente:

```txt
Cards: 12px
Inputs: 8px
Buttons: 8px
Badges: 6px
Modais: 14px
```

Não utilizar arredondamento exagerado em tudo.

Evitar estilo excessivamente "bubble".

---

# Tipografia

Usar fonte limpa e moderna.

Preferência:

```txt
Geist
```

Pode usar a integração de fontes do Next.js.

Hierarquia:

### Título principal

```txt
28px a 32px
font-semibold
tracking-tight
```

### Título de card

```txt
14px a 16px
font-semibold
```

### Valores importantes

```txt
24px a 30px
font-semibold
tracking-tight
```

### Texto normal

```txt
14px
```

### Texto secundário

```txt
12px a 13px
text-muted-foreground
```

Evite excesso de `font-bold`.

Prefira:

```txt
font-medium
font-semibold
```

---

# Cores

A interface deve ser predominantemente neutra.

Utilizar:

* branco
* cinza muito claro
* cinza neutro
* preto/chumbo para texto

Escolher apenas **uma cor principal da marca**.

Exemplo:

```txt
indigo
violet
blue
```

Essa cor deve aparecer principalmente em:

* item ativo
* links
* gráficos
* pequenos ícones
* focus
* botões principais

Não espalhar dezenas de cores pela UI.

---

# Cores de estado

Somente estados podem utilizar cores diferentes.

### Sucesso

```txt
verde suave
```

### Aviso

```txt
amarelo/laranja suave
```

### Erro

```txt
vermelho suave
```

### Informação

```txt
azul suave
```

Badges devem ter background extremamente claro.

Exemplo:

```tsx
bg-emerald-50
text-emerald-700
```

Evite badges altamente saturadas.

---

# Layout principal

Para dashboards desktop:

```txt
Sidebar fixa
+
Área principal
```

Estrutura aproximada:

```txt
┌──────────────┬────────────────────────────────────────────┐
│              │ Dashboard         Search    Date    User   │
│              │                                            │
│   Sidebar    │ KPI     KPI       KPI       KPI            │
│              │                                            │
│              │ Sales Chart       Recent Orders            │
│              │                                            │
│              │ Payments   Products      Activity          │
│              │                                            │
└──────────────┴────────────────────────────────────────────┘
```

---

# Sidebar

Desktop:

```txt
240px a 260px
```

Características:

* fundo branco
* border-right sutil
* logo no topo
* navegação vertical
* ícone + texto
* espaçamento confortável
* grupos bem separados

Não colocar cada item da sidebar dentro de cards.

Itens normais devem ser praticamente transparentes.

Exemplo:

```tsx
className="
  flex
  h-10
  items-center
  gap-3
  rounded-lg
  px-3
  text-sm
  text-muted-foreground
  transition-colors
  hover:bg-muted
  hover:text-foreground
"
```

Item ativo:

```tsx
className="
  bg-primary/10
  text-primary
  font-medium
"
```

Usar exclusivamente Lucide React nos ícones.

---

# Header

O header da página deve conter:

### Esquerda

Título:

```txt
Dashboard
```

### Direita

Quando necessário:

* busca
* filtro de período
* notificações
* avatar
* menu do usuário

Não exagerar em elementos.

Altura aproximada:

```txt
64px a 72px
```

Não precisa necessariamente ser um card.

---

# Área de conteúdo

Usar largura total disponível.

Não criar aquele padrão:

```txt
████████ fundo cinza
   █████ card interno
```

Prefiro aproveitar praticamente toda a largura da página.

Exemplo:

```tsx
<main className="flex-1 p-6 lg:p-8">
```

Pode utilizar:

```tsx
max-w-[1600px]
```

em monitores muito grandes.

---

# Grid

Priorizar CSS Grid.

Exemplo:

```tsx
grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4
```

Para área principal:

```tsx
grid grid-cols-1 gap-5 xl:grid-cols-12
```

Exemplo:

```txt
Gráfico:
xl:col-span-7

Pedidos:
xl:col-span-5
```

---

# Cards de KPI

Cada KPI deve ser um card independente.

Estrutura:

```txt
Revenue       +14.2%

R$ 128.430

comparado ao período anterior         [ícone]
```

Não criar vários mini-cards dentro dele.

O ícone pode ficar dentro de um pequeno container quadrado.

Exemplo:

```tsx
<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
```

Esse pequeno container é permitido porque funciona apenas como suporte visual para o ícone.

---

# Ícones

Usar:

```tsx
lucide-react
```

Exemplo:

```tsx
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Users,
  ChartNoAxesCombined,
  Settings,
  Search,
  Bell,
  CalendarDays,
  ArrowUpRight,
} from "lucide-react"
```

Tamanho padrão:

```txt
16px a 20px
```

Stroke:

```txt
1.5 a 2
```

Não misturar bibliotecas de ícones.

---

# Gráficos

Usar:

```txt
Recharts
```

Visual:

* linhas finas
* grid quase invisível
* poucas cores
* labels discretas
* tooltip limpo
* sem bordas pesadas
* sem fundos escuros
* animações sutis

Exemplo visual:

```txt
linha principal: cor primary
linha comparação: cinza tracejada
```

Evitar:

* gráficos 3D
* gradients fortes
* dez cores diferentes
* legenda enorme
* elementos decorativos desnecessários

---

# Tabelas

As tabelas devem estar diretamente dentro de um único card.

Estrutura:

```txt
Recent Orders                         View all

Order       Customer      Date       Status      Total
-------------------------------------------------------
#1048       João           ...        Pago        ...
#1047       Maria          ...        Aberto      ...
```

Características:

* header discreto
* linhas separadoras claras
* altura confortável
* badges suaves
* hover extremamente leve
* números alinhados corretamente

Não colocar cada linha dentro de um card.

---

# Botões

Utilize componentes shadcn.

Botão primário:

```txt
solid
cor primary
```

Secundário:

```txt
outline
```

Terciário:

```txt
ghost
```

Evite criar dez tipos diferentes de botão.

Botões devem usar:

```txt
transition-colors
duration-150
```

---

# Inputs

Inputs:

* altura aproximadamente 40px
* border sutil
* background branco
* focus ring discreto
* placeholder suave

Exemplo:

```tsx
className="
  h-10
  rounded-lg
  border-border
  bg-background
  shadow-none
"
```

---

# Microinterações

Utilize Motion apenas quando melhorar a experiência.

Import:

```tsx
import { motion } from "motion/react"
```

Animações devem ser extremamente sutis.

Duração:

```txt
150ms a 250ms
```

Exemplo de entrada:

```tsx
initial={{ opacity: 0, y: 4 }}
animate={{ opacity: 1, y: 0 }}
transition={{ duration: 0.2 }}
```

Hover:

```tsx
whileHover={{ y: -1 }}
```

Não utilizar:

* cards voando
* scale exagerado
* bounce
* elastic
* animações longas
* animações simplesmente decorativas

A interface deve parecer rápida.

---

# Hover

Cards clicáveis:

```txt
border ligeiramente mais visível
shadow ligeiramente maior
```

Links:

```txt
mudança suave de cor
```

Linhas de tabela:

```txt
background extremamente sutil
```

Nada deve saltar excessivamente.

---

# Loading

Não utilizar spinners gigantes.

Preferir:

```txt
Skeleton
```

Usar `Skeleton` do shadcn mantendo exatamente a estrutura da tela.

---

# Empty states

Estados vazios devem ser simples.

Exemplo:

```txt
ícone

Nenhuma venda encontrada

As vendas realizadas neste período aparecerão aqui.

[Adicionar venda]
```

Não criar grandes ilustrações desnecessárias.

---

# Responsividade

Desktop deve ser prioridade para:

* PDV
* dashboards
* administrativos
* relatórios

Mas tudo deve funcionar em mobile.

Breakpoints:

```txt
sm
md
lg
xl
2xl
```

No mobile:

* sidebar vira Sheet
* grids viram uma coluna
* tabelas podem possuir scroll horizontal
* ações secundárias podem ir para DropdownMenu

Não diminuir elementos até ficarem ilegíveis.

---

# Espaçamento

Utilizar escala consistente.

Preferência:

```txt
4
8
12
16
20
24
32
```

Exemplo:

```tsx
gap-4
gap-5
gap-6

p-4
p-5
p-6
```

Evitar valores arbitrários sem necessidade.

---

# Densidade

Quero uma interface com bastante informação, porém sem parecer apertada.

Não quero:

* cards enormes sem necessidade
* espaços vazios gigantes
* dezenas de elementos simultâneos
* título + subtítulo + descrição + explicação em todo card

A informação deve ser direta.

---

# Estrutura dos componentes

Organize aproximadamente assim:

```txt
src/
├── app/
├── components/
│   ├── ui/
│   │   └── componentes shadcn
│   │
│   ├── layout/
│   │   ├── app-sidebar.tsx
│   │   ├── app-header.tsx
│   │   └── page-container.tsx
│   │
│   ├── dashboard/
│   │   ├── metric-card.tsx
│   │   ├── sales-chart.tsx
│   │   ├── recent-orders.tsx
│   │   ├── payment-methods.tsx
│   │   ├── top-products.tsx
│   │   └── activity-feed.tsx
│   │
│   └── shared/
│
├── hooks/
├── lib/
├── types/
└── styles/
```

Não criar arquivos gigantescos.

Separar componentes quando houver reutilização real ou responsabilidade visual clara.

Não fragmentar componentes pequenos sem necessidade.

---

# Dashboard de referência

Ao criar uma dashboard, utilize aproximadamente esta composição:

## Header

```txt
Dashboard

[Search] [Período] [Notificação] [Usuário]
```

## Primeira linha

Quatro KPIs:

```txt
Faturamento
Pedidos
Ticket médio
Clientes
```

## Segunda linha

```txt
Gráfico de vendas          Pedidos recentes
```

Proporção aproximada:

```txt
60% / 40%
```

## Terceira linha

```txt
Formas de pagamento
Produtos mais vendidos
Atividades recentes
```

Três blocos independentes.

---

# Regra de conteúdo

Não preencher a tela apenas porque existe espaço disponível.

Se uma informação não for importante, não crie um card para ela.

Priorize:

1. informação que exige decisão
2. informação que precisa ser consultada rapidamente
3. principais ações
4. detalhes secundários

---

# Regra contra poluição visual

Antes de adicionar qualquer elemento, pergunte internamente:

> Este elemento ajuda o usuário a tomar uma decisão ou executar uma ação?

Se não, provavelmente não precisa existir.

---

# Não utilizar

Evite:

* glassmorphism exagerado
* gradients fortes
* neon
* sombras pesadas
* border radius exagerado
* cards dentro de cards
* containers dentro de containers sem função
* excesso de badges
* excesso de ícones
* fundos cinza enormes envolvendo cards
* menus extremamente coloridos
* animações chamativas
* elementos gigantes apenas decorativos
* textos longos onde um label resolveria
* componentes diferentes executando a mesma função

---

# Qualidade de implementação

O código deve ser:

* limpo
* organizado
* reutilizável
* TypeScript
* responsivo
* fácil de alterar
* sem duplicação desnecessária
* sem abstrações prematuras

Sempre prefira componentes do shadcn quando existir equivalente.

Não recrie manualmente:

* Button
* Dialog
* Dropdown
* Select
* Tooltip
* Sheet
* Badge
* Avatar

se o shadcn já possuir o componente.

---

# Acessibilidade

Manter:

* contraste adequado
* `aria-label` quando necessário
* navegação via teclado
* `focus-visible`
* labels corretos
* botões reais para ações
* links reais para navegação

---

# Regra final

Ao desenvolver ou refatorar qualquer página deste projeto:

1. preserve a identidade visual existente da marca;
2. aplique este design system;
3. remova agrupamentos visuais desnecessários;
4. não crie cards dentro de cards;
5. utilize largura da tela de forma eficiente;
6. mantenha espaçamento consistente;
7. utilize shadcn como base;
8. utilize Lucide para ícones;
9. use Motion apenas para microinterações;
10. mantenha o visual próximo de Linear/Vercel/Stripe;
11. priorize clareza sobre decoração;
12. não altere funcionalidades existentes apenas para melhorar o visual.

Quando eu solicitar uma nova página sem fornecer instruções visuais adicionais, este padrão deve ser considerado o padrão visual oficial do projeto.
