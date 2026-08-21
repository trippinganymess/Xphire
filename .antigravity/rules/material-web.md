# Material Design 3 (M3) System Rules

Use these constraints whenever generating UI components or prompting Stitch via MCP.

## 1. Visual & Token Standards
- **Color Tokens**: Never hardcode hex values for UI surfaces or text. Use standard M3 custom properties:
  - Background/Surface: `var(--md-sys-color-surface)`, `var(--md-sys-color-surface-container)`
  - Primary Elements: `var(--md-sys-color-primary)`, `var(--md-sys-color-on-primary)`
  - Outline/Borders: `var(--md-sys-color-outline-variant)`
- **Corner Radius**: 
  - Buttons & Inputs: `8px` or `20px` (Pill shape)
  - Cards & Containers: `12px` or `16px`
  - Dialogs/Modals: `28px`
- **Typography**: Follow the M3 type scale using Roboto or system sans-serif fonts (`headline-large`, `body-medium`, `label-large`).

## 2. Component Guidelines
- **Buttons**:
  - Primary Actions: Filled Button (`<md-filled-button>` or equivalent M3 button class)
  - Secondary Actions: Outlined Button
  - Tertiary Actions: Text Button
- **Cards**: Use Outlined Cards for content grouping and Elevated Cards for sticky/floating panels.
- **Inputs**: Use Outlined Text Fields with explicit floating labels.

## 3. Stitch MCP Integration Rules
- When requesting screen layouts from Stitch, explicitly ask for **"Material Design 3 Expressive, web-first layout"**.
- Ensure Stitch generates responsive container layouts using standard CSS Flexbox/Grid with `gap: 16px` padding bounds.