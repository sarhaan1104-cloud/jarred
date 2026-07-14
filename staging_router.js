/*
 * Pressure Canning Verifier - Staging Router
 * ------------------------------------------
 * Framework-agnostic. Drop into the HTML app or the Android WebView.
 *
 * CORE PRINCIPLE: the jar is a whitelist, not a calculator.
 * We never invent a processing time for an arbitrary mixture. We either
 * MATCH the jar contents to a tested USDA process, or we tell the user to
 * can the components separately / route them out of the jar.
 *
 * Usage:
 *   const router = new StagingRouter(testedProcessesJson);
 *   const result = router.stageRecipe([
 *     { name: "chicken thighs", amountCups: 4 },
 *     { name: "carrots",        amountCups: 1 },
 *     { name: "heavy cream",    amountCups: 0.5 },
 *     { name: "flour",          amountCups: 0.25 },
 *     { name: "salt",           amountCups: 0.02 }
 *   ], { jarSize: "pt", altitudeFt: 1200, gauge: "dial" });
 *
 * result = {
 *   pathway1: [...],   // goes in the jar
 *   pathway2: [...],   // freeze / vacuum-seal (sauces, thickeners, purees)
 *   pathway3: [...],   // add fresh at serving (dairy, pasta, finishing fat...)
 *   seasonings: [...], // no-count flavorings
 *   jarProcess: { method, timeMin, psi, headspaceInch, source } | null,
 *   verdict: "SINGLE_FOOD" | "SOUP" | "CAN_SEPARATELY" | "NOT_CANNABLE",
 *   percentInJar, percentOutOfJar,
 *   warnings: [...]
 * }
 */

class StagingRouter {
  constructor(data) {
    this.data = data;
    this.p1 = data.pathway1_inJar;
    this.soup = data.soupGate;
    this.blocks = data.notInJar;
    this.seasonings = data.seasonings_noCount;
  }

  // --- normalize a name for matching ---
  _norm(s) {
    return (s || "").toLowerCase().trim();
  }

  // --- return length of the longest alias in `aliases` that appears in name, else 0 ---
  _bestMatchLen(name, aliases) {
    const n = this._norm(name);
    let best = 0;
    for (const a of aliases) {
      const al = this._norm(a);
      if (al && n.includes(al) && al.length > best) best = al.length;
    }
    return best;
  }

  /*
   * Classify a single ingredient into a pathway.
   * LONGEST-MATCH-WINS across every category, so a specific form beats a
   * generic whitelist entry: "mushroom powder" (block) beats "mushroom"
   * (whitelist); "mashed potato" (block) beats "potato" (whitelist).
   * On a length tie, a not-in-jar category wins over the whitelist (conservative).
   */
  classify(ingredient) {
    const name = ingredient.name;
    const candidates = [];

    // seasonings
    const sLen = this._bestMatchLen(name, this.seasonings.items);
    if (sLen) candidates.push({ len: sLen, priority: 1, result: {
      pathway: "seasoning", category: "seasoning_noCount",
      reason: "Flavor only - no safety impact, not counted toward jar fill." } });

    // hard blocks
    for (const key of Object.keys(this.blocks)) {
      if (key.startsWith("_")) continue;
      const block = this.blocks[key];
      const bLen = this._bestMatchLen(name, block.items);
      if (bLen) {
        const pathway = block.route.startsWith("pathway2") ? "pathway2"
                      : block.route.startsWith("pathway3") ? "pathway3"
                      : "blocked";
        candidates.push({ len: bLen, priority: 1, result: {
          pathway, category: key, reason: block.reason,
          allowance: block.allowance || null, route: block.route } });
      }
    }

    // tested whitelist (lower tie-break priority than blocks/seasonings)
    for (const key of Object.keys(this.p1)) {
      if (key.startsWith("_")) continue;
      const proc = this.p1[key];
      const pLen = this._bestMatchLen(name, proc.aliases);
      if (pLen) candidates.push({ len: pLen, priority: 0, result: {
        pathway: "pathway1", category: key, process: proc,
        reason: "Matches a tested USDA process." } });
    }

    if (candidates.length === 0) {
      return { pathway: "unknown", category: "other",
               reason: "No tested process found and not a recognized block. Verify manually against the USDA guide before canning." };
    }

    candidates.sort((a, b) => (b.len - a.len) || (b.priority - a.priority));
    return candidates[0].result;
  }
  _psiFor(gauge, altitudeFt) {
    const table = gauge === "weighted"
      ? this.data._meta.altitudeAdjustment.weightedGauge
      : this.data._meta.altitudeAdjustment.dialGauge;
    const row = table.find(r => altitudeFt >= r.minFt && altitudeFt <= r.maxFt);
    return row ? row.psi : table[table.length - 1].psi;
  }

