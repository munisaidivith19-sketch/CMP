import { startServer } from './helpers.js';

// Shared cast for the announcement-audience tests: one department (CSE) with
// students in several years / sections, its HOD and faculty, and an ECE
// counterpart for every role so cross-department leaks show up.
export const D = 'CSE';

export async function setupAnnouncementCast() {
  const ctx = await startServer();
  const tok = {};
  const u = {};
  const defs = {
    principal: { role: 'principal' },
    admin: { role: 'admin', department: D },
    chairman: { role: 'chairman' },
    dean: { role: 'dean' },
    ao: { role: 'ao' },
    hod: { role: 'hod', department: D },
    eceHod: { role: 'hod', department: 'ECE' },
    fyHod: { role: 'hod', department: 'Science & Humanities' },
    faculty: { role: 'faculty', department: D },
    eceFaculty: { role: 'faculty', department: 'ECE' },
    security: { role: 'security' },
    y3a: { department: D, section: 'A', semester: 5 },
    y3b: { department: D, section: 'B', semester: 5 },
    y2a: { department: D, section: 'A', semester: 3 },
    y1a: { department: D, section: 'A', semester: 1 },
    eceY3a: { department: 'ECE', section: 'A', semester: 5 },
    eceY2a: { department: 'ECE', section: 'A', semester: 3 },
    eceY1a: { department: 'ECE', section: 'A', semester: 1 },
  };
  for (const [k, o] of Object.entries(defs)) {
    u[k] = await ctx.createUser(o);
    tok[k] = (await ctx.loginWeb(u[k])).token;
  }

  const post = (who, audience, extra = {}) =>
    ctx.request('POST', '/announcements', {
      token: tok[who],
      body: { title: `Notice ${Math.random().toString(36).slice(2, 7)}`, content: 'Please read this notice.', audience, ...extra },
    });

  async function visibleTo(who, id) {
    const res = await ctx.request('GET', '/announcements?limit=50', { token: tok[who] });
    if (res.status !== 200) throw new Error(`list failed for ${who}: ${res.status}`);
    return res.body.items.some((a) => a._id === id);
  }

  return { ctx, tok, u, post, visibleTo };
}
