/**
 * @process project/regolith-polish
 * @description Brownfield React UX, safety, installation, update-survival, and reversible K1 Max deployment convergence.
 * @skill react-development specializations/web-development/skills/react-development/SKILL.md
 * @skill web-security specializations/web-development/skills/web-security/SKILL.md
 * @skill web-performance specializations/web-development/skills/web-performance/SKILL.md
 * @agent frontend-architect specializations/web-development/agents/frontend-architect/AGENT.md
 * @agent react-developer specializations/web-development/agents/react-developer/AGENT.md
 * @agent accessibility-auditor specializations/web-development/agents/accessibility-auditor/AGENT.md
 * @agent security-hardening specializations/web-development/agents/security-hardening/AGENT.md
 * @agent e2e-testing specializations/web-development/agents/e2e-testing/AGENT.md
 * @agent deployment specializations/web-development/agents/deployment/AGENT.md
 */

import { defineTask } from '@a5c-ai/babysitter-sdk';

export async function process(inputs, ctx) {
  const {
    projectName = 'Regolith',
    repositoryRoot,
    branch = 'main',
    printerHost = 'forge.local',
    printerUser = 'root',
    qualityTarget = 92,
    maxRefinementPasses = 2,
  } = inputs;

  const shared = {
    projectName,
    repositoryRoot,
    branch,
    printerHost,
    printerUser,
    qualityTarget,
    constraints: [
      'Work directly on main and preserve unrelated user changes.',
      'Commit and push validated atomic batches as thekozugroup@gmail.com with no AI co-author tags.',
      'Maintain working.md as current handoff source.',
      'Apply Apple HIG principles without Liquid Glass; use restrained Android 17-style frosted blur only where hierarchy benefits.',
      'Optimize for novice Apple users: clear hierarchy, progressive disclosure, safe defaults, plain copy, keyboard and touch accessibility.',
      'Never send G-code, start prints, move axes, home, heat, extrude, change firmware, restart printer services, or alter printer configuration.',
      'Printer access is read-only until idle state, backup, rollback, exact scope, and failure recovery are proven.',
      'Live deployment may replace static web assets only; it must be atomic, reversible, and auto-rollback on failed verification.',
      'Never expose credentials in files, logs, commits, or task results.',
    ],
  };

  ctx.log('info', 'Phase 1: brownfield product, UI, safety, install, and printer baseline audit');
  const baseline = await ctx.task(baselineAuditTask, shared);

  ctx.log('info', 'Phase 2: highest-value UI/UX and safety implementation');
  const implementation = await ctx.task(implementationTask, { ...shared, baseline });

  ctx.log('info', 'Phase 3: local visual, responsive, keyboard, and failure-state verification');
  let quality = await ctx.task(visualQualityTask, { ...shared, baseline, implementation });

  const refinements = [];
  for (let pass = 1; pass <= maxRefinementPasses && quality.needsRefinement; pass += 1) {
    const refinement = await ctx.task(refinementTask, {
      ...shared,
      pass,
      findings: quality.findings,
      priorEvidence: quality.evidence,
    });
    refinements.push(refinement);
    quality = await ctx.task(visualQualityTask, {
      ...shared,
      baseline,
      implementation,
      refinements,
      verificationPass: pass + 1,
    });
  }

  ctx.log('info', 'Phase 4: installation, deployment, update-survival, and rollback hardening');
  const delivery = await ctx.task(deliveryHardeningTask, {
    ...shared,
    baseline,
    implementation,
    quality,
  });

  ctx.log('info', 'Phase 5: guarded K1 Max live validation and static UI deployment');
  const liveValidation = await ctx.task(printerValidationTask, {
    ...shared,
    delivery,
    quality,
  });

  ctx.log('info', 'Phase 6: final product audit, handoff, exact-current tests, commit, and push');
  const finalGate = await ctx.task(finalGateTask, {
    ...shared,
    baseline,
    implementation,
    refinements,
    quality,
    delivery,
    liveValidation,
  });

  return {
    success: finalGate.passed,
    projectName,
    baseline,
    implementation,
    refinements,
    quality,
    delivery,
    liveValidation,
    finalGate,
    metadata: {
      processId: 'project/regolith-polish',
      completedAt: ctx.now(),
    },
  };
}

const commonOutputSchema = {
  type: 'object',
  required: ['summary', 'evidence'],
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array' },
    commit: { type: ['string', 'null'] },
    pushed: { type: 'boolean' },
  },
};

