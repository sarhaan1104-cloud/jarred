# Pressure Canning Verifier — Rules Update (v2)

This supersedes the staging logic in the earlier rules doc. It reflects one
governing principle and two corrections that came out of checking the accumulated
rules against current USDA / National Center for Home Food Preservation guidance.

> **Scope note.** This tool is a *triage aid*. It sorts a recipe into pathways and
> points at the matching tested process. It does **not** certify a recipe as safe.
> Only matching a research-tested recipe and following its exact time, pressure,
> jar size, and altitude does that. Always confirm against the current USDA
> Complete Guide or nchfp.uga.edu before canning.

---

## 1. Governing principle: the jar is a whitelist, not a calculator

The tool must **not generate a processing time for an arbitrary mixture.** There is
no validated process for "whatever ingredients you happen to have." For any recipe,
the jar portion either:

- **matches a tested process** (single tested food, or the USDA "your choice" soup), and the tool reports *that* process's time; or
- **doesn't match**, and the tool routes the components out of the jar and says so — it does not invent a number.

This is implemented in `tested_processes.json` (the whitelist) and `staging_router.js`
(the decision logic).

## 2. The three pathways

| Pathway | What goes here | Why |
|---|---|---|
| **1 — In the jar** | Only things that map to a tested process: plain meat/poultry, a single tested vegetable, stock, properly acidified tomatoes, or a soup that obeys the soup rules | These have validated times |
| **2 — Freeze / vacuum-seal** | Sauces, gravies, wine reductions, anything thickened, mushroom/tomato powders, concentrates, purées | It's a *recipe*, not a canning *process*; freezing sidesteps the safety question |
| **3 — Fresh at serving** | Dairy, bread, cooked pasta/rice, finishing fats, condiments, crisp/Maillard elements | Not safe or not sensible to can; added at the stove |

## 3. How the jar process is decided (router logic)

1. Classify every ingredient (longest-match-wins, so "mushroom powder" beats "mushroom", "mashed potato" beats "potato").
2. Set aside seasonings (no-count) and covering liquids (broth/stock/water — these do **not** count as solid foods).
3. Count the **solid** tested foods going in the jar:
   - **0 solids** → if only broth, use the stock process (20 pt / 25 qt); otherwise NOT_CANNABLE.
   - **1 solid** → use that food's own tested time; broth is just its covering liquid.
   - **2+ solids** → the **soup gate** (see below).
4. Apply altitude: dial gauge 11 psi (0–2000 ft) rising to 15; weighted gauge 10 psi (0–1000 ft) then 15.

### The soup gate (the one flexible in-jar path for combinations)

Time: **60 min pints / 75 min quarts** (100 min if any seafood). Valid **only** if:

- every solid has its own tested recommendation (no cabbage, broccoli, cauliflower, celery, summer squash, cured/brined meats);
- the jar is filled **halfway with solids, then covered with liquid** (the 1:1 ratio is a safety requirement, not a preference);
- the mixture is boiled 5 minutes before packing, meat is pre-cooked, dried beans fully rehydrated;
- **no** thickeners (flour, cornstarch, Clearjel), **no** dairy, **no** pasta/rice.

> **Why beef-in-broth is not "soup."** A dense pack of one solid food covered with
> broth uses that food's own time (beef = 90 min quarts). The soup time (75 quarts)
> is only validated for the half-solids/half-liquid soup structure — applying it to
> a dense beef pack would **under-process** the beef. The router enforces this by
> treating broth as a liquid, not a second food.

## 4. The two corrections to the old logic

**A. Custom sauces packed over meat are out.** The earlier "build a bourguignon
sauce, then pack it over the beef and process" workflow is not a tested process — a
wine / Worcestershire / mushroom-powder braise is a novel low-acid formulation, and
the powder adds density that works against heat penetration. The safe form is a
Pathway 1 + Pathway 2 split: can the browned beef in plain broth or water (tested
meat process), and make the bourguignon sauce as a freeze/vacuum-seal item. Open a
jar, heat the sauce, combine. Same flavor, on a validated process.

**B. The mushroom rule was backwards.** The USDA tested form is **whole or sliced**
domestic mushrooms (half-pints/pints, 45 min, never wild). There is **no** tested
process for **powdered/dehydrated** mushroom stirred into a pack — that's a Pathway 2
flavoring, not an in-jar ingredient. The router now routes "mushroom powder" to
Pathway 2 and only accepts whole/sliced mushrooms in the jar.

## 5. Processing-time reference (base pressure; adjust for altitude)

Dial gauge 11 psi at 0–2000 ft / weighted 10 psi at 0–1000 ft. "pt" = pints/half-pints, "qt" = quarts. "—" = not recommended for that jar size.

| Food | pt | qt |
|---|---|---|
| Red meat — strips/cubes/chunks | 75 | 90 |
| Ground / chopped meat | 75 | 90 |
| Poultry / rabbit, **boneless** | 75 | 90 |
| Poultry / rabbit, **bone-in** | 65 | 75 |
| Meat / poultry stock (broth) | 20 | 25 |
| Fish | 100 | — |
| "Your choice" soup | 60 | 75 |
| Soup **with seafood** | 100 | 100 |
| Asparagus | 30 | 40 |
| Beans, snap/green/wax | 20 | 25 |
| Beans, lima/butter (shelled) | 40 | 50 |
| Beets | 30 | 35 |
| Carrots | 25 | 30 |
| Corn, whole kernel | 55 | 85 |
| Corn, cream style | 85 | — |
| Greens / spinach | 70 | 90 |
| Mixed vegetables (tested combo) | 75 | 90 |
| Mushrooms, whole/sliced (domestic) | 45 | — |
| Okra | 25 | 40 |
| Peas, green/English (shelled) | 40 | 40 |
| Peppers | 35 | — |
| Potatoes, cubed/whole | 35 | 40 |
| Pumpkin / winter squash, **cubed** | 55 | 90 |
| Sweet potatoes (pieces) | 65 | 90 |
| Dried beans/peas (rehydrated), plain | 75 | 90 |
| Tomatoes, crushed (acidified) | 15 | 15 |
| Tomatoes, whole/halved in water (acidified) | 10 | 10 |

Never in the jar in any form: dairy, flour/cornstarch/starch thickeners, pasta/rice,
eggs, large amounts of oil/fat, cured/brined meats, purées/mashed low-acid foods, and
the untested vegetables above. Tomatoes **must** be acidified (bottled lemon juice or
citric acid).

## 6. Known limitation to fix next

The classifier uses substring alias matching with a longest-match tie-break. This
handles the collisions we found (mushroom powder, mustard greens, mashed potato), but
a production version should move to a normalized ingredient dictionary with explicit
IDs so novel phrasings don't slip through as "unknown." Treat every "unknown" result
as a hard stop for manual review, not a pass.
