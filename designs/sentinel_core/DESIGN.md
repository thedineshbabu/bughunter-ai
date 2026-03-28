# Design System Specification: High-End Enterprise Editorial

## 1. Overview & Creative North Star
**Creative North Star: "The Precision Architect"**

This design system moves away from the "SaaS-in-a-box" aesthetic. Instead of a rigid grid of outlined boxes, it adopts an **Editorial Precision** layout. The goal is to convey high-stakes intelligence through sophisticated white space, asymmetric balance, and tonal depth. We treat the interface not as a software dashboard, but as a high-end technical publication.

To break the "template" look, we utilize **Intentional Asymmetry**. Larger display type is paired with generous margins to lead the eye, while data-heavy sections are nested within subtle tonal layers rather than being trapped behind heavy borders. This creates a "breathing" interface that feels calm under pressure—essential for a high-efficiency tool.

---

## 2. Colors & Surface Philosophy

### Color Palette Reference
*   **Primary:** `#031635` (Commanding Navy)
*   **Primary Container:** `#1A2B4B` (Deep Professionalism)
*   **Secondary:** `#0058be` (Action Blue)
*   **Surface (Base):** `#F7F9FB` (Cool Professionalism)
*   **Surface Container Lowest:** `#FFFFFF` (Pure Clarity)
*   **Surface Container High:** `#E6E8EA` (Subtle Depth)

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Traditional borders create visual noise that distracts from the data. 
*   **The Alternative:** Boundaries must be defined solely through background shifts. A `surface-container-low` component should sit on a `surface` background. The change in hex value is the border.
*   **Signature Textures:** For primary CTAs or Hero sections, use a linear gradient: `primary` to `primary_container` (135° angle). This adds "soul" and a sense of metallic depth that flat navy cannot achieve.

### Surface Hierarchy & Nesting
Treat the UI as a physical desk of stacked vellum.
1.  **Level 0 (Background):** `surface` (`#F7F9FB`)
2.  **Level 1 (Sections):** `surface-container-low` (`#F2F4F6`)
3.  **Level 2 (Active Cards):** `surface-container-lowest` (`#FFFFFF`)

### The Glass Rule
Floating elements (Modals, Popovers, Flyouts) must use **Glassmorphism**.
*   **Fill:** `surface-container-lowest` at 85% opacity.
*   **Effect:** `backdrop-filter: blur(12px)`.
*   **Rationale:** This allows the structural colors of the dashboard to bleed through, maintaining the user’s context and softening the edges of the UI.

---

## 3. Typography: The Editorial Voice

We use **Inter** exclusively, but we leverage its full variable weight range to create an authoritative hierarchy.

*   **Display (lg/md/sm):** Used for high-level data summaries. Light weight (300) with tight letter-spacing (-0.02em). This creates a sophisticated, "Architectural" feel.
*   **Headline (lg/md):** Medium weight (500). Used for page titles. This is the "Anchor" of the layout.
*   **Body (lg/md):** Regular weight (400). Tight line-height (1.5) for readability.
*   **Label (md/sm):** Semibold (600) and All-Caps for technical metadata. This provides the "Professional" contrast against the softer body text.

**Typography as Brand:** By pairing a `display-lg` light-weight number with a `label-sm` bold descriptor, we create a high-contrast visual rhythm that feels premium and intentional.

---

## 4. Elevation & Depth: Tonal Layering

Traditional drop shadows are forbidden unless specified for floating glass elements.

### The Layering Principle
Depth is achieved by "stacking" the `surface-container` tiers. 
*   To make a card "pop," do not add a shadow. Instead, change the background of the section to `surface-container-low` and make the card `surface-container-lowest`. The natural contrast provides all the "lift" required.

### Ambient Shadows (Floating Only)
When an element must float (e.g., a critical Alert or a Tooltip):
*   **Blur:** 32px to 64px.
*   **Opacity:** 4% - 6%.
*   **Color:** Use a tinted shadow—`on-surface` (`#191C1E`) mixed with 10% `primary`. This mimics natural light reflecting off professional surfaces.

### The "Ghost Border" Fallback
If a border is required for accessibility (e.g., Input Fields):
*   Use `outline-variant` at **20% opacity**. It should be felt, not seen.

---

## 5. Components

### Buttons
*   **Primary:** Gradient fill (`primary` to `primary-container`), white text, `DEFAULT` (8px) roundness. No border.
*   **Secondary:** Transparent fill, `outline-variant` (Ghost Border), `primary` text.
*   **Tertiary:** No fill, no border. `primary` text with an underline on hover.

### Input Fields
*   **Base State:** `surface-container-lowest` fill with a Ghost Border.
*   **Focus State:** Border transitions to `secondary` (2px), with a subtle 4px `secondary-container` (20% opacity) outer glow.

### Cards & Lists
*   **Constraint:** Zero divider lines. 
*   **Separation:** Use `spacing-8` (2rem) of vertical white space or a subtle shift to `surface-container-high` on hover to separate list items.

### Specialized Component: The "Audit Rail"
For a bug-hunting context, use a vertical "Audit Rail"—a thin `surface-tint` line on the far left of a container that changes color (`error` or `secondary`) to indicate status without coloring the entire card.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use white space as a structural element. If a design feels "crowded," increase the padding to `spacing-12` or `16`.
*   **Do** use `tertiary` tokens for "warning" states—these warm, amber-tinted tones provide a professional alternative to harsh oranges.
*   **Do** nest containers to show parent-child relationships rather than using arrows or lines.

### Don't:
*   **Don't** use 100% black text. Always use `on-surface` (`#191C1E`) to maintain the "ink on paper" softness.
*   **Don't** use "Gamey" animations. Transitions should be fast (200ms) and use a `cubic-bezier(0.4, 0, 0.2, 1)` easing for a weighted, professional feel.
*   **Don't** use card shadows on a white background. This looks "dirty." Use a grey background (`surface-container-low`) if you want a white card to stand out.