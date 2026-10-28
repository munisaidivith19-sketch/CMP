// End-to-end fixture: the real backend on a throw-away test database, seeded
// with Security accounts, students and approved gate passes. Prints one JSON
// line ({ base, guard, ... }) and keeps running until it is killed.
// Usage: node gate-scanner/tests/e2e/demo-server.mjs   (needs a local MongoDB)
process.env.TEST_MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/gate_scanner_e2e_test';
const { startServer, PASSWORD } = await import('../../../server/tests/helpers.js');
const { testOtpProvider } = await import('../../../server/src/services/otp/providers/testOtpProvider.js');

const ctx = await startServer();
const make = async (role, extra = {}) => {
  const u = await ctx.createUser({ role, ...extra });
  return { u, ...(await ctx.loginWeb(u)) };
};
const faculty = await make('faculty', { name: 'Class In-Charge', department: 'CSE', section: 'A', teachingYears: [3], employeeId: 'E2E-F' });
const hod = await make('hod', { name: 'HOD CSE', department: 'CSE', employeeId: 'E2E-H' });
const principal = await make('principal', { name: 'Principal', employeeId: 'E2E-P' });
const dean = await make('dean', { name: 'Dean', employeeId: 'E2E-D' });
const guard = await ctx.createUser({ role: 'security', name: 'Ravi Kumar (Security)', email: 'guard1@e2e.test', employeeId: 'E2E-S1' });
const guard2 = await ctx.createUser({ role: 'security', name: 'Meena S (Security)', email: 'guard2@e2e.test', employeeId: 'E2E-S2' });
const facultyUser = await ctx.createUser({ role: 'faculty', name: 'Not Security', email: 'faculty@e2e.test', department: 'CSE', employeeId: 'E2E-F2' });

const NAMES = ['Arun Prakash', 'Divya Lakshmi', 'Karthik Raja', 'Nisha Fathima', 'Sanjay Vel', 'Priya Dharshini'];
let n = 0;
async function approvedNormal() {
  const name = NAMES[n % NAMES.length];
  n += 1;
  const u = await ctx.createUser({ name, rollNo: `21CS${String(100 + n).padStart(3, '0')}`, department: 'CSE', section: 'A', year: 3, parentPhone: '9876504321' });
  const student = { u, ...(await ctx.loginWeb(u)) };
  const day = new Date().toISOString().slice(0, 10);
  const { body } = await ctx.request('POST', '/gate-pass', {
    token: student.token,
    body: { regarding: 'outing', description: 'Weekend at home', fromDate: day, toDate: day, parentPhone: '9876504321', destination: { state: 'Tamil Nadu', district: 'Chennai', area: 'Adyar' } },
  });
  const id = body._id;
  await ctx.request('POST', `/gate-pass/${id}/parent-otp`, { token: faculty.token });
  const rec = await ctx.models.OutpassOtp.findOne({ gatePass: id }).sort({ createdAt: -1 });
  await ctx.request('POST', `/gate-pass/${id}/parent-otp/verify`, { token: faculty.token, body: { otp: testOtpProvider.peek(rec._id) } });
  await ctx.request('PATCH', `/gate-pass/${id}/faculty-review`, { token: faculty.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${id}/hod-review`, { token: hod.token, body: { action: 'forward' } });
  await ctx.request('PATCH', `/gate-pass/${id}/principal-review`, { token: principal.token, body: { action: 'approve' } });
  const qr = await ctx.request('GET', `/gate-pass/${id}/qr`, { token: student.token });
  return { id, student, exitPayload: qr.body.payload };
}

const passes = [];
for (let i = 0; i < 5; i += 1) passes.push(await approvedNormal());
void dean;

// One student is already outside with a fresh Return QR.
const outside = await approvedNormal();
const g2 = await ctx.request('POST', '/auth/login', { body: { email: guard2.email, password: PASSWORD } });
await ctx.request('PATCH', `/gate-pass/${outside.id}/out`, { token: g2.body.accessToken, body: { code: outside.exitPayload } });
const back = await ctx.request('POST', `/gate-pass/${outside.id}/return-location/verify`, {
  token: outside.student.token,
  body: { latitude: 13.2639, longitude: 80.1083, accuracy: 10, timestamp: Date.now() },
});

console.log(
  JSON.stringify({
    base: ctx.base,
    password: PASSWORD,
    guard: guard.email,
    guard2: guard2.email,
    notSecurity: facultyUser.email,
    exitPayloads: passes.map((p) => p.exitPayload),
    returnPayload: back.body.payload,
  })
);

const stop = async () => {
  await ctx.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
process.stdin.resume();
