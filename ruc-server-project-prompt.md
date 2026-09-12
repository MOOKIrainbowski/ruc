# Ruc Server — Full Project Specification (Prompt for Claude Code)

## 0. Instructions for Claude Code (read this first)

You are helping build **"Ruc Server"**, a multi-mode Minecraft server network with a companion Discord community and a marketing/status website. The full requirements are specified below, translated and reorganized from the project owner's original notes.

Before doing anything else:

1. **Inspect the current working directory** (and any subfolders) to see what already exists — server configs, plugin folders, a website repo, Discord bot code, assets, etc. Do not assume an empty project; adapt the plan to what is already there.
2. Cross-reference what you find against the specification below. Some sections are complete; others are intentionally left open (marked `[DEFINE: ...]`) because the owner wants you to design a reasonable, concrete solution for them — treat those as design tasks, not gaps to leave blank.
3. Produce a **concrete, step-by-step development plan** (phases/milestones, in priority order — see §2.1 for stated priorities) before writing code. Break it into actionable stages such as: environment/hosting setup → core server configs and world rules → plugin/system implementation per server type → Discord bot work → website → monetization/economy wiring → polish and launch.
4. Flag any open questions or decisions that materially affect architecture (e.g., hosting provider choice, Minecraft version, plugin stack) rather than silently guessing on high-impact items — but for the items explicitly marked `[DEFINE: ...]` below, go ahead and propose a specific design rather than asking, since the owner has delegated that decision to you.
5. Work iteratively and check in after each phase rather than attempting the entire project in one pass.

---

## 1. Project Overview

"Ruc Server" is a Minecraft server network consisting of four distinct server modes sharing one economy/currency and one Discord community, plus a promotional website. The project also includes a monetization layer (subscriptions/donations) and plans for continuous iteration (new pages/features added over time).

---

## 2. Minecraft Server Architecture

### 2.1 Server List & Development Priority

1. **Home Server** — priority 0 (highest)
2. **Raid Server** — priority 1
3. **Nation/War Server** — priority 2
4. **Semi-Survival / Peace Server** — priority 3

### 2.2 Global Rules (apply to all servers)

- A player's location must **not** be shown on/near their experience bar (i.e., suppress any location display normally tied to the XP bar) on every server.

### 2.3 Home Server

- This is the central hub server every player lands on first when joining the network.
- **PvP is disabled** and **block breaking/placing is disabled** here — it is a safe social/lobby space.
- Map: a plaza/town-square-style layout. Find a freely-usable map file online (one that is safe/permissible to use) and apply it as the world.
- `[DEFINE]`: Think through and propose any other components a good hub/home server needs (e.g., NPCs or menus for server navigation, cosmetic areas, an info board, teleport hubs to other servers, a shop, etc.) and add them to the plan.

### 2.4 Raid Server

- If a player disconnects while in a fight, reconnecting results in **guaranteed death**, with **all item drops and XP removed** (i.e., combat logging is punished by a forced death + full loot/XP wipe).

### 2.5 Semi-Survival / Peace Server

- Players **cannot directly kill other players**, including via explosives (crystals, TNT minecarts, or other "intentional game design" exploits used to kill players indirectly).
- If terrorism/griefing-style behavior is detected, Helpers and other staff may issue discretionary punishment.

### 2.6 Nation/War Server