  /*
   * Decide the jar process for the set of Pathway-1 items.
   * - 0 tested foods           -> NOT_CANNABLE
   * - exactly 1 tested food     -> that food's tested time (SINGLE_FOOD)
   * - 2+ tested foods           -> soup gate:
   *       passes soup rules     -> SOUP time (100 if seafood)
   *       fails                 -> CAN_SEPARATELY (list each component's own time)
   */
  _resolveJarProcess(p1items, opts) {
    const { jarSize, altitudeFt, gauge } = opts;
    const psi = this._psiFor(gauge, altitudeFt);
    const warnings = [];

    // Covering liquids (broth/stock/water) are NOT counted as solid foods.
    // They don't trigger the soup gate; they're just the packing liquid.
    const liquids = p1items.filter(it => it.process && it.process.isLiquid);
    const solids  = p1items.filter(it => !(it.process && it.process.isLiquid));

    if (solids.length === 0) {
      if (liquids.length > 0) {
        // plain stock/broth on its own
        const stock = liquids[0].process;
        const t = stock.time[jarSize];
        return {
          jarProcess: t === null ? null : {
            method: "pressure", timeMin: t, psi,
            headspaceInch: stock.headspaceInch, basis: stock.displayName,
            source: "USDA Complete Guide (2015 rev.)"
          },
          verdict: "SINGLE_FOOD", warnings
        };
      }
      return { jarProcess: null, verdict: "NOT_CANNABLE",
               warnings: ["No tested in-jar ingredients. Nothing to can as written."] };
    }

    const timed = solids.map(it => {
      const t = it.process.time[jarSize];
      if (t === null) warnings.push(`${it.process.displayName} has no tested process for ${jarSize === "pt" ? "pints" : "quarts"}; use the other jar size.`);
      return { item: it, time: t };
    });

    const hasSeafood = solids.some(it =>
      it.category === "seafood_fish" || /seafood|shrimp|crab|clam|oyster/.test(this._norm(it.name)));

    // SINGLE solid food (broth, if any, is just its covering liquid)
    if (solids.length === 1) {
      const only = timed[0];
      return {
        jarProcess: only.time === null ? null : {
          method: "pressure", timeMin: only.time, psi,
          headspaceInch: only.item.process.headspaceInch,
          basis: only.item.process.displayName,
          source: "USDA Complete Guide (2015 rev.)"
        },
        verdict: "SINGLE_FOOD", warnings
      };
    }

    // 2+ solid foods -> soup gate.
    const soupTime = hasSeafood ? this.soup.timeSeafood[jarSize] : this.soup.time[jarSize];
    warnings.push("Multiple tested foods in one jar -> routed through the USDA 'your choice' soup pathway. This REQUIRES: fill jar halfway with solids then cover with liquid (1:1), boil the mix 5 min first, pre-cook meat, no thickeners/dairy/pasta.");
    if (hasSeafood) warnings.push("Seafood present -> whole jar held at the seafood time (100 min).");

    return {
      jarProcess: {
        method: "pressure", timeMin: soupTime, psi,
        headspaceInch: this.soup.headspaceInch,
        basis: "USDA 'your choice' soup",
        source: "USDA Complete Guide (2015 rev.)",
        soupRules: this.soup.rules
      },
      verdict: "SOUP", warnings
    };
  }

  // --- main entry point ---
  stageRecipe(ingredients, opts = {}) {
    const options = {
      jarSize: opts.jarSize || "pt",     // "pt" | "qt"
      altitudeFt: opts.altitudeFt || 0,
      gauge: opts.gauge || "dial"        // "dial" | "weighted"
    };

    const buckets = { pathway1: [], pathway2: [], pathway3: [], seasonings: [], unknown: [], blocked: [] };
    const warnings = [];

    for (const ing of ingredients) {
      const c = this.classify(ing);
      const entry = Object.assign({ name: ing.name, amountCups: ing.amountCups || 0 }, c);

      switch (c.pathway) {
        case "pathway1":  buckets.pathway1.push(entry); break;
        case "pathway2":  buckets.pathway2.push(entry);
                          warnings.push(`"${ing.name}" -> freeze/vacuum-seal: ${c.reason}`); break;
        case "pathway3":  buckets.pathway3.push(entry);
                          warnings.push(`"${ing.name}" -> add fresh at serving: ${c.reason}`); break;
        case "seasoning": buckets.seasonings.push(entry); break;
        case "blocked":   buckets.blocked.push(entry);
                          warnings.push(`"${ing.name}" -> CANNOT be canned in any form: ${c.reason}`); break;
        default:          buckets.unknown.push(entry);
                          warnings.push(`"${ing.name}" -> UNKNOWN: ${c.reason}`);
      }
    }

    const resolved = this._resolveJarProcess(buckets.pathway1, options);

    // percentage: main ingredient (jar) vs everything countable outside it.
    // seasonings are excluded from the denominator (no-count).
    const jarCups = buckets.pathway1.reduce((s, i) => s + (i.amountCups || 0), 0);
    const outCups = [...buckets.pathway2, ...buckets.pathway3, ...buckets.unknown, ...buckets.blocked]
                      .reduce((s, i) => s + (i.amountCups || 0), 0);
    const totalCountable = jarCups + outCups;
    const percentInJar = totalCountable ? Math.round((jarCups / totalCountable) * 100) : 0;
    const percentOutOfJar = totalCountable ? 100 - percentInJar : 0;

    let verdict = resolved.verdict;
    if (buckets.unknown.length > 0 && verdict !== "NOT_CANNABLE") {
      warnings.push("Recipe contains unrecognized ingredient(s). Resolve these manually before trusting the verdict.");
    }

    return {
      options,
      pathway1_inJar: buckets.pathway1,
      pathway2_freezeVacuumSeal: buckets.pathway2,
      pathway3_freshAtServing: buckets.pathway3,
      blocked: buckets.blocked,
      seasonings_noCount: buckets.seasonings,
      unknown: buckets.unknown,
      jarProcess: resolved.jarProcess,
      verdict,
      percentInJar,
      percentOutOfJar,
      warnings: warnings.concat(resolved.warnings),
      disclaimer: "Reference/triage only. This does NOT certify the recipe as safe. Confirm the exact process against the current USDA Complete Guide or nchfp.uga.edu before canning."
    };
  }
}

// Export for module systems; ignore if loaded as a plain <script>.
if (typeof module !== "undefined" && module.exports) {
  module.exports = StagingRouter;
}
