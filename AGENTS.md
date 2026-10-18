<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep shared navigation in AdminLayout: use a drawer below the desktop breakpoint so all routes remain reachable on small screens.
- Keep wide data tables inside local scroll regions and use minmax(0,1fr) for flexible detail grids to prevent page overflow.

- Auth is a DEMO mock behind the `AuthService` interface in `src/lib/auth.ts`; swap `authService` for a real provider without touching the login page, gate, or logout. Why: no backend yet.
- Admin pages are gated inside `AdminLayout` (session lives in the browser, so SSR renders blank) plus a client-side root `beforeLoad`; new admin pages must render through `AdminLayout`.
- Mock data mutations (`addAdmin`, `addUser`, `updateUser`) live in `src/lib/store.ts` with zod schemas in `src/lib/validation.ts`; pages call these, never mutate state directly. Why: easy swap to a database.
