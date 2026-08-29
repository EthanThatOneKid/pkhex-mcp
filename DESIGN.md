---
colors:
  primary: "#384048"
  secondary: "#788898"
  background: "#385888"
  surface: "#F8F8F8"
  surface_alt: "#FFFFD8"
  text: "#202020"
  text_light: "#FFFFFF"
  accent_red: "#E04038"
  accent_blue: "#4080D0"
  accent_yellow: "#F8B800"
  border_dark: "#182028"
  border_light: "#B8C0C8"
  gender_male: "#3870E0"
  gender_female: "#E85870"
  hp_green: "#30B040"
typography:
  fontFamily: "'Pokemon DP', 'Power Green', 'Courier New', monospace"
  fontSizeBase: "16px"
  fontSizeHeader: "20px"
  fontSizeTitle: "24px"
  fontWeight: "bold"
  lineHeight: "1.25"
layout:
  gridBase: "4px"
  borderWidth: "2px"
  windowPadding: "8px"
  dualScreenGap: "16px"
---

# Pokémon Generation 4 UI Design System Specification

A comprehensive design specification standard for interfaces inspired by the Pokémon Generation 4 (Diamond, Pearl, Platinum, HeartGold, SoulSilver) Nintendo DS era UI paradigm.

---

## Visual Theme & Atmosphere

The Generation 4 visual aesthetic balances strict grid alignment and pixel-art precision with soft, functional color coding suited for dual-screen Nintendo DS hardware.

* **Tech-Industrial Dual-Screen Functionalism:** Emphasizes high-contrast content containers, heavy drop-bevel borders, grid-aligned lists, and clean separation between primary visual displays (Top Screen) and direct interactive touch controls (Bottom Screen/Poketch style).
* **Tactile Retro-Digital Hybrid:** Surfaces evoke physical plastic housings, digital LCD backlighting, and scanline/dithered textures with rounded chamfered corners.
* **Pixel Density & Crispness:** Crisp, pixel-exact rendering without bilinear smoothing on 2D UI elements, icons, and typography.

---

## Colors

Color is heavily categorized by function, screen status, and interactive affordance. Palette values strictly adhere to 15-bit RGB color depth characteristics.

### Base Surface & Container Palette
* **Deep Screen Background (`#385888`):** Dominant dark slate blue background for multi-window interfaces, battle HUD overlays, and trading screens.
* **Card Surface Light (`#F8F8F8`):** Clean cream-white used for core text display boxes, dialogue overlays, and detail containers.
* **ListItem Selected (`#FFFFD8`):** Warm pale yellow background tint highlighting the currently selected active item in a list or Pokédex menu.
* **Secondary Container Slate (`#788898`):** Cool desaturated blue-grey used for secondary status boxes, inactive tabs, and sidebar labels.
* **Dark Border Ink (`#182028`):** Near-black framing border for UI windows, text dialog boxes, and sharp inner outlines.

### Functional & State Colors
* **Action Primary Red (`#E04038`):** High-priority interactive triggers, primary battle action buttons (FIGHT), exit buttons (CLOSE / QUIT), and Pokédex index indicators.
* **Accent Info Blue (`#4080D0`):** Secondary interactive controls, header banners (SINNOH POKÉDEX), and male gender indicators (`#3870E0`).
* **Highlight Gold (`#F8B800`):** Frame inner trims, sub-menu selectors, and trophy/badge highlights.
* **Female Gender Accent (`#E85870`):** Soft magenta red used for female demographic indicators.
* **HP / Positive Status (`#30B040`):** Vivid kelly green used for full health indicators and positive metric bars.

---

## Typography

Generation 4 typography uses monospace pixel fonts with fixed-width glyphs, high contrast, and zero anti-aliasing to retain crisp readability on low-resolution displays.

* **Primary Font Family:** `Pokemon DP`, `Power Green`, or a pixel-accurate monospace bitmap equivalent.
* **Text Transformation:** Standard text utilizes sentence case for dialogue ("What will TURTWIG do?") and strict ALL-CAPS for character names, items, move names, and UI callouts (`TURTWIG`, `MACHOP`, `SINNOH POKEDEX`, `PARTY POKÉMON`).
* **Drop Shadowing:** Text within white dialog boxes or clear UI panels features a subtle 1px offset drop shadow down and to the right in `#989898` or `#404040`.

