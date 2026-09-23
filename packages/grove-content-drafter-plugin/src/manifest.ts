import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.grove-content-drafter",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Grove Content Drafter",
  description:
    "Drafts nursery listing content (storefront description + cited care guide) from the recorded plant facts (GOL-2384).",
  author: "AgenticOS",
  categories: ["connector"],
  // Odoo credentials + the Anthropic key are supplied via plugin config (never
  // env — Paperclip sandboxes workers away from the host env, same as the GitHub
  // plugin). They are provisioned by Josh / the WS3c provisioner and never
  // committed. The job stays a no-op until required config is present.
  capabilities: ["jobs.schedule", "http.outbound"],
  jobs: [
    {
      jobKey: "content-draft",
      displayName: "Draft product content",
      description: "Every 15 min: draft the oldest product.template whose grove_draft_state is 'requested'.",
      schedule: "*/15 * * * *",
    },
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      odooBaseUrl: {
        type: "string",
        title: "Odoo base URL",
        description: "e.g. https://odoo.qa.gatheringatthegrove.com (QA first; prod only after Josh's go).",
        default: "https://odoo.qa.gatheringatthegrove.com",
      },
      odooDb: { type: "string", title: "Odoo database", default: "odoo" },
      odooUsername: {
        type: "string",
        title: "Content Drafter login",
        description: "The Content Drafter service user (group grove_headless.group_content_drafter).",
      },
      odooPassword: {
        type: "string",
        title: "Content Drafter password / API key",
        description: "Vaulted credential for the Content Drafter user. Set via secret-sync, never by hand.",
      },
      anthropicApiKey: {
        type: "string",
        title: "Anthropic API key",
        description: "Key for the drafting model. Stored in plugin config; set via secret-sync.",
      },
      anthropicModel: {
        type: "string",
        title: "Drafting model",
        description: "Anthropic model id used to draft content.",
        default: "claude-sonnet-5",
      },
      houseRules: {
        type: "string",
        title: "House rules",
        description:
          "Authoritative editorial rules from the vault (e.g. juglone: minor factor, never 'poison'). Injected into the system prompt.",
        default: "",
      },
      dryRun: {
        type: "boolean",
        title: "Dry run (no writes)",
        description:
          "When true (default), the job reads + drafts + logs but does NOT write back or change draft state. Josh flips this off to go live on QA.",
        default: true,
      },
    },
    required: ["odooBaseUrl", "odooDb", "odooUsername", "odooPassword", "anthropicApiKey"],
  },
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
