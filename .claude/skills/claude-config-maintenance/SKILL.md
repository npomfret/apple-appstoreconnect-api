---
description: Use when adding or changing CLAUDE.md, .claude rules, skills, agents, settings, permissions, hooks, or Claude Code workflow guidance in this repository. Do not use for application code unless the change also establishes a lasting approved convention.
user-invocable: true
---

# Claude configuration maintenance

1. Keep `CLAUDE.md` short: operating contract, commands, danger areas, and routing only.
2. Put always-on or path-specific standing instructions in `.claude/rules/`; task-shaped
   procedures in narrowly named skills; detail in `.claude/references/`.
3. Make skill descriptions match ordinary user wording and say when not to use them.
4. Put deterministic safety controls in `.claude/settings.json`, not only prose. Never add
   project settings that silently broaden permissions or access credentials.
5. Avoid hooks unless they enforce a concrete, quick, deterministic invariant. Explain any
   added hook and ensure it does not disclose session material or perform live writes.
6. Review configuration changes as carefully as production code: validate JSON, ensure
   references exist, and update routing when a capability is added or removed.