export const baselineAuditTask = defineTask('regolith-baseline-audit', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Audit Regolith and establish safety baseline',
  agent: {
    name: 'regolith-product-auditor',
    prompt: {
      role: 'Senior product designer, accessibility auditor, web security reviewer, and Klipper safety engineer',
      task: 'Perform an evidence-backed read-only audit. Do not edit product files.',
      context: args,
      instructions: [
        'Inspect full repository, git state/history, README, deploy path, React UI, Moonraker client, safety module, K1 Max profile, and untracked files.',
        'Run existing lint/build checks as baseline; do not install new dependencies yet.',
        'Use audit and frontend-design principles: Apple HIG hierarchy, novice ease, progressive disclosure, 44px targets, keyboard/focus, contrast, responsive behavior, reduced motion, error recovery, and non-generic visual direction.',
        'Audit every printer-affecting path for bounds validation, print-state gates, confirmation quality, command injection, stale state, double submission, offline behavior, and least privilege.',
        'Assess installation friction, credential handling, rollback truthfulness, software-update survival, and whether deploy.sh actually auto-rolls back after every post-swap failure.',
        'Connect to forge.local via SSH only for read-only commands. Query printer/Moonraker state and paths without changing files, services, settings, temperatures, position, or jobs.',
        'Identify installed/live UI path, storage mounts, updater behavior clues, current backups, available disk, firmware/model/version, and safe rollback options.',
        'Treat scripts/light-watchdog.py and .sh as user-owned untracked files. Inspect and report; do not edit, delete, stage, or commit them.',
        'Prioritize concrete high-impact fixes achievable now. Include exact commands/evidence without credentials.',
      ],
      outputFormat: 'JSON matching schema; summary, prioritized findings, and evidence. No edits.',
    },
    outputSchema: commonOutputSchema,
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['audit', 'react', 'accessibility', 'safety', 'printer', 'read-only'],
}));

export const implementationTask = defineTask('regolith-ui-safety-implementation', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Implement highest-value UI, UX, and safety fixes',
  agent: {
    name: 'regolith-react-developer',
    prompt: {
      role: 'Staff React engineer and product designer specializing in safety-critical consumer interfaces',
      task: 'Implement and verify the highest-value baseline findings end to end.',
      context: args,
      instructions: [
        'Use frontend-design and harden skills. Apply baseline findings, not a superficial restyle.',
        'Keep product industrial/refined and calm. Apple HIG information hierarchy and interaction clarity; restrained frosted blur for navigation/status chrome only; no Liquid Glass, glow, generic glass cards, or decorative gradients.',
        'Make first-use path obvious to nontechnical Apple users. Add progressive disclosure, actionable connection/offline states, plain safety copy, consistent button hierarchy, visible focus, large touch targets, and responsive navigation.',
        'Strengthen shared printer action safety with typed/allowlisted commands, current-state gates, duplicate prevention, actionable errors, and least-destructive defaults where supported by architecture.',
        'Add focused automated tests for pure safety logic and critical behavior using minimal appropriate tooling when absent.',
        'Create/update working.md with goal, current state, safety boundaries, evidence, deployment/rollback notes, untracked user files, and next steps.',
        'Preserve scripts/light-watchdog.py and .sh unchanged and unstaged.',
        'Run exact-current lint, tests, and production build. Fix failures caused by work.',
        'Set local git identity to thekozugroup / thekozugroup@gmail.com. Commit only owned changes as one atomic batch and push main. No co-author tags.',
        'Return actual files, tests, commit hash, push result, and remaining gaps.',
      ],
      outputFormat: 'JSON matching schema with actual work and evidence.',
    },
    outputSchema: commonOutputSchema,
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['implementation', 'frontend', 'safety', 'hig', 'hardening'],
}));

