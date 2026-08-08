// Vercel API helper for deployment info and redeploy
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_ciGBivwgLXsUTYT1ZwODemeLJNYP';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_popvin5WoD8lnax8NEcA5nQA';
const VERCEL_API = 'https://api.vercel.com';

async function vc(path, opts = {}) {
  if (!VERCEL_TOKEN) throw new Error('VERCEL_TOKEN not set');
  const url = `${VERCEL_API}${path}${path.includes('?') ? '&' : '?'}teamId=${TEAM_ID}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${VERCEL_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Vercel ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function getProjectInfo() {
  return vc(`/v9/projects/${PROJECT_ID}`);
}

async function getLatestDeployments(limit = 5) {
  const data = await vc(`/v6/deployments?projectId=${PROJECT_ID}&limit=${limit}`);
  return data.deployments || [];
}

async function getDeploymentInfo(deploymentId) {
  return vc(`/v13/deployments/${deploymentId}`);
}

async function triggerRedeploy() {
  // Get latest production deployment and trigger redeploy
  const deployments = await getLatestDeployments(5);
  const prod = deployments.find(d => d.target === 'production' || d.state === 'READY');
  if (!prod) throw new Error('No production deployment found');
  return vc(`/v13/deployments/${prod.uid}/redeploy`, {
    method: 'POST',
    body: JSON.stringify({
      name: prod.name,
      target: 'production'
    })
  });
}

async function getRecentCommits() {
  // Use GitHub API via Vercel token's link, but easier to use GitHub directly
  return null;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDeployment(d) {
  const state = d.readyState || d.state || '?';
  const emoji = state === 'READY' ? '✅' : state === 'ERROR' ? '❌' : state === 'BUILDING' ? '🔨' : '⏳';
  const meta = d.meta || {};
  // Escape HTML in commit message — it may contain <meta>, <script>, etc.
  // Telegram HTML parser will fail with "Unsupported start tag" if not escaped.
  const commitMsg = escapeHtml(meta.githubCommitMessage || '(no commit)').slice(0, 200);
  const commitSha = (meta.githubCommitSha || '').slice(0, 7);
  const branch = escapeHtml(meta.githubCommitRef || 'main');
  const created = new Date(d.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const url = d.url ? `https://${d.url}` : '';
  return `${emoji} <b>${state}</b> • ${created}\n   📝 ${commitMsg}\n   🔀 #${branch} @${commitSha}\n   🔗 ${url}`;
}

module.exports = {
  getProjectInfo,
  getLatestDeployments,
  getDeploymentInfo,
  triggerRedeploy,
  formatDeployment
};