- Players form guilds; once a guild's member count passes a defined threshold, it becomes recognized as a **"Nation."**
- Players who do not belong to a Nation (guild) **cannot enter** this server.
- During a designated time window (the server's peak-population hours), Nations can capture land from each other.
- To claim land, a Nation must place a **Core** at a valid core-placement location and defend it until the war window ends; if successfully defended, the surrounding territory becomes that guild's property.
- Outside the war window, guild members may freely gather resources / upgrade gear within their own Nation's territory.
- During war time, **any weapon** is allowed.

---

## 3. In-Server Systems

### 3.1 Currency & Special Items

- **Ruc**: the server-wide currency, usable/shared across all four servers.
- **Core**: a required item for claiming territory on the War server. Its crafting requires sub-components that are still undefined — `[DEFINE: design the crafting chain/sub-items needed to build a Core]`.
- **Dragon Egg**: a unique buff-granting item. A player holding it in their inventory gains a set of buffs (specifics undefined — `[DEFINE: design the buff set]`). Exactly one Dragon Egg exists on the Raid server and one on the Peace server; the buff applies network-wide regardless of which server the holder is currently on.

### 3.2 Staff Roles (Minecraft + Discord — shared role concept)

Roles marked `#` below are **unconfirmed/optional** — add them later only if the player base grows enough to need them.

- **Owner** — server owner / (likely) lead developer
- **Admin** — same tier as Owner; reserved for a trusted co-manager
- **Manager** — top-level administrator of both the Discord server and the Minecraft server
- `# Moderator` — undefined scope
- `# Guide` — undefined scope
- **Helper** — real-time server monitoring; emergency response to hacking/cheating and other in-game issues
- `# Builder` — Minecraft server & Discord development assistant
- `# Designer` — Minecraft server UI and texture/resource-pack designer

### 3.3 Commands

- **All servers**: `/tpa`, `/tpahere`, `/tpdeny`, `/tpcancel`
- **Raid & Semi-Survival servers**: `/spawn`, `/sethome`, `/home` (Korean aliases: `/스폰`, `/셋홈`, `/홈`)
- **Nation/War server**: `/storage` (`/국가창고`, guild storage), `/tp [core name]`

### 3.4 XP System

- XP sources: killing other players, killing epic/boss-tier monsters, completing advancements, and a very small amount from killing ordinary hostile mobs.
- This XP system is **completely independent of vanilla Minecraft XP** — it is not consumed by enchanting, and vanilla XP bottles do not add to it.
- Leveling curve: the XP required per level increases sharply as level rises.

### 3.5 Guild System

- Guild ranks: **Guild Master**, **Vice Master**, **Member**.
- Founding a guild requires the founder to be above a defined minimum XP level and to pay a Ruc fee.
- Benefits: small weekly rewards for all members, plus tiered seasonal rewards based on the guild's leaderboard ranking.

### 3.6 In-Game Scoreboard (server sidebar), positioned on the right side of the screen

1. Row 1: progress bar toward the next XP level
2. Row 2: K/D/A (Kills / Deaths / Assists)
3. Row 3: server ping, shown as a tier label (e.g., Excellent / Good / Fair / Weak / Needs Improvement)
4. Row 4: current online players / max server capacity
5. Additional rows: `[DEFINE: propose other real-time personal stats worth surfacing here]`

### 3.7 Reputation System

- Tiers (mirrored as Discord roles), from best to worst: **Green → Yellow → Red → Purple → Blue → Indigo → Dark**. This gives players a quick, trustworthy signal about a stranger's track record.
- Reputation decreases from: being reported by other players, or being formally punished by staff.
- `[DEFINE: propose two concrete ways players can raise their reputation through positive contributions to the server]`

### 3.8 Report System

- In-game: `/report [player name]` (Korean alias `/신고`) opens a path into the Discord ticket-bot flow (running the command in Minecraft should surface/point to the Discord report channel).
- In Discord: running `/report` opens a ticket channel with an intake form requesting: the Minecraft/Discord username of the offending player, the reason for the report, and the exact incident time (`hh:mm:ss`).

### 3.9 Punishment Tiers

1. **Tier 1**: Discord mute + Minecraft ban, 6 hours
2. **Tier 2**: Discord mute + ban 12 hours, Minecraft ban 1 day
3. **Tier 3**: Discord mute + server ban 3 days, plus confiscation of 10% of in-game currency (Ruc, etc.)
4. `[DEFINE: design escalating Tiers 4 through 10]`, increasing in severity (e.g., longer bans, higher currency confiscation percentages, permanent bans, IP bans, etc. — use your judgment for a sensible progression)

---

## 4. Discord Server

- Invite link: https://discord.gg/sTVAJ38ea
- Staff roles: same as §3.2 above (shared role concept across platforms).

### 4.1 Bots

**General-purpose server bot** (already owned; hosted by a third party — only needs light code cleanup)
- Remove: features not needed for server administration (e.g., economy/leveling minigame features unrelated to moderation).
- Add: `[DEFINE: propose useful moderation/utility features to add]`

**Server chat-relay bot**
- Mirrors in-game chat from each Minecraft server (Raid, War, Peace) into a matching Discord channel per server.
- System notifications not tied to player-to-player chat (advancement unlocks, player join/leave, etc.) should be posted as **embeds**, distinct from chat messages.
- When relaying a player's chat message, the bot should render it using a webhook whose name/avatar are synced to that player's Minecraft skin head, so the message visually appears to come from the player rather than from a bot.

**Ticket bot**
- Operates the same way as the general server bot (same command framework/conventions).

---

## 5. Monetization

### 5.1 Revenue Model

- **Microtransactions**: purchasing Ruc (or another currency) top-ups and/or cosmetic items.
- **Subscriptions**: tiered pricing offering different perks per tier.

### 5.2 Server Boost Role Tiers (Discord Nitro boosts)

- Hyper
- Rocket
- Booster

### 5.3 Donation/Support Role Tiers

- Base tier (free): **Ruc**
- Paid tiers, lowest to highest: **VIP → SVIP → MVP → Prime → Premium → Elite**

**Perks per tier** — all currently undefined:
- Elite (top tier): `[DEFINE]`
- Premium: `[DEFINE]`
- Prime: `[DEFINE]`
- MVP: `[DEFINE]`
- SVIP: `[DEFINE]`
- VIP (entry paid tier): `[DEFINE]`

Propose a clear, escalating perk ladder across these six tiers (cosmetics, small gameplay conveniences, priority queue, exclusive areas, etc. — avoid pay-to-win advantages in PvP-relevant systems).

---

## 6. Server Infrastructure

### 6.1 Hosting

- Find the best-quality **free** Minecraft server hosting provider available and set it up as the host.

### 6.2 Minecraft Version

- Use the newest version that supports full optimization, or fall back to the newest version that has no compatibility/plugin conflicts with the required setup.

### 6.3 Language Support

- Korean (default)
- English

---

## 7. Website

### 7.1 Brand Colors

- Light green palette, e.g. `#bad953`, `#93e93e`.

### 7.2 Landing Page Structure

1. Hero section: the Ruc Server icon (transparent-background version) plus a headline tagline representing the server.
2. A "problem → solution" narrative: state the pain points other servers have, positioned against Ruc Server's actual strengths, followed by the solution Ruc Server offers.
3. Immediately below the solution copy, call out which specific server feature(s)/system(s) solve that problem.
4. `[DEFINE: propose any additional landing-page sections that would help market the server]` — a prominent CTA button that sends visitors to the Discord server is **mandatory** somewhere on the page.

### 7.3 Homepage Layout

- **Top navigation bar**, semi-transparent ("frosted plastic" look):
  - Left: Ruc Server icon (transparent-background version), with the text "Ruc Server" to its right.
  - Right side, left-to-right: a toggle-style KO/EN language switch, then a **"Go to Server"** button that links to the Discord invite.
- Purpose of the homepage: give visitors real-time server status and key information **without needing to visit Discord** for it. Design the UI/UX and information architecture around delivering that at-a-glance, low-friction experience (e.g., live player counts, server status per mode, announcements, quick links) — treat this as the primary design brief for the homepage.

### 7.4 Supported Languages

- Korean (default)
- English

### 7.5 Design Style Reference

- Visual inspiration: https://blik.kr
- Overall site typography: a **pixel font** that evokes Minecraft's aesthetic.
- Preferred design language: **glassmorphism**, with strong typographic emphasis.

> Note: this project-specific design direction (pixel font, glassmorphism, green palette, blik.kr reference) is what the owner wants for this site — apply it instead of any other default site-design convention.

### 7.6 Background Image

- A background photo should be chosen from the owner's local folder at `C:\Users\hanse\OneDrive\Desktop\러크서버\web_background`, picking whichever image best fits the site's visual design, then applying a blur effect and using it as the page background. (This is a local path on the owner's machine — retrieve/select the image when working in an environment that has access to that folder; if unavailable, flag this as a manual step for the owner.)

### 7.7 Hosting & Deployment

- Connect a GitHub repo to Vercel so the site deploys remotely via `git push`.

### 7.8 Future Pages

- The site will keep growing as the server is updated. Every time a new page is added (including the homepage and landing page), publish it under the `~~~.vercel.app` domain following a consistent URL path convention, so the structure stays predictable as pages are added over time.

---

## 8. Deliverable

Using everything above: analyze the existing project files first, then produce a phased, step-by-step development plan (with the priorities from §2.1 driving sequencing), resolve each `[DEFINE: ...]` item with a concrete proposal, and begin implementation phase by phase, checking in at each milestone.
