import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import { OdooClient } from "./odoo-client.js";
import { AnthropicClient } from "./anthropic.js";
import { runContentDraft } from "./job.js";

interface DrafterConfig {
  odooBaseUrl: string;
  odooDb: string;
  odooUsername: string;
  odooPassword: string;
  anthropicApiKey: string;
  anthropicModel: string;
  houseRules: string;
  dryRun: boolean;
}

function readConfig(raw: Record<string, unknown>): DrafterConfig {
  return {
    odooBaseUrl: String(raw.odooBaseUrl ?? "https://odoo.qa.gatheringatthegrove.com"),
    odooDb: String(raw.odooDb ?? "odoo"),
    odooUsername: String(raw.odooUsername ?? ""),
    odooPassword: String(raw.odooPassword ?? ""),
    anthropicApiKey: String(raw.anthropicApiKey ?? ""),
    anthropicModel: String(raw.anthropicModel ?? "claude-sonnet-5"),
    houseRules: String(raw.houseRules ?? ""),
    // dryRun defaults TRUE — never write until Josh explicitly enables it.
    dryRun: raw.dryRun === undefined ? true : Boolean(raw.dryRun),
  };
}

/** Build the Odoo + LLM clients from current config, read at call time. */
async function build(ctx: PluginContext) {
  const cfg = readConfig(await ctx.config.get());
  const missing = (["odooBaseUrl", "odooDb", "odooUsername", "odooPassword", "anthropicApiKey"] as const).filter(
    (k) => !cfg[k],
  );
  if (missing.length) {
    throw new Error(`content-drafter not configured — missing: ${missing.join(", ")}`);
  }
  return {
    cfg,
    odoo: new OdooClient({
      baseUrl: cfg.odooBaseUrl,
      db: cfg.odooDb,
      username: cfg.odooUsername,
      password: cfg.odooPassword,
    }),
    llm: new AnthropicClient({ apiKey: cfg.anthropicApiKey, model: cfg.anthropicModel }),
  };
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Grove content-drafter plugin starting");

    ctx.jobs.register("content-draft", async () => {
      const { cfg, odoo, llm } = await build(ctx);
      const summary = await runContentDraft({
        odoo,
        llm,
        houseRules: cfg.houseRules,
        dryRun: cfg.dryRun,
        now: new Date(),
        logger: ctx.logger,
      });
      ctx.logger.info("content-draft run complete", summary as unknown as Record<string, unknown>);
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
