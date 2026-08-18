// Vercel API helper for deployment info and redeploy
const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const PROJECT_ID = process.env.VERCEL_PROJECT_ID || 'prj_ciGBivwgLXsUTYT1ZwODemeLJNYP';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_popvin5WoD8lnax8NEcA5nQA';
const VERCEL_API = 'https://api.vercel.com';

// Warn once if env vars are missing — fallback to hardcoded production IDs
// is convenient but silently points dev/preview builds at production.
if (!process.env.VERCEL_PROJECT_ID || !process.env.VERCEL_TEAM_ID) {
  console.warn('[vercel] WARNING: VERCEL_PROJECT_ID or VERCEL_TEAM_ID not set in env — using hardcoded production fallback.');
}

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
  // The legacy `POST /v13/deployments/{id}/redeploy` endpoint was deprecated
  // and now returns 404. The supported way to "redeploy" is to create a new
  // production deployment from the project's linked git source.
  const project = await getProjectInfo();
  const link = project.link;

  if (!link) {
    throw new Error('Проект не привязан к Git. Привяжите репозиторий в Vercel.');
  }

  // Determine gitSource based on link type.
  // Note: link.branch is undefined for newer Vercel projects; productionBranch
  // is the canonical field.
  const gitBranch = link.branch || link.productionBranch || 'main';

  let gitSource;
  if (link.type === 'github') {
    gitSource = {
      type: 'github',
      org: link.org,
      repo: link.repo,
      ref: gitBranch
    };
  } else if (link.type === 'gitlab') {
    gitSource = {
      type: 'gitlab',
      projectId: link.repoId,
      ref: gitBranch
    };
  } else if (link.type === 'bitbucket') {
    gitSource = {
      type: 'bitbucket',
      org: link.org,
      repo: link.repo,
      ref: gitBranch
    };
  } else {
    throw new Error('Неподдерживаемый тип Git: ' + link.type);
  }

  console.log('[vercel] Creating new deployment from git:', JSON.stringify(gitSource));

  // Create a new production deployment from the same git ref
  const result = await vc(`/v13/deployments`, {
    method: 'POST',
    body: JSON.stringify({
      name: project.name,
      target: 'production',
      gitSource: gitSource
    })
  });

  // Vercel returns { id, url, ready, ... } — keep the shape compatible with
  // old redeploy response (which used { id, url } too).
  return {
    id: result.id || result.uid,
    url: result.url,
    state: result.readyState || result.state,
    raw: result
  };
}

async function getRecentCommits() {
  // Use GitHub API via Vercel token's link, but easier to use GitHub directly
  return null;
}

