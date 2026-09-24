import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "agenticos.grove-content-drafter",
  apiVersion: 1,
  // 0.2.0 — GOL-2424 Option A: the LLM call moved out of the plugin (no metered
  // Anthropic key) and into a Paperclip agent (Sora) on the Claude subscription.
  // The plugin now opens a request issue per product, receives the agent's fenced
  // JSON reply via the issue.comment.created event (+ a sweep backstop), and does
  // all Odoo writes itself. Bump on every manifest change (CI convergence).
  version: "0.2.0",
  displayName: "Grove Content Drafter",
  description:
    "Drafts nursery listing content (storefront description + cited care guide) from recorded plant facts. " +
    "An agent (Sora) does the writing on the Claude subscription; the plugin owns all Odoo reads/writes (GOL-2384/GOL-2424).",
  author: "AgenticOS",
  categories: ["connector"],
  // Odoo credentials + the Paperclip coordinates are supplied via plugin config
  // (never env — workers are sandboxed away from the host env). They are set by
  // Josh's Claude Code session from 1Password; the jobs stay no-ops until the
  // required config is present. There is NO Anthropic key: drafting runs in an
  // agent, so the plugin never holds a metered LLM credential.
  capabilities: [
    "jobs.schedule",
    "http.outbound",
    "events.subscribe",
    "issues.read",
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issue.comments.read",
    "issue.comments.create",
    "plugin.state.read",
    "plugin.state.write",
  ],
  jobs: [
    {
      jobKey: "content-draft-request",
      displayName: "Open draft requests",
      description:
        "Nightly: for each product whose grove_draft_state is 'requested', open (up to maxDraftsPerRun) issues assigned to the drafting agent.",
      schedule: "0 7 * * *",
    },
    {
      jobKey: "content-draft-sweep",
      displayName: "Harvest draft replies",
      description:
        "Every 20 min: apply any drafting-agent reply the event missed, and re-ping / give up on overdue requests.",
      schedule: "*/20 * * * *",
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
        // Deliberately NOT format:"secret-ref" — this host strips secret-ref
        // fields from saved config (ref resolution is disabled), so marking it
        // would leave the worker with an empty Odoo password. The sacrificial
        // `unusedSecretRef` field below is the sole secret-ref, which scopes the
        // config extractor and keeps the UUID-shaped id fields from being
        // rejected. Same reasoning as discord/github-sync plain credential fields.
        title: "Content Drafter password / API key",
        description: "Vaulted credential for the Content Drafter user. Set from 1Password; never committed.",
      },
      houseRules: {
        type: "string",
        title: "House rules",
        description:
          "Authoritative editorial rules from the vault (e.g. juglone: minor factor, never 'poison'). Injected into the system brief.",
        default: "",
      },
      companyId: {
        type: "string",
        title: "Paperclip Company ID (Goldberry Grove)",
        description: "UUID of the company that owns the products and request issues. Required — jobs have no ambient actor.",
      },
      groveProjectId: {
        type: "string",
        title: "Grove project ID",
        description: "UUID of the project the draft-request issues are filed under.",
      },
      drafterAgentId: {
        type: "string",
        title: "Drafting agent ID (CMO - Sora)",
        description:
          "UUID of the agent that writes the drafts on the Claude subscription. Its comments are the only ones the receive phase reads.",
        default: "c629faf1-cb50-4b7b-b766-3d68f71d54ed",
      },
      maxDraftsPerRun: {
        type: "number",
        title: "Max draft requests per run",
        description: "Cap on how many products the nightly request job turns into issues, to bound shared subscription quota.",
        default: 5,
      },
      replyTimeoutHours: {
        type: "number",
        title: "Reply timeout (hours)",
        description: "Hours with no usable reply before the sweep re-pings the agent once, then (after another window) gives up.",
        default: 12,
      },
      dryRun: {
        type: "boolean",
        title: "Dry run (no writes)",
        description:
          "When true (default), the receive phase validates + logs the draft but does NOT write it to Odoo. Josh flips this off to go live on QA.",
        default: true,
      },
      unusedSecretRef: {
        type: "string",
        // Load-bearing sacrifice, NOT semantic: the host's config secret-ref
        // extractor falls back to flagging ANY UUID-looking string as a secret
        // reference when NO field declares format:"secret-ref". companyId /
        // groveProjectId / drafterAgentId are UUIDs, so without this the whole
        // config is rejected ("secret references are disabled"). Declaring one
        // secret-ref field scopes the extractor to this path only. Nothing reads it.
        format: "secret-ref",
        title: "(reserved — do not set)",
        description: "Reserved. Leave empty. Present only to scope the config secret-ref extractor to this field.",
      },
    },
    required: ["odooBaseUrl", "odooDb", "odooUsername", "odooPassword", "companyId", "groveProjectId", "drafterAgentId"],
  },
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
