import os from 'node:os';
import { env } from '../config/env.js';
import { SUPER_ADMIN_ROLE } from '../constants.js';

/**
 * Email alerts for the IT support account and other protected operations,
 * sent through Resend (https://resend.com) from env.securityAlerts.from to the
 * addresses in SECURITY_ALERT_TO.
 *
 *   - IT support sign-in (success) and failed sign-ins / password confirmations
 *   - attempts to create an Admin account (successful or blocked)
 *   - Backup & recovery: the recovery page and the server-shell recovery scripts
 *   - every Emergency Control action
 *
 * Called from utils/securityLog.js and utils/auditLog.js, so every place that
 * records one of these events also alerts. Never throws and never delays the
 * request: sending happens in the background.
 *
 * Floods are grouped: the first failed sign-in for an account is emailed at
 * once; later ones inside GROUP_WINDOW_MS go out as one summary. A global cap
 * protects the Resend quota. The email never contains passwords or tokens.
 */
const GROUP_WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_HOUR = 60;
const RESEND_URL = 'https://api.resend.com/emails';

const stats = { sent: 0, failed: 0, grouped: 0, capped: 0, lastError: null };
export const alertStats = () => ({ ...stats, configured: alertsEnabled() });

export const alertsEnabled = () => Boolean(env.securityAlerts.apiKey && env.securityAlerts.to.length);

// Test hook: replace the HTTP call (tests never reach Resend).
let transport = null;
export function setAlertTransport(fn) {
  transport = fn;
  groups.forEach((g) => clearTimeout(g.timer));
  groups.clear();
  sentAt.length = 0;
}

/** Client details for the server-shell recovery scripts (the machine's real host name). */
export const shellClient = () => ({ client: 'server shell', device: os.hostname(), os: `${os.type()} ${os.release()}`, browser: 'n/a (command line)', ip: 'server' });

const isIt = (role) => role === SUPER_ADMIN_ROLE;
const ADMIN_ROLES = ['admin', SUPER_ADMIN_ROLE];

/**
 * Decide whether an event needs an email. Returns null, or
 * { title, severity, group? } (group: events sharing it are combined).
 */
export function classify(source, name, e) {
  const target = e.targetRole;
  const reason = String(e.reason || '');
  const details = e.details || {};
  if (source === 'security') {
    if (name === 'LOGIN_SUCCESS' && isIt(e.actorRole)) return { title: 'IT support signed in', severity: 'High' };
    if ((name === 'LOGIN_FAILED' || name === 'SESSION_REVOKED' || name === 'REFRESH_FAILED') && isIt(target) && reason === 'outside_allowed_network') {
      const right = details.credentialsCorrect === true;
      return {
        title: name === 'LOGIN_FAILED' ? `IT support sign-in from a network that is not allowed${right ? ' — with the CORRECT password' : ''}` : 'IT support session used from a network that is not allowed',
        severity: 'Critical',
        group: `outside:${e.account}:${right}`,
      };
    }
    if (name === 'LOGIN_FAILED' && isIt(target)) {
      if (reason === 'account_locked' || reason === 'account_wide_lock') return { title: 'IT support account locked after failed sign-ins', severity: 'Critical', group: `lock:${e.account}` };
      return { title: 'Failed sign-in to the IT support account', severity: 'High', group: `fail:${e.account}` };
    }
    if (name === 'MAINTENANCE_BLOCKED' && isIt(target)) return { title: 'IT support sign-in blocked by platform mode', severity: 'High', group: `block:${e.account}` };
    return null;
  }
  // Protected audit trail.
  if (name === 'SUPER_ADMIN_REAUTH' && e.outcome === 'denied') return { title: 'Wrong password at an IT support confirmation', severity: 'High', group: `fail:${e.account}` };
  if (name === 'ADMIN_CREATED') {
    if (isIt(target)) return { title: 'New IT support account provisioned from the server', severity: 'Critical' };
    return { title: 'Admin account created', severity: 'High' };
  }
  if (name === 'ADMIN_PASSWORD_RESET' && isIt(target)) return { title: 'IT support password reset from the server', severity: 'Critical' };
  if (name === 'PRIVILEGE_ESCALATION_BLOCKED') {
    const role = details.role || details.targetRole;
    if (ADMIN_ROLES.includes(role) || reason === 'protected_fields_on_create') return { title: 'Blocked attempt to create an Admin account', severity: 'Critical', group: `admincreate:${e.actorId}` };
    return null;
  }
  if (name === 'RECOVERY_VIEWED') return { title: 'Backup & recovery opened', severity: 'High', group: `recovery:${e.actorId}` };
  if (name === 'EMERGENCY_TRANSITION') {
    const to = details.to ? ` → ${details.to}` : '';
    return { title: `Emergency Control used${to}${e.outcome && e.outcome !== 'success' ? ` (${e.outcome})` : ''}`, severity: 'Critical' };
  }
  if (name === 'EMERGENCY_HEALTH_CHECK') return { title: 'Emergency Control health check run', severity: 'High' };
  return null;
}

const groups = new Map();
const sentAt = [];

/**
 * Record one event; emails it when classify() says so.
 *   e: { actorRole, actorId, actorEmail, targetRole, account, outcome, reason, details, client }
 *   client: { ip, device, browser, os, client, userAgent } (utils/securityLog.js clientInfo)
 * Returns a promise only useful to scripts that must wait before exiting.
 */
