# OpenDesign Content Libraries — vendored for SYNKRA Agent Studio

This directory vendors the content libraries of [OpenDesign](https://github.com/nexu-io/open-design)
(`nexu-io/open-design` at commit time of integration), the open-source collaborative AI
design agent workspace, licensed under the Apache License 2.0 (see `LICENSE`).

SYNKRA Design adapts OpenDesign's product capabilities into its own interface
("SYNKRA Agent Studio"). The libraries are vendored verbatim so the full capability
inventory ships with the platform:

| Directory           | Contents                                                                 | Count |
| ------------------- | ------------------------------------------------------------------------ | ----- |
| `skills/`           | Agent skills (`SKILL.md` with YAML frontmatter: triggers, od mode, category) | 171 |
| `design-systems/`   | Brand-grade design systems (`DESIGN.md`, `design-tokens.json`, `tokens.css`, `components.html`, previews, i18n variants) | 154 |
| `design-templates/` | Scenario design templates (`SKILL.md` + seed `example.html`)             | 40+ |
| `prompt-templates/` | Community media prompt cards (`image/`, `video/`)                        | 500+ |

Upstream project: https://github.com/nexu-io/open-design (Apache-2.0).
Prompts adapted from `apps/daemon/src/prompts/` (official-system, discovery,
directions, deck-framework) retain their upstream licensing.