// Rollback to a previous deployment.
//
// Finds the most recent READY deployment that is NOT the current production
// deployment, takes its git commit SHA, and creates a NEW production deployment
// from that SHA. This is non-destructive — the git history is untouched, we
// just deploy an older commit on top.
//
// Returns { id, url, state, commitSha, commitMsg, raw } or throws.
async function rollbackToPreviousDeployment() {
  // 1) Get last 10 deployments to find a candidate
  const deployments = await getLatestDeployments(10);
  if (!deployments || deployments.length === 0) {
    throw new Error('Нет деплоев для отката.');
  }

  // 2) Find the current production deployment (the one with target === 'production'
  //    and state === 'READY', most recent first). Skip it. Then find the NEXT
  //    READY deployment whose commit SHA differs from the current one.
  let currentSha = null;
  for (const d of deployments) {
    const state = d.readyState || d.state;
    const isProd = d.target === 'production' || d.meta && d.meta.target === 'production';
    if (state === 'READY' && isProd) {
      currentSha = (d.meta && d.meta.githubCommitSha) || null;
      break;
    }
  }

  // 3) Find the previous READY deployment with a different commit SHA
  let candidate = null;
  for (const d of deployments) {
    const state = d.readyState || d.state;
    if (state !== 'READY') continue;
    const sha = (d.meta && d.meta.githubCommitSha) || null;
    if (!sha) continue;
    if (currentSha && sha === currentSha) continue;
    candidate = d;
    break;
  }

  if (!candidate) {
    throw new Error('Не найден предыдущий рабочий деплой. Возможно, был только один коммит.');
  }

  const targetSha = candidate.meta.githubCommitSha;
  const targetMsg = (candidate.meta.githubCommitMessage || '').split('\n')[0];
  const targetOrg = candidate.meta.githubCommitOrg || candidate.meta.githubOrg;
  const targetRepo = candidate.meta.githubCommitRepo || candidate.meta.githubRepo;

  // 4) Get project info to build gitSource
  const project = await getProjectInfo();
  const link = project.link;
  if (!link) {
    throw new Error('Проект не привязан к Git. Откат невозможен.');
  }

  // Build gitSource pointing to the specific commit SHA.
  // Vercel accepts a full 40-char SHA as `ref` for github type.
  let gitSource;
  if (link.type === 'github') {
    gitSource = {
      type: 'github',
      org: targetOrg || link.org,
      repo: targetRepo || link.repo,
      ref: targetSha   // 40-char commit SHA
    };
  } else if (link.type === 'gitlab') {
    gitSource = {
      type: 'gitlab',
      projectId: link.repoId,
      ref: targetSha
    };
  } else if (link.type === 'bitbucket') {
    gitSource = {
      type: 'bitbucket',
      org: targetOrg || link.org,
      repo: targetRepo || link.repo,
      ref: targetSha
    };
  } else {
    throw new Error('Неподдерживаемый тип Git: ' + link.type);
  }

  console.log('[vercel] Rollback: creating new production deployment from commit', targetSha.slice(0, 7));

  // 5) Create a new production deployment from the older commit
  const result = await vc(`/v13/deployments`, {
    method: 'POST',
    body: JSON.stringify({
      name: project.name,
      target: 'production',
      gitSource: gitSource
    })
  });

  return {
    id: result.id || result.uid,
    url: result.url,
    state: result.readyState || result.state,
    commitSha: targetSha,
    commitMsg: targetMsg,
    targetDeploymentId: candidate.uid || candidate.id,
    raw: result
  };
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
  const commitMsg = escapeHtml(meta.githubCommitMessage || '(no commit)').slice(0, 200);
  const commitSha = (meta.githubCommitSha || '').slice(0, 7);
  const branch = escapeHtml(meta.githubCommitRef || 'main');
  const created = new Date(d.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const url = d.url ? `https://${d.url}` : '';

  // Build clickable links
  const githubOrg = meta.githubCommitOrg || meta.githubOrg || 'Genocide12';
  const githubRepo = meta.githubCommitRepo || meta.githubRepo || 'Genopoisk';
  const githubBranch = meta.githubCommitRef || 'main';
  const githubCommitUrl = commitSha ? `https://github.com/${githubOrg}/${githubRepo}/commit/${meta.githubCommitSha}` : '';
  const githubBranchUrl = `https://github.com/${githubOrg}/${githubRepo}/tree/${githubBranch}`;
  const vercelDeployUrl = d.uid ? `https://vercel.com/genocide12s-projects/genopoisk/${d.uid}` : '';

  var lines = [`${emoji} <b>${state}</b> • ${created}`];
  lines.push(`   📝 ${commitMsg}`);
  if (commitSha) {
    if (githubCommitUrl) {
      lines.push(`   🔀 <a href="${githubCommitUrl}">#${branch} @${commitSha}</a>`);
    } else {
      lines.push(`   🔀 #${branch} @${commitSha}`);
    }
  }
  if (url) lines.push(`   🌐 <a href="${url}">${url}</a>`);
  if (vercelDeployUrl) lines.push(`   🔗 <a href="${vercelDeployUrl}">Vercel</a>`);
  if (githubBranchUrl) lines.push(`   🐙 <a href="${githubBranchUrl}">GitHub</a>`);
  return lines.join('\n');
}

module.exports = {
  getProjectInfo,
  getLatestDeployments,
  getDeploymentInfo,
  triggerRedeploy,
  rollbackToPreviousDeployment,
  formatDeployment
};