export function securityAlert(source, name, e) {
  try {
    const rule = classify(source, name, e);
    if (!rule || !alertsEnabled()) return Promise.resolve(false);
    const event = { ...e, name, source, at: new Date() };
    if (!rule.group) return send(rule, [event]);
    const g = groups.get(rule.group);
    if (g) {
      stats.grouped += 1;
      g.events.push(event);
      return Promise.resolve(false);
    }
    const entry = { events: [], timer: null };
    entry.timer = setTimeout(() => {
      groups.delete(rule.group);
      if (entry.events.length) send({ ...rule, title: `${rule.title} — ${entry.events.length} more in the last ${GROUP_WINDOW_MS / 60000} minutes` }, entry.events);
    }, GROUP_WINDOW_MS);
    entry.timer.unref?.();
    groups.set(rule.group, entry);
    return send(rule, [event]);
  } catch (err) {
    console.error('[security-alert] failed:', err.message);
    return Promise.resolve(false);
  }
}

async function send(rule, events) {
  const now = Date.now();
  while (sentAt.length && now - sentAt[0] > 3600_000) sentAt.shift();
  if (sentAt.length >= MAX_PER_HOUR) {
    stats.capped += 1;
    console.warn(`[security-alert] hourly cap reached; not emailed: ${rule.title}`);
    return false;
  }
  sentAt.push(now);
  const { subject, html, text } = render(rule, events);
  const message = { from: env.securityAlerts.from, to: env.securityAlerts.to, subject, html, text };
  try {
    if (transport) await transport(message);
    else {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.securityAlerts.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    stats.sent += 1;
    return true;
  } catch (err) {
    stats.failed += 1;
    stats.lastError = { at: new Date(), message: String(err.message).slice(0, 200) };
    console.error(`[security-alert] send failed for "${rule.title}":`, err.message);
    return false;
  }
}

// ── Email body ───────────────────────────────────────────────────────

const REASONS = {
  invalid_password: 'Wrong password',
  account_locked: 'Account locked (too many failed attempts)',
  account_wide_lock: 'Account locked across all networks',
  account_disabled: 'Account is disabled',
  super_admin_web_only: 'Tried to sign in from the mobile app (web only)',
  protected_fields_on_create: 'Tried to set protected fields while creating an account',
  outside_allowed_network: 'Not from an allowed network (CONSOLE_ALLOWED_NETWORKS); answered as an invalid password',
  admin_role_via_user_form: 'Tried to give an account the Admin role from the Users page',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ist = (d) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' });

function rows(e) {
  const c = e.client || {};
  const d = e.details || {};
  return [
    ['Time (IST)', ist(e.at)],
    ['Time (UTC)', e.at.toISOString()],
    ['Result', e.outcome || (e.success === false ? 'failed' : 'success')],
    ['Account', e.account || '—'],
    ['Done by', e.actorEmail ? `${e.actorEmail}${e.actorRole ? ` (${e.actorRole === SUPER_ADMIN_ROLE ? 'IT support' : e.actorRole})` : ''}` : e.actorRole === 'system' ? 'Server shell' : 'Not signed in'],
    ['Reason', REASONS[e.reason] || e.reason || '—'],
    ['IP address', c.ip || '—'],
    ['Device', c.device || '—'],
    ['Browser', c.browser || '—'],
    ['Operating system', c.os || '—'],
    ['Client', c.client || '—'],
    ...(d.to ? [['Mode', `${d.from ? `${d.from} → ` : ''}${d.to}`]] : []),
    ...(d.role || d.targetRole ? [['Requested role', d.role || d.targetRole]] : []),
    ['User agent', c.userAgent || '—'],
  ];
}

export function render(rule, events) {
  const subject = `[J.N.N Security] ${rule.severity}: ${rule.title}`;
  const list = events.slice(0, 20);
  const table = (e) =>
    `<table style="border-collapse:collapse;font:14px/1.5 Arial,sans-serif;margin:0 0 16px">${rows(e)
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0;color:#111;word-break:break-all">${esc(v)}</td></tr>`)
      .join('')}</table>`;
  const ips = [...new Set(events.map((e) => e.client?.ip).filter(Boolean))];
  const html = `<div style="font:14px/1.5 Arial,sans-serif;color:#111;max-width:640px">
<h2 style="margin:0 0 4px;font-size:18px">${esc(rule.title)}</h2>
<p style="margin:0 0 16px;color:#555">Severity: <b>${esc(rule.severity)}</b>${events.length > 1 ? ` · ${events.length} events from ${ips.length} IP address(es)` : ''}</p>
${list.map(table).join('<hr style="border:0;border-top:1px solid #ddd;margin:8px 0 16px">')}
${events.length > list.length ? `<p>…and ${events.length - list.length} more. See Security Ops for all of them.</p>` : ''}
<p style="color:#555;font-size:12px">If this was not you or someone you authorised, open the console, revoke sessions and change the password at once. This email never contains passwords or codes.</p>
</div>`;
  const text = `${rule.title}\nSeverity: ${rule.severity}\n\n${list.map((e) => rows(e).map(([k, v]) => `${k}: ${v}`).join('\n')).join('\n\n---\n\n')}\n`;
  return { subject, html, text };
}
