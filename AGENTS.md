# Project: booking-system

## Communication
- Keep responses concise and direct.
- Use short feedback and suggestions.
- When reporting progress, use:
  - Done
  - Issues
  - Suggestions
- Do not give long explanations unless asked.
- Briefly warn me about anything insecure, risky, or likely to cause bugs.

## Development
- This is a real internal church booking system, not a mockup.
- Use Next.js App Router, TypeScript, Tailwind, Neon (Postgres, Auth, Object Storage), GHL, and Google Calendar.
- Prefer simple, maintainable solutions.
- Do not overengineer.
- Reuse components instead of duplicating code.
- Keep server logic separate from client UI.
- Never expose secrets or private API credentials. Never print, log, or commit values from `.env.local`.
- Validate important inputs server-side.
- Enforce permissions server-side and with Postgres RLS: app queries run as the restricted `app_member` role (`asMember`), never as the owner.
- Normal users must never gain admin access through frontend manipulation. Roles and account access change only through admin-checked database functions.
- New accounts start as `pending`; only `active` accounts can use the portal.
- GHL is the source of truth for room calendar availability. Approvals create a confirmed GHL appointment (assigned to the calendar's team member) before the booking is marked approved.
- Neon handles auth, roles, account access, bookings, announcements, and application data. Images live in the private Neon Object Storage bucket.
- Google Calendar sync runs after approval and must never undo it.

## Victory Branding
- Use the official Victory Church / Victory Philippines website as the primary branding reference.
- Match its visual identity, typography direction, colors, spacing, imagery, logo usage, and overall tone.
- Use the official Victory logo when available. Never create a fake or AI-generated replacement.
- The app should feel like it was designed specifically for Victory, not like a generic dashboard template.

## Design Research
- NEVER design important components blindly.
- Before designing a major component, research real high-quality UI references.
- Every important component should have a real design inspiration or established UI pattern behind it.
- You may research Dribbble, Awwwards, Behance, Mobbin, official product websites, or other high-quality references.
- If useful design/frontend skills are available, use them.
- If an appropriate skill can improve UI quality, frontend implementation, accessibility, animation, or design consistency, use it before designing.
- Do not copy a reference pixel-for-pixel. Adapt it to Victory's branding and this product's actual needs.
- Keep the whole app visually consistent even when using multiple references.

## No AI Slop
Actively inspect the UI for signs of AI-generated design.

Avoid:
- excessive gradients
- glassmorphism everywhere
- glowing elements
- excessive rounded cards
- random icon boxes
- repetitive SaaS card grids
- fake analytics
- fake statistics
- unnecessary badges
- unnecessary pills
- giant hero sections
- generic marketing copy
- decorative blobs
- excessive shadows
- excessive animation
- random colors
- inconsistent spacing
- components that exist only to fill empty space

Prefer:
- strong typography
- intentional whitespace
- editorial layouts
- high-quality photography
- poster-driven layouts
- clean hierarchy
- subtle borders
- restrained radius
- purposeful interaction
- subtle animation
- polished responsive behavior

The member dashboard should feel like a modern digital church bulletin board, not a SaaS analytics dashboard.

## Components
- Research inspiration before building:
  - navigation
  - bulletin/dashboard
  - room cards
  - room detail page
  - calendar
  - schedule view
  - booking form
  - booking status
  - admin request review
  - announcement manager
  - users table
  - dialogs/modals
  - empty states
- Components should not all use the same card layout.
- Use the right interaction pattern for the actual task.
- Desktop and mobile behavior must both be intentional.
- Hover interactions must have a mobile/touch alternative.
- Respect accessibility and reduced-motion preferences.

## Quality
- Do not claim something works unless you verified it.
- Run lint, type-check, and production build after major implementation.
- Fix errors before moving on.
- Check for runtime and console errors.
- Handle loading, empty, error, unauthorized, and not-found states properly.
- Do not silently fall back to mock data in production.
- Avoid TODOs in critical functionality.

## Workflow
- Inspect existing files before editing.
- Research before designing.
- Build the simplest correct implementation first.
- Test what you build.
- Fix problems before adding unnecessary features.
- If you see a better design or technical approach, suggest it briefly before or while implementing it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