---

## Layout Principles

Layouts follow strict two-screen architectural rules designed for top-display information visualization and bottom-display direct interaction.

* **Dual-Screen Layout Ratio:** Native visual proportion of two stacked 256x192 resolution viewports separated by a 16px vertical gap.
* **Beveled Window Enclosures:** All primary windows are framed in multi-layered borders: outer 2px dark border (`#182028`), inner 2px light bevel highlight (`#B8C0C8`), and content body (`#F8F8F8`).
* **Asymmetric Action Tabs:** Interactive bottom-screen controls feature trapezoid or chamfered action tabs angled at 45 degrees along corner joints (e.g., `PARTY POKÉMON` and `CLOSE` buttons).
* **Grid Alignment:** Grid layouts adhere strictly to 4px and 8px base grid increments. Item grids (e.g., Storage Boxes) utilize fixed cell dimensions (e.g., 24x24px or 32x32px per icon cell).

---

## Shapes & Elevation

* **Framed Panels:** Flat surface blocks surrounded by heavy 2px or 3px solid outlines. Floating panels do not use modern soft blurs; depth is established through hard 1px/2px offset pixel shadows.
* **Chamfered Angles:** Buttons and window headers drop the top-right or bottom-left corner at a sharp 45-degree angle.
* **Status Bars & Badges:** Rounded pill shapes (border-radius: ~8px) for health/status readouts (`HP`, `Lv. 5`), inset into dark grey backings.

---

## Components

### 1. Dialogue & Text Windows
* **Structure:** Full-width rectangular container spanning the bottom of the top screen or top of the bottom screen.
* **Styling:** White background (`#F8F8F8`) with heavy double border frame (`#182028` outside, `#788898` inside). Includes small directional prompt indicator icon at bottom-right corner.

### 2. Action Touch Buttons (Bottom Screen)
* **Structure:** Oversized touch-friendly buttons optimized for stylus and thumb interaction.
* **Styling:** Bright red (`#E04038`) or neutral slate fill with thick black/dark-blue outline. Angular 45° cut corners on top left or right edges. Bold white capitalized text with 1px black outline.

### 3. List Item Strips (Pokédex / Bag Menu)
* **Structure:** Horizontal stacked rows with rounded left/right edges.
* **States:**
  * **Default:** Off-white/light grey row (`#F0F0F0`) with subtle inner shadow.
  * **Selected:** Pale yellow fill (`#FFFFD8`), slightly expanded or offset 4px to the right, marked with a red directional cursor triangle on the margin.

### 4. Pokémon / Item Storage Grid
* **Structure:** 6x5 icon matrix framed inside an ambient themed frame (e.g., Forest background, Plain background).
* **Selection Cursor:** Animated white glove pointer or glowing red/yellow outline box indicating focused grid slot.

---

## Do's and Don'ts

### Do's
* **Do:** Keep text sharp, pixel-aligned, and strictly uppercase for item names, moves, and titles.
* **Do:** Use dark, high-contrast border frames around all floating UI panels.
* **Do:** Structure layouts into clear two-tier hierarchies (Top Screen = Read-only Data / Battle View, Bottom Screen = Interactive Controls / Menus).
* **Do:** Use distinct, saturated visual indicators (Red/Blue gender symbols, green status bars).

### Don'ts
* **Don't:** Apply modern CSS blur effects, soft radial drop shadows, or smooth gradient blurs.
* **Don't:** Use anti-aliased smooth vector fonts when pixel bitmap typography is available.
* **Don't:** Mix rounded modern UI buttons with retro pixel grid containers.
* **Don't:** Overflow menu boundaries; scrollable content must always feature visual scroll-track indicators with red chevron indicators.

---

## Responsive & Dual-Screen Behavior

* **Stacked Layout (Default):** Maintain top-and-bottom screen arrangement on vertical screens.
* **Side-by-Side Reflow (Widescreen Displays):** On horizontal displays wider than 1024px, the interface can reflow into a side-by-side layout: Main View (Top Screen equivalent) on the Left, Menu/Touch Controls (Bottom Screen equivalent) on the Right.
* **Fixed Aspect Ratio Scaling:** Scaled UI elements must preserve pixel-perfect scaling integer increments (1x, 2x, 3x) to prevent pixel distortion.