import { z } from "zod";
import { DEFAULT_MCP_SERVER_URL } from "@/lib/mcp-vault/port";

/**
 * Fix 2: Path traversal prevention (VibeSec finding)
 *
 * Reusable Zod refinement for filesystem paths accepted by the config.
 * Blocks paths that could be used for directory traversal when Phase 2's
 * vault reader consumes these fields.
 *
 * Rules:
 *   - Non-empty
 *   - Must start with `/` (POSIX absolute) or `~` (tilde-prefixed home)
 *   - No `..` path segments anywhere (prevents traversal)
 *   - No NUL bytes (prevents null-byte injection)
 */
const absolutePath = z
  .string()
  .min(1, "Path must not be empty")
  .refine(
    (p) => p.startsWith("/") || p.startsWith("~"),
    "Path must be absolute (starting with / or ~)"
  )
  .refine(
    (p) =>
      !p
        .split(/[/\\]/)
        .some((segment) => segment === ".."),
    "Path must not contain .. segments"
  )
  .refine((p) => !p.includes("\0"), "Path must not contain NUL bytes");

export const ProjectRootSchema = z.object({
  path: absolutePath,
  tags: z.array(z.string()),
});

export const ModelPreferenceSchema = z.object({
  tier: z.enum(["haiku", "sonnet", "opus"]),
  default: z.string(),
});

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});

export const AgenticOSConfigSchema = z.object({
  projectRoots: z.array(ProjectRootSchema),
  vaultPath: absolutePath,
  hermesUrl: z.string().url().default("http://127.0.0.1:7600"),
  mcpServerUrl: z.string().url().default(DEFAULT_MCP_SERVER_URL),
  modelDefaults: z.object({
    haiku: z.string(),
    sonnet: z.string(),
    opus: z.string(),
  }),
  connectors: z.array(ConnectorConfigSchema),
});

export type ProjectRoot = z.infer<typeof ProjectRootSchema>;
export type ModelPreference = z.infer<typeof ModelPreferenceSchema>;
export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;
export type AgenticOSConfig = z.infer<typeof AgenticOSConfigSchema>;

export const DEFAULT_CONNECTORS: ConnectorConfig[] = [
  { id: "farmos", enabled: false },
  { id: "odoo", enabled: false },
  { id: "ghost", enabled: false },
  { id: "asana", enabled: false },
  { id: "slack", enabled: false },
  { id: "gh", enabled: false },
];

export const DEFAULT_CONFIG: AgenticOSConfig = {
  projectRoots: [],
  vaultPath: "~/Documents/Dev Projects/vault",
  hermesUrl: "http://127.0.0.1:7600",
  mcpServerUrl: DEFAULT_MCP_SERVER_URL,
  modelDefaults: {
    haiku: "claude-haiku-4-5",
    sonnet: "claude-sonnet-4-7",
    opus: "claude-opus-4-7",
  },
  connectors: DEFAULT_CONNECTORS,
};
