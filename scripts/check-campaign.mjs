import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { CAMPAIGN } = await server.ssrLoadModule('/src/game/campaign/index.ts');
  const { BLUEPRINTS } = await server.ssrLoadModule('/src/assets/blueprints/index.ts');
  const { validateCampaign } = await server.ssrLoadModule('/src/game/campaign/validate.ts');
  const issues = validateCampaign(CAMPAIGN, { blueprints: new Set(Object.keys(BLUEPRINTS)) });
  for (const issue of issues) console.error(`${issue.missionId} ${issue.path} [${issue.code}] ${issue.message}`);
  if (issues.length) process.exitCode = 1;
  else console.log(`Campaign content valid: ${CAMPAIGN.missions.length} episodes; blueprint, speaker, codex and explicit mission references checked.`);
} finally {
  await server.close();
}
