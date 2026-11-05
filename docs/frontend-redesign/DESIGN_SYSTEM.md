# Code Forge Aurora — frontend design system

Reviewed: 2026-11-06

The design keeps the developer workspace dense and readable while giving the public home page a recognizable interactive demonstration. The internal workspace uses restrained surfaces; glow and gradients are limited to branding and selected emphasis.

## Color tokens

| Role | Token | Value |
| --- | --- | --- |
| Brand / current navigation | `--brand-indigo`, `--brand-600` | `#4f46e5` |
| Violet branch / merged state | `--accent-violet`, `--git-merged` | `#7c3aed` |
| Cyan secondary accent | `--accent-cyan` | `#0891b2` |
| Added / success | `--git-added`, `--success` | `#1a7f37` |
| Deleted / destructive | `--git-deleted`, `--danger` | `#cf222e` |
| Modified / warning | `--git-modified`, `--warning` | `#9a6700` |
| Conflict | `--git-conflict` | `#c2410c` |
| Canvas | `--canvas` | `#fafbfc` |
| Surface | `--surface` | `#ffffff` |
| Primary text | `--text` | `#1f2328` |
| Secondary text | `--muted` | `#59636e` |
| Border | `--border` | `#d0d7de` |

Status is conveyed with text and structure as well as color. Indigo denotes navigation and active controls; green denotes success/additions, not every primary action.

## Type, spacing, surfaces, and motion

- UI uses a platform system font with Vietnamese glyph support. Code, SHA, commands, and diffs use a system monospace stack.
- Body text is 15 px by default, with compact product controls around 13–14 px. Hero display is responsive and limited to the public landing page.
- Spacing follows 4/8 px increments. Controls use 8 px corners; larger content panels use 12–16 px corners.
- Canvas, white surface, muted surface, border, and light shadow establish elevation. Frosted glass is limited to the sticky global header.
- Motion tokens: `--motion-fast: 140ms`, `--motion-standard: 220ms`, `--motion-ease: cubic-bezier(0.2, 0, 0, 1)`. Reduced-motion media queries disable nonessential animation and smooth scrolling.

## Component patterns

- Global header: light translucent bar, compact brand mark, route-aware primary navigation, and keyboard-accessible account menu.
- Repository workspace: shared `RepositoryNavigation` exposes code, pull requests, and settings according to existing server permissions.
- Forms and dialogs: explicit labels, helper/error text, pending states, visible focus, and existing mutation behavior.
- Code browser: actual backend tree/blob data, file-type accent icons, line numbers, metadata, bounded scrolling, copy for displayed text, and download only for complete text.
- Homepage Git Engine Lab: keyboard-accessible tabs and local interactive examples; each panel is labeled as illustrative and has no repository side effects.
- PR diff: actual API diff content stays escaped and scrollable; additions, deletions, and metadata are visually distinct.
- Empty, loading, error, unauthorized, reset-storage, and successful states remain separate.

## Accessibility and responsive rules

- Semantic page headings/navigation, native form controls, ARIA only where needed, focus-visible outlines, and keyboard operability for menus, tabs, dialogs, and demo nodes.
- Check layouts at 320, 375, 768, 1024, and 1440 px. Do not allow page-level horizontal overflow; code and diff panels may scroll independently.
- Reduced motion is a supported preference. Never rely on color alone for Git or permission state.
