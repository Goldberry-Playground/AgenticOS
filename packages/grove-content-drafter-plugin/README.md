# @agenticos/grove-content-drafter-plugin

Paperclip plugin implementing the **grove-content-drafter** routine (GOL-2384/C).

Every 15 minutes it drafts one nursery listing: it finds the oldest
`product.template` in Odoo whose `grove_draft_state = 'requested'`, reads its
recorded facts + provenance, and uses an LLM to write:

- `description_ecommerce` — 2–3 short storefront paragraphs
- `website_description` — a care guide (site & soil, planting, first-year care,
  pruning, harvest)
- any still-empty **required char facts** (`grove_soil`, `grove_spacing`,
  `grove_mature_size`, `grove_mature_spread`, `grove_pollination`,
  `grove_years_to_fruit`, `grove_chill_hours`) — only with a cited http(s)
  extension-service source, stamped in provenance as `{source: "agent", ref: url}`

It then posts a chatter note listing every source, sets
`grove_draft_state = 'drafted'`, and leaves `grove_guide_ready` and
`grove_facts_reviewed` **false** for a human to review, edit, and publish.

Typed/facet-driving facts (USDA zones, sun, layer) are **never** LLM-filled —
they come from the USDA fetch step (GOL-2383/B) and human review. A failed run
leaves the product in `requested` and posts the error to chatter; the next poll
retries. HTML output is restricted to the grove-sites guide allow-list
(`p, h2, h3, ul, ol, li, strong, em, a[href]`); the storefront re-sanitises on
render (defense in depth).

## Configuration (plugin instance config — never committed)

| key | required | notes |
| --- | --- | --- |
| `odooBaseUrl` | ✓ | e.g. `https://odoo.qa.gatheringatthegrove.com` (QA first) |
| `odooDb` | ✓ | default `odoo` |
| `odooUsername` | ✓ | the **Content Drafter** service user (group `grove_headless.group_content_drafter`) |
| `odooPassword` | ✓ | vaulted Content Drafter credential — set via secret-sync, never by hand |
| `anthropicApiKey` | ✓ | drafting model key — set via secret-sync |
| `anthropicModel` | | default `claude-sonnet-5` |
| `houseRules` | | authoritative editorial rules from the vault (e.g. juglone stance) |
| `dryRun` | | **defaults `true`** — reads + drafts + logs but does not write; Josh flips off to go live on QA |

The Content Drafter Odoo user is provisioned by Josh / the WS3c provisioner
(odoocker #615 / GOL-2095), not by this plugin. Point the routine at QA first;
prod only after Josh's go.

## Develop

```bash
pnpm --filter @agenticos/grove-content-drafter-plugin test       # vitest
pnpm --filter @agenticos/grove-content-drafter-plugin typecheck
pnpm --filter @agenticos/grove-content-drafter-plugin build      # rebuild dist/ (committed)
```

Rebuild `dist/` after editing `src/` — the committed bundle is what the Droplet
bind-mounts (plugins are not built on the Droplet).