export const visualQualityTask = defineTask('regolith-visual-quality-gate', (args, taskCtx) => ({
  kind: 'agent',
  title: `Verify Regolith UI quality${args.verificationPass ? ` pass ${args.verificationPass}` : ''}`,
  agent: {
    name: 'regolith-e2e-reviewer',
    prompt: {
      role: 'Independent UX critic, accessibility tester, and browser QA engineer',
      task: 'Run a read-only visual and interaction quality gate against exact-current local code.',
      context: args,
      instructions: [
        'Use browser-use and audit skills. Start local app safely and inspect real rendered UI; close browser/server when done.',
        'Test at 1440x900, 1024x768, 768x1024, and 390x844. Capture screenshots to a temporary or ignored evidence location.',
        'Inspect every primary route and representative empty/offline/loading/error/connected state available without printer mutation.',
        'Use keyboard-only navigation, check focus order/visibility, landmarks, accessible names, target size, zoom/reflow, reduced motion, contrast, overflow, console errors, and mobile navigation.',
        'Judge Apple-user ease: first action obvious, terminology plain, dangerous actions subordinate and confirmed, advanced controls progressively disclosed, recovery clear.',
        'Judge visual direction: coherent industrial/refined hierarchy, purposeful frosted chrome, no Liquid Glass, no excessive glass/card nesting, no redundant copy.',
        'Do not click any control that can send printer commands. Do not edit code.',
        `Set needsRefinement true when score is below ${args.qualityTarget} or any critical/high issue remains.`,
        'Return score and prioritized findings with screenshot/test evidence.',
      ],
      outputFormat: 'JSON with summary, score, needsRefinement, findings, evidence.',
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'score', 'needsRefinement', 'findings', 'evidence'],
      properties: {
        summary: { type: 'string' },
        score: { type: 'number' },
        needsRefinement: { type: 'boolean' },
        findings: { type: 'array' },
        evidence: { type: 'array' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['qa', 'browser', 'accessibility', 'responsive', 'visual'],
}));

export const refinementTask = defineTask('regolith-quality-refinement', (args, taskCtx) => ({
  kind: 'agent',
  title: `Refine Regolith from quality findings (pass ${args.pass})`,
  agent: {
    name: 'regolith-quality-refiner',
    prompt: {
      role: 'Senior React engineer performing focused quality convergence',
      task: 'Fix verified quality-gate findings without scope drift.',
      context: args,
      instructions: [
        'Use frontend-design, harden, and polish skills. Resolve all critical/high findings and highest-value medium findings.',
        'Preserve safety semantics and user-owned untracked files. Add regression coverage for behavior fixes.',
        'Run lint, tests, and production build. Inspect affected screens locally.',
        'Update working.md with changes/evidence/remaining gaps.',
        'Commit owned validated changes and push main using thekozugroup@gmail.com; no co-author tags.',
        'Return exact evidence and commit hash, not a plan.',
      ],
      outputFormat: 'JSON matching schema with actual work and evidence.',
    },
    outputSchema: commonOutputSchema,
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['refinement', 'frontend', 'accessibility', 'quality'],
}));

export const deliveryHardeningTask = defineTask('regolith-delivery-hardening', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Harden install, deploy, rollback, and update survival',
  agent: {
    name: 'regolith-delivery-engineer',
    prompt: {
      role: 'Release engineer specializing in embedded Linux, atomic deployment, and recovery-safe tooling',
      task: 'Make Regolith easy to install and safe to update or roll back.',
      context: args,
      instructions: [
        'Use harden principles. Audit existing deploy.sh claims against behavior and fix every false or incomplete rollback path.',
        'Provide a novice-friendly one-command install/deploy experience with clear preflight, explicit host selection, host-key-safe SSH behavior, no committed password, helpful dependency errors, verification, and idempotency.',
        'Never embed credentials. Accept password through prompt/environment with safe quoting and no command echo; prefer SSH keys when available.',
        'Keep remote changes confined to Regolith static assets and its recovery metadata under persistent /usr/data paths. Do not change Klipper/Moonraker/firmware/service configs.',
        'Detect printer busy/printing state before any live static swap. Refuse deployment when not idle or state cannot be proven.',
        'Before swap, create a timestamped/verifiable backup or preserve a known-good previous build. Auto-rollback on every post-swap verification failure and verify rollback health.',
        'Add dry-run/preflight and rollback commands where practical. Document software-update survival as evidence-based best effort, not certainty.',
        'Add shell/static tests for safety-critical deployment logic without touching printer.',
        'Improve README install/update/rollback instructions for nontechnical users; update working.md.',
        'Preserve untracked watchdog scripts. Run all checks. Commit owned changes and push main using required identity; no co-author tags.',
      ],
      outputFormat: 'JSON matching schema with exact tests, changed files, commit, and evidence.',
    },
    outputSchema: commonOutputSchema,
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['deployment', 'install', 'rollback', 'update-survival', 'security'],
}));

export const printerValidationTask = defineTask('regolith-printer-live-validation', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Safely validate and deploy Regolith on K1 Max',
  agent: {
    name: 'regolith-printer-validator',
    prompt: {
      role: 'Conservative embedded deployment engineer and browser QA operator',
      task: 'Validate the hardened delivery path on forge.local without risking printer hardware.',
      context: args,
      instructions: [
        'Connect using supplied runtime password only; never print or persist it.',
        'Begin read-only: verify host identity context, model/version, Moonraker/print state, temperatures, update-related persistent paths, current static UI, backup state, storage, and HTTP health.',
        'Do not send G-code or call any endpoint that causes motion, homing, heating, extrusion, fans/lights, printing, cancellation, pause/resume, calibration, firmware update, service restart, or config writes.',
        'Proceed with static UI deployment only when printer is conclusively idle/standby, no job is active/paused, hardened preflight passes, exact-current local tests/build pass, backup is verified, and automatic rollback is armed.',
        'Deploy only static Regolith assets. On any failure, execute rollback immediately and verify known-good UI health.',
        'After success, inspect live UI with browser-use at desktop and 390px. Navigate read-only pages only; do not trigger printer actions. Check console/network errors and exact asset availability.',
        'Verify recovery/rollback command in dry-run or non-destructive form. Do not delete backups.',
        'Update working.md only if live evidence materially changes handoff. Commit/push that doc update if needed.',
        'Return whether deployment occurred, safety preconditions, backup/rollback evidence, live URL checks, and any blockers. Never claim success if deployment was skipped.',
      ],
      outputFormat: 'JSON with summary, deployed, rollbackReady, printerIdle, evidence, findings, changedFiles, commit, pushed.',
    },
    outputSchema: {
      type: 'object',
      required: ['summary', 'deployed', 'rollbackReady', 'printerIdle', 'evidence'],
      properties: {
        summary: { type: 'string' },
        deployed: { type: 'boolean' },
        rollbackReady: { type: 'boolean' },
        printerIdle: { type: 'boolean' },
        evidence: { type: 'array' },
        findings: { type: 'array' },
        changedFiles: { type: 'array', items: { type: 'string' } },
        commit: { type: ['string', 'null'] },
        pushed: { type: 'boolean' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['printer', 'deployment', 'read-only-first', 'rollback', 'browser'],
}));

export const finalGateTask = defineTask('regolith-final-gate', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Run final audit, evidence gate, handoff, commit, and push',
  agent: {
    name: 'regolith-final-reviewer',
    prompt: {
      role: 'Independent release reviewer with authority to fix remaining safe in-scope defects',
      task: 'Close the loop. Audit exact-current repository and live evidence; fix remaining defects; leave an honest handoff.',
      context: args,
      instructions: [
        'Use audit, harden, and polish principles. Inspect all diffs and commits from this run plus current git status.',
        'Fix remaining critical/high safety, accessibility, usability, install, rollback, or update-survival defects. Do not expand into printer firmware/config changes.',
        'Run exact-current lint, unit/integration tests, production build, deployment script static checks, secret scan, and representative browser smoke tests.',
        'Confirm no credential entered tracked files/history/diffs and no user-owned untracked file was modified/staged.',
        'Ensure working.md is concise and current: status, completed changes, verification evidence, printer state/deploy outcome, safety guarantees/limits, rollback, update survival, remaining gaps, next steps.',
        'Commit any owned final fixes/docs and push main using thekozugroup@gmail.com; no co-author tags.',
        'Set passed true only when exact-current checks pass, main equals origin/main, no owned changes remain, and any blocker is honestly documented.',
        'Return final commit list, test evidence, live evidence, remaining issues, and decision-ready status.',
      ],
      outputFormat: 'JSON with passed, summary, evidence, commits, remainingIssues, liveStatus.',
    },
    outputSchema: {
      type: 'object',
      required: ['passed', 'summary', 'evidence', 'commits', 'remainingIssues'],
      properties: {
        passed: { type: 'boolean' },
        summary: { type: 'string' },
        evidence: { type: 'array' },
        commits: { type: 'array', items: { type: 'string' } },
        remainingIssues: { type: 'array' },
        liveStatus: { type: 'object' },
      },
    },
  },
  io: {
    inputJsonPath: `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/output.json`,
  },
  labels: ['final', 'audit', 'polish', 'verification', 'handoff', 'git'],
}));
