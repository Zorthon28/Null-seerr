# User Management, Household Profiles & Authentication Roadmap

> **Document Status**: Draft / Architecture Roadmap  
> **Last Updated**: October 2026  
> **Target Scope**: Multi-User Household Isolation, Authentication Security, Jellyfin Synchronization & Recommendation Engine Overhaul

---

## 1. Executive Summary

During our system audit, we identified foundational design gaps in how **user authentication**, **household profile switching**, **Jellyfin user binding**, and **personalized recommendations** are handled across the application. 

Currently, several components rely on hardcoded user IDs (`id: 2`), hardcoded names ("Gus" / "Kenia (Esposa)"), and hardcoded media seeds. Furthermore, the active profile switcher cookie allows unauthenticated admin impersonation, and the primary administrator (`id: 1`) experiences a blackout on Jellyfin watch status and the *Continue Watching* slider on fresh installations.

This document details all identified issues, explains how user creation works today vs. how it should work, and outlines the planned refactoring roadmap.

---

## 2. Identified Issues & Logic Gaps

### 2.1 Critical Authentication & Security Gaps
* **Unauthenticated Admin Impersonation via Header / Cookie**:
  * **Locations**: [`server/middleware/auth.ts`](file:///server/middleware/auth.ts#L28-L45) & [`server/routes/auth.ts`](file:///server/routes/auth.ts#L1051-L1075)
  * **Issue**: In `checkUser`, `req.cookies?.nullseerr_active_profile` and `req.header('x-active-profile')` are inspected **before** verifying if a valid authenticated session exists. Any unauthenticated caller can pass `Cookie: nullseerr_active_profile=1` or `x-active-profile: 1` on any request and immediately gain full administrator control with zero password challenge.
  * **Issue**: `POST /api/v1/auth/switch-profile` has no `isAuthenticated()` middleware, allowing arbitrary callers to switch session `userId` to `1`.
  * **Target Architecture**:
    * Profile switching must strictly require an existing authenticated session.
    * Elevating to an Administrator profile (`profileUser.hasPermission(Permission.ADMIN)`) must require either an active admin master session or a profile PIN/password verification.
    * Profile cookies should be cryptographically signed or stored server-side within the user's session.

* **Hardcoded Personal Cloudflare SSO Binding**:
  * **Location**: [`server/middleware/auth.ts`](file:///server/middleware/auth.ts#L75-L85)
  * **Issue**: The Cloudflare Zero Trust auto-auth routine explicitly checks:
    ```typescript
    if (targetPrimary && (ssoEmail === 'dev.gustavo.tello@gmail.com' || ssoEmail.includes('gustavo')))
    ```
  * **Target Architecture**: Replace personal email checks with generic administrator matching: check against `adminUser.email.toLowerCase() === ssoEmail` or configured domain/admin email settings.

---

### 2.2 Jellyfin Integration & Primary Admin Mapping Gaps
* **Administrator Watch Status & "Continue Watching" Blackout on Fresh Installs**:
  * **Locations**:
    * [`server/routes/discover.ts`](file:///server/routes/discover.ts#L2132) (`GET /api/v1/discover/resume`)
    * [`server/routes/media.ts`](file:///server/routes/media.ts#L1170) & line 1213 (`watch-status`)
    * [`server/routes/discover.ts`](file:///server/routes/discover.ts#L1207) (`handleRecentRecommendations`)
  * **Issue**: The Jellyfin user is retrieved using:
    ```typescript
    const isGus = Boolean(req.user && req.user.id === 2);
    const targetJellyfinUserId = req.user?.jellyfinUserId || (isGus ? settings.jellyfin.userId : undefined);
    ```
    On a fresh installation, setup scripts create the administrator as User 1 (`id: 1`). User 1 has `isGus = false`, so `targetJellyfinUserId` is `undefined`.
  * **Consequences**:
    1. The **"Continue Watching" / Resume slider** returns `{ results: [] }` and stays invisible for the admin.
    2. The admin cannot view playback progress or toggle played/unplayed status in Jellyfin from Null-seerr.
    3. Jellyfin library played items are never queried to power admin recommendations.
  * **Target Architecture**:
    * Ensure `targetJellyfinUserId` falls back to `settings.jellyfin.userId` whenever the active user has `Permission.ADMIN` or `id === 1`.
    * During installer initialization (`wire_stack.py`), write `settings.jellyfin.userId` directly into User 1's `jellyfinUserId` column in SQLite.

* **AvailabilitySync Missing Jellyfin User Fallback**:
  * **Location**: [`server/lib/availabilitySync.ts`](file:///server/lib/availabilitySync.ts#L99)
  * **Issue**: Calls `this.jellyfinClient.setUserId(admin.jellyfinUserId ?? '')`. If `admin.jellyfinUserId` is null in the database, it sets an empty string instead of falling back to `settings.jellyfin.userId`, breaking subsequent Jellyfin library queries.

---

### 2.3 Personalized Recommendation Engine Gaps
* **Hardcoded Anime Seeds & Forced Library Watched Injection**:
  * **Location**: [`server/routes/discover.ts`](file:///server/routes/discover.ts#L1179-L1199,L1260-L1271)
  * **Issue**: For User ID 2, the code forcibly dumps *all available media in the database* into `watchedMovieIds`, and hardcodes Japanese anime IDs (`296286` and `65930`). For any other user, recommendations work differently or get suppressed.
  * **Target Architecture**:
    * Remove hardcoded media IDs.
    * Base recommendations purely on genuine user activity: items in `Watched` table, items marked played in Jellyfin for that user's profile, and items in `Liked` table.

* **Gemini Recommendations Stale Cache Key**:
  * **Location**: [`server/routes/discover.ts`](file:///server/routes/discover.ts#L1414-L1417)
  * **Issue**: The cache key is constructed as:
    ```typescript
    const cacheKey = `gemini-user-${effectiveUser?.id || 'anon'}-${likedTitles.map((t) => t.title).join(',')}`;
    ```
    If the user has not liked any titles yet, `likedTitles` is empty, so the key is `gemini-user-<id>-`. If the user watches 10 new movies over the next week, the cache key never changes, serving stale recommendations until the 6-hour TTL expires.
  * **Target Architecture**: Incorporate both `likedTitles` and `watchedTitles` (e.g. combined title hash or timestamps) into the cache key so changes in watched media immediately invalidate stale recommendations.

---

### 2.4 Frontend Multi-User Profile & SWR Cache Bleed
* **Hardcoded Household Profile Names in UI**:
  * **Locations**: [`src/components/ProfileSwitcher/index.tsx`](file:///src/components/ProfileSwitcher/index.tsx#L282-L298) and [`src/components/Layout/UserDropdown/index.tsx`](file:///src/components/Layout/UserDropdown/index.tsx#L224-L226)
  * **Issue**: The UI evaluates `isGusProfile ? 'Gus (Admin)' : 'Kenia (Esposa)'`. If a different household sets up profiles or adds kids, guests, or roommates, non-admin profiles are permanently labeled as "Esposa".
  * **Target Architecture**: Dynamically display the profile's real displayName and permission role (`profile.isAdmin ? 'Admin' : 'Miembro'`).

* **Missing SWR Key Scoping for Liked Items & Watch Status**:
  * **Locations**:
    * [`src/hooks/useLiked.ts`](file:///src/hooks/useLiked.ts#L20) (`/api/v1/liked/ids`)
    * [`src/hooks/useWatchStatus.ts`](file:///src/hooks/useWatchStatus.ts#L34) (`/api/v1/media/${mediaType}/${tmdbId}/watch-status?is4k=${is4k}`)
  * **Issue**: While `useWatched.ts` properly appends `?userId=${user.id}` to isolate its SWR cache, `useLiked.ts` and `useWatchStatus.ts` omit `userId`. When switching profiles without a hard page reload, SWR serves the previous user's liked titles and playback progress.
  * **Target Architecture**: Scope all user-specific SWR keys with `?userId=${user.id}`.

---

## 3. How User Management Works Today vs. How It Should Work

### 3.1 Current User Management Flow
In the current codebase:
1. **Initial Admin User**: Created during setup (`wire_stack.py` inserts User 1 with email/username/password into `db.sqlite3`).
2. **Adding Additional Users**:
   - Currently, there is **no direct "+ Add Profile" button** in the fast Profile Switcher modal.
   - Additional users can only be created via:
     - **Settings > Users > Create Local User** (available only if local sign-in is enabled in settings and caller has `MANAGE_USERS` permission).
     - **Import from Jellyfin**: Settings > Users > Import Jellyfin Users (reads users from Jellyfin REST API and imports them into Overseerr/Null-seerr).
     - **SSO Auto-Provisioning**: Visiting through Cloudflare Access with a new email auto-provisions a user with default permissions.
3. **Switching Profiles**:
   - `GET /api/v1/auth/profiles` lists all users.
   - `POST /api/v1/auth/switch-profile` switches the active session `userId`.
   - The Profile Switcher modal only offers switching between pre-existing users; it does not offer inline user creation.

### 3.2 Proposed Refactored User & Household Profile System
When we undertake the user refactor:
1. **Household Profile Management Modal**:
   - Add a "+ Añadir Perfil" (Add Profile) action directly inside the `ProfileSwitcher` modal for administrators.
   - A simple form prompting for:
     * **Nombre del Perfil** (e.g., "Sala", "Niños", "Mamá", "Invitado")
     * **Avatar** (predefined avatar selection or image upload)
     * **Tipo de Perfil**: Adulto (Acceso completo) vs Infantil (Filtro por rating PG/G y bloqueo de contenido explícito)
     * **PIN Opcional** (PIN de 4 dígitos para proteger perfiles de adultos/admin contra cambios accidentales por niños en TV)
2. **Automatic Jellyfin User Provisioning**:
   - When a new household profile is created in Null-seerr, optionally create a linked user in Jellyfin via REST API (`POST /Users/New`) so watched history and playback progress are automatically synchronized in both directions.
3. **Session & Security Binding**:
   - A single household master session (authenticated once on a TV or living room PC).
   - Fast switching between household profiles modifies the active profile within the authenticated household session without exposing unauthenticated remote endpoints.
   - Switching to the Admin profile prompts for the 4-digit PIN or master password.

---

## 4. Implementation Phasing Roadmap

| Phase | Milestone | Scope |
|---|---|---|
| **Phase 1 (Security & Linking)** | Secure Auth Middleware & Jellyfin Binding | - Secure `checkUser` and `/switch-profile` against unauthenticated spoofing.<br>- Link User 1 to `settings.jellyfin.userId` across `discover.ts`, `media.ts`, and `availabilitySync.ts`.<br>- Remove hardcoded personal SSO emails (`dev.gustavo.tello@gmail.com`). |
| **Phase 2 (Clean Recommendations)** | Recommendation Engine Sanitization | - Remove hardcoded anime IDs (`296286`, `65930`) and arbitrary library injection.<br>- Incorporate `watchedTitles` into Gemini AI cache keys.<br>- Scope `useLiked.ts` and `useWatchStatus.ts` SWR keys by `userId`. |
| **Phase 3 (UI Decoupling)** | Generic Household UI | - Replace hardcoded "Gus" and "Kenia (Esposa)" labels with dynamic profile names and role badges.<br>- Generic avatar palette and styling. |
| **Phase 4 (Profile Onboarding)** | Inline Household Profile Creation | - Add "+ Añadir Perfil" modal in frontend.<br>- Backend endpoint `POST /api/v1/user/profile` for creating household profiles with custom avatar and parental controls.<br>- Automatic Jellyfin profile sync. |
