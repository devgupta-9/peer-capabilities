# Third-party components

This repository installs but does not relicense:

| Component | Pinned version | Source |
| --- | --- | --- |
| Graphify | 0.9.63 | https://pypi.org/project/graphifyy/ |
| Headroom | 0.37.0 | https://pypi.org/project/headroom-ai/ |
| Jev MCP | 0.5.0 | https://www.npmjs.com/package/@jkudish/jev-mcp |
| MCP TypeScript SDK | package lock | https://www.npmjs.com/package/@modelcontextprotocol/server |
| Zod | package lock | https://www.npmjs.com/package/zod |

Their packages, notices, and licenses remain governed by their upstream projects. `npm ci` uses committed package locks. Graphify and Headroom use committed `requirements.lock` files containing exact transitive versions and package hashes; `uv tool install --with-requirements` verifies those supplied hashes during installation.

The third-party skill bodies present on the maintainer's workstation are excluded from this public repository. `skills-manifest.json` is provenance metadata only.
